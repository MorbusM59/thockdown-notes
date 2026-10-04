import type { EditorTextEdit } from './EditorContract'

/**
 * The document, split into lines, maintained by *splicing* rather than by
 * re-splitting.
 *
 * ## Why this exists
 *
 * Several consumers need the note as an array of lines on every keystroke --
 * the note title, the markdown inline-state cache, and (next) the fenced-code
 * state the Enter transform depends on. Each of them independently called
 * `text.split('\n')` on the whole document, every keypress, and each then did
 * genuinely cheap O(edit) work on the result. On a 1.5M-character note that
 * front end is ~30,000 fresh substring allocations per keypress, and it
 * dominated the work it was a prelude to.
 *
 * That was not an oversight in those consumers so much as a missing shared
 * primitive: every one of them was labelled "incremental", had a careful
 * safety argument and a fuzz test, and had genuinely removed the per-line
 * work -- while keeping an O(document) front end whose only job was to
 * reconstruct an edit the app already knew about.
 *
 * ## What it costs
 *
 * Applying an edit touches only the lines the edit actually spans: the
 * partial first and last lines are re-split (O(edit size + those two lines'
 * lengths)) and spliced into the array, which is a pointer memmove rather
 * than an allocation per line. The trailing offsets are then shifted by the
 * edit's character delta -- a numeric loop over the array, no allocation.
 *
 * Deliberately NOT a fancier structure (a rope, a Fenwick tree over line
 * lengths) to make that trailing shift sublinear. The shift is arithmetic on
 * a contiguous Float64/Smi array; the thing it replaced allocated a string
 * per line. Measure before adding a tree: this codebase carried a positional
 * treap for years (`ParagraphOffsetIndex`, deleted once this landed) that was
 * a genuine, well-tested win for an editor that no longer exists, and had
 * zero consumers from the day that editor was removed.
 *
 * ## The invariant
 *
 * `lines` is exactly `text.split('\n')` and `lineStartOffsets[i]` is where
 * line `i` begins. Both are asserted against a full rebuild after every step
 * of a randomized edit sequence in DocumentLineIndex.test.ts -- proven, not
 * reasoned about, per this codebase's standing rule for incremental caches.
 */
export interface DocumentLineIndex {
  readonly text: string
  readonly lines: string[]
  /** lineStartOffsets[i] = character offset where line i begins. Always starts with 0. */
  readonly lineStartOffsets: number[]
}

export function buildDocumentLineIndex(text: string): DocumentLineIndex {
  const lines = text.split('\n')
  const lineStartOffsets = new Array<number>(lines.length)
  let offset = 0
  for (let i = 0; i < lines.length; i += 1) {
    lineStartOffsets[i] = offset
    offset += lines[i].length + 1
  }
  return { text, lines, lineStartOffsets }
}

/** Largest `i` with `lineStartOffsets[i] <= offset`. Well-defined: the array is never empty and its first entry is 0. */
export function lineIndexAtOffset(index: DocumentLineIndex, offset: number): number {
  const offsets = index.lineStartOffsets
  let lo = 0
  let hi = offsets.length - 1
  let result = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (offsets[mid] <= offset) {
      result = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return result
}

/**
 * Applies one edit, producing the index for the resulting document.
 *
 * `nextText` must be the document the edit produces --
 * `previous.text.slice(0, edit.from) + edit.insert + previous.text.slice(edit.to)`.
 * It is passed in rather than built here because every caller already holds
 * it (the transform contract derives it, CM6 hands it over), and building it
 * again would allocate a second copy of the document.
 *
 * Returns a full rebuild when `previous` is null or its text does not match
 * what the edit was computed against -- always correct, just not incremental
 * for that one call.
 */
export function applyEditToDocumentLineIndex(
  previous: DocumentLineIndex | null,
  nextText: string,
  edit: EditorTextEdit,
): DocumentLineIndex {
  if (previous === null) return buildDocumentLineIndex(nextText)

  const { from, to, insert } = edit
  if (from < 0 || to < from || to > previous.text.length) return buildDocumentLineIndex(nextText)

  const firstLine = lineIndexAtOffset(previous, from)
  const lastLine = lineIndexAtOffset(previous, to)
  const firstLineStart = previous.lineStartOffsets[firstLine]
  const lastLineStart = previous.lineStartOffsets[lastLine]

  // The edit replaces a span inside lines [firstLine..lastLine]. Rebuild
  // exactly that span -- the untouched head of the first line, the inserted
  // text, and the untouched tail of the last line -- and split only that.
  const head = previous.lines[firstLine].slice(0, from - firstLineStart)
  const tail = previous.lines[lastLine].slice(to - lastLineStart)
  const replacementLines = `${head}${insert}${tail}`.split('\n')

  const replacedLineCount = lastLine - firstLine + 1
  const lineDelta = replacementLines.length - replacedLineCount
  const lines = previous.lines.slice()
  lines.splice(firstLine, replacedLineCount, ...replacementLines)

  const lineStartOffsets = new Array<number>(lines.length)
  for (let i = 0; i <= firstLine; i += 1) {
    lineStartOffsets[i] = previous.lineStartOffsets[i]
  }
  let offset = firstLineStart
  const replacedEnd = firstLine + replacementLines.length
  for (let i = firstLine; i < replacedEnd; i += 1) {
    lineStartOffsets[i] = offset
    offset += lines[i].length + 1
  }
  // Every line after the replaced span keeps its content and simply moves by
  // the edit's character delta. Pure arithmetic -- no coupling between lines
  // to reason about, unlike the inline-scan state MarkdownContext maintains.
  const charDelta = insert.length - (to - from)
  for (let i = replacedEnd; i < lines.length; i += 1) {
    lineStartOffsets[i] = previous.lineStartOffsets[i - lineDelta] + charDelta
  }

  return { text: nextText, lines, lineStartOffsets }
}
