import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { MdastAstNode } from './mdastShape'



// Same parse-only pipeline (and same remark-gfm config) PreviewBlockSplit.ts
// uses, so what this considers "visible" is derived from exactly the tree the
// preview pane itself renders from.
const visibleTextProcessor = unified().use(remarkParse).use(remarkGfm).freeze()

/**
 * Node types whose own `value` is what the reader actually sees. `text` is
 * the ordinary case; `inlineCode`/`code` carry their content as a value with
 * the backticks/fences already stripped by remark -- which is precisely the
 * distinction this module exists to capture.
 */
const VISIBLE_VALUE_NODE_TYPES = new Set(['text', 'inlineCode', 'code'])

/**
 * Never reaches the screen in the preview pane: link/footnote *definitions*
 * are pure addressing, raw `html` is dropped entirely (no rehype-raw in the
 * preview pipeline), `yaml` is front matter, and an image renders as an
 * `<img>` -- its alt text is an attribute, not text the reader can search
 * for by eye.
 */
const INVISIBLE_NODE_TYPES = new Set(['definition', 'html', 'yaml', 'image', 'imageReference'])

/**
 * Nodes rendered as their own block-level box. A separator is emitted at
 * each boundary so a query never matches across two blocks that merely
 * happen to be adjacent in the source -- and so this projection's own
 * occurrence ordinals line up with what a DOM text walk of the rendered
 * output produces (see collectPreviewElementVisibleText's mirror of this
 * set in useDocumentFindNavigation.ts).
 */
const BLOCK_NODE_TYPES = new Set([
  'paragraph', 'heading', 'blockquote', 'code', 'thematicBreak',
  'listItem', 'table', 'tableRow', 'tableCell', 'footnoteDefinition',
])

/** One run of rendered-visible text and the source span it came from. */
export interface PreviewVisibleTextSegment {
  visibleStart: number
  visibleEnd: number
  sourceStart: number
  sourceEnd: number
}

export interface PreviewVisibleTextProjection {
  /** Everything the preview pane actually shows, in document order. */
  visibleText: string
  /** Ordered, non-overlapping; gaps are markdown syntax that renders to nothing. */
  segments: PreviewVisibleTextSegment[]
}

/**
 * Projects markdown down to just the text the *rendered* view displays --
 * link labels without their `(#anchor)` targets, emphasis without its
 * asterisks, code without its fences -- keeping a source-offset mapping for
 * every run so a hit found in the projection can still be addressed in the
 * real document (jump-to-line in edit mode, replace, scroll targeting).
 *
 * Exists because find-in-document searches the raw markdown, which in
 * preview mode produces hits the reader cannot see: `[anchor](#anchor)`
 * yields two source matches for "anchor" but shows one word. The extra,
 * invisible match doesn't just pad the count -- it shifts every later hit's
 * ordinal, which is what the preview jump used to resolve a card to a
 * position, so clicking a card landed on the wrong occurrence.
 */
/**
 * A projection under construction.
 *
 * Separate from the finished projection because the document can be handed
 * over in PIECES -- the block split already parses it a window at a time, and
 * the same pass can produce this (see appendProjectionNodes). The three
 * fields are exactly what an append needs to know about everything that came
 * before it, which is why chunking works at all: how long the visible text is
 * so far, whether it already ends in a newline, and where to put the pieces.
 */
export interface PreviewVisibleTextAccumulator {
  parts: string[]
  visibleLength: number
  endsWithNewline: boolean
  segments: PreviewVisibleTextSegment[]
}

export function createPreviewVisibleTextAccumulator(): PreviewVisibleTextAccumulator {
  return { parts: [], visibleLength: 0, endsWithNewline: false, segments: [] }
}

/**
 * Walks `nodes` into `accumulator`, shifting every source offset by
 * `sourceOffset`.
 *
 * `sourceOffset` is what makes a windowed parse usable: a window parsed on its
 * own reports offsets relative to its own text, and the document's offset of
 * the window's first character converts them. It is 0 for a whole-document
 * parse, which is why the two paths are the same code rather than two
 * implementations that have to agree.
 *
 * The projection has no document-wide dependency of its own -- unlike the
 * block split, which appends every link/footnote definition to every block --
 * so nodes can be appended in document order and the result is the same as a
 * single pass. `PreviewVisibleText.test.ts` holds that to an exact match
 * against a whole-document parse at several chunk sizes rather than taking
 * this paragraph's word for it.
 */
export function appendProjectionNodes(
  accumulator: PreviewVisibleTextAccumulator,
  nodes: readonly MdastAstNode[],
  sourceOffset = 0,
): void {
  const append = (value: string) => {
    if (value.length === 0) return
    accumulator.parts.push(value)
    accumulator.visibleLength += value.length
    accumulator.endsWithNewline = value.charCodeAt(value.length - 1) === 10
  }

  const appendBlockSeparator = () => {
    if (accumulator.visibleLength === 0) return
    if (accumulator.endsWithNewline) return
    append('\n')
  }

  const walk = (node: MdastAstNode) => {
    if (!node || typeof node !== 'object') return
    if (INVISIBLE_NODE_TYPES.has(node.type)) return

    const isBlock = BLOCK_NODE_TYPES.has(node.type)
    if (isBlock) appendBlockSeparator()

    if (VISIBLE_VALUE_NODE_TYPES.has(node.type) && typeof node.value === 'string') {
      const sourceStart = node.position?.start?.offset
      const sourceEnd = node.position?.end?.offset
      if (typeof sourceStart === 'number' && node.value.length > 0) {
        accumulator.segments.push({
          visibleStart: accumulator.visibleLength,
          visibleEnd: accumulator.visibleLength + node.value.length,
          sourceStart: sourceStart + sourceOffset,
          sourceEnd: (typeof sourceEnd === 'number' ? sourceEnd : sourceStart + node.value.length) + sourceOffset,
        })
        append(node.value)
      }
      if (isBlock) appendBlockSeparator()
      return
    }

    // A hard line break renders as <br>, so it separates words the same way
    // a block boundary does -- without being one.
    if (node.type === 'break') {
      if (!accumulator.endsWithNewline) append('\n')
      return
    }

    node.children?.forEach(walk)

    if (isBlock) appendBlockSeparator()
  }

  nodes.forEach(walk)
}

/**
 * The finished projection.
 *
 * The pieces are joined exactly once, here. They used to be concatenated with
 * `+=` while `endsWith('\n')` was consulted per block -- V8 keeps a `+=`
 * chain as a rope and flattens it whenever something needs the characters in
 * order, so every block boundary flattened a string growing to 1.8MB, ~58,000
 * times. Measured at 142 SECONDS on a 2MB note against ~16s for the block
 * split's parse of the same document. The parse was never the expensive part.
 */
export function finishPreviewVisibleTextProjection(
  accumulator: PreviewVisibleTextAccumulator,
): PreviewVisibleTextProjection {
  return { visibleText: accumulator.parts.join(''), segments: accumulator.segments }
}

/**
 * Whether this document has to be parsed WHOLE for its projection to be right.
 *
 * The projection can otherwise be assembled from the block split's own
 * windows, which is free -- the parse is already happening. There is exactly
 * one thing that breaks that, and it is not obvious enough to have been
 * reasoned out in advance; a test found it:
 *
 *   `[ref]` renders as the word "ref" if a `[ref]: url` definition exists
 *   ANYWHERE in the document, and as the literal text "[ref]" if it does
 *   not. A window parsed before it reaches the definition therefore projects
 *   different visible text than the whole document does -- so find would
 *   search "[ref]" where the reader sees "ref". Same for `[^fn]` footnotes.
 *
 * The test is deliberately CONSERVATIVE: it matches anything shaped like a
 * definition, including one inside a code fence, where remark would not treat
 * it as one. A false positive costs a whole-document parse for that note; a
 * false negative would silently project text the reader cannot see. Those are
 * not comparable, so the cheap side is the wrong side to be clever on.
 */
const REFERENCE_DEFINITION_LINE = /^ {0,3}\[[^\]]*\]:/

export function projectionNeedsWholeDocumentParse(markdown: string): boolean {
  let lineStart = 0
  while (lineStart <= markdown.length) {
    let lineEnd = markdown.indexOf('\n', lineStart)
    if (lineEnd === -1) lineEnd = markdown.length
    // Only the first few characters can carry the shape, so this never slices
    // a long line out to test it.
    if (REFERENCE_DEFINITION_LINE.test(markdown.slice(lineStart, Math.min(lineEnd, lineStart + 256)))) {
      return true
    }
    lineStart = lineEnd + 1
  }
  return false
}

export function buildPreviewVisibleTextProjection(markdown: string): PreviewVisibleTextProjection {
  const root = visibleTextProcessor.parse(markdown) as MdastAstNode
  const accumulator = createPreviewVisibleTextAccumulator()
  appendProjectionNodes(accumulator, root.children ?? [])
  return finishPreviewVisibleTextProjection(accumulator)
}

/**
 * Memo keyed by exact text, holding the last few documents.
 *
 * The projection is a full remark parse of the whole document -- affordable
 * once per note, not once per search -- and every caller asks for the same
 * document repeatedly (hit list, then a jump per clicked card).
 *
 * It held exactly ONE document, and that was reported as a bug before it was
 * understood as one: the first search in render view froze the app, every
 * later term was instant, and switching to another note and back froze it
 * again, because the single slot then held the other note. Two notes
 * alternated with each other evicted the cache on every switch, which is the
 * common case (compare a document against its own history, or against the
 * one you are writing from).
 *
 * Runs in the worker only, so the memory this holds is not the renderer's --
 * but a projection of a 2MB note is still a megabyte-scale string plus a
 * segment per text node, so this is a handful of entries, not a cache.
 */
const PROJECTION_MEMO_SIZE = 3
const projectionMemo = new Map<string, PreviewVisibleTextProjection>()

export function getPreviewVisibleTextProjection(markdown: string): PreviewVisibleTextProjection {
  const cached = projectionMemo.get(markdown)
  if (cached) {
    // Re-inserted so the least RECENTLY used entry is the one evicted, not
    // the oldest by insertion: alternating between two notes must keep both.
    projectionMemo.delete(markdown)
    projectionMemo.set(markdown, cached)
    return cached
  }
  const projection = buildPreviewVisibleTextProjection(markdown)
  projectionMemo.set(markdown, projection)
  if (projectionMemo.size > PROJECTION_MEMO_SIZE) {
    const oldest = projectionMemo.keys().next()
    if (!oldest.done) projectionMemo.delete(oldest.value)
  }
  return projection
}

/**
 * Maps an offset in `visibleText` back to the equivalent offset in the
 * markdown source. Within a segment the mapping is 1:1 from its start
 * (clamped to the segment's own source span, since a run's source can be
 * longer than what it renders to -- backslash escapes, entity references);
 * an offset that lands in a gap between segments resolves to the start of
 * the following segment, i.e. the next real character on screen.
 */
export function mapVisibleOffsetToSourceOffset(
  projection: PreviewVisibleTextProjection,
  visibleOffset: number,
): number {
  const { segments } = projection
  if (segments.length === 0) return 0

  let low = 0
  let high = segments.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const segment = segments[mid]
    if (visibleOffset < segment.visibleStart) {
      high = mid - 1
    } else if (visibleOffset >= segment.visibleEnd) {
      low = mid + 1
    } else {
      return Math.min(segment.sourceEnd, segment.sourceStart + (visibleOffset - segment.visibleStart))
    }
  }

  // Landed in a gap (or past the end): `low` is the first segment after it.
  if (low < segments.length) return segments[low].sourceStart
  return segments[segments.length - 1].sourceEnd
}

/**
 * Maps a half-open range of visible text onto the source. The end is
 * resolved from the range's *last character*, not from the offset one past
 * it: that offset routinely lands in a gap (the "]" + "(#anchor)" right
 * after a link label is exactly this case), which mapVisibleOffsetToSourceOffset
 * -- correctly, for a caret -- resolves forward to the next visible
 * character, producing a source span that swallowed the whole invisible
 * tail. An empty range collapses to its start.
 */
export function mapVisibleRangeToSourceRange(
  projection: PreviewVisibleTextProjection,
  visibleStart: number,
  visibleEnd: number,
): { start: number; end: number } {
  const start = mapVisibleOffsetToSourceOffset(projection, visibleStart)
  if (visibleEnd <= visibleStart) return { start, end: start }
  const lastCharacterStart = mapVisibleOffsetToSourceOffset(projection, visibleEnd - 1)
  return { start, end: Math.max(start, lastCharacterStart + 1) }
}

/**
 * Records a projection built elsewhere against its text.
 *
 * The block split parses every note as it opens, and the same pass now
 * produces this projection (documentFacts.worker.ts). Handing it here means
 * the reader's first find is a string scan over something already built,
 * rather than a 30-second parse they wait through -- and the memo stops being
 * a cache whose size matters and becomes a by-product of opening the note.
 */
export function rememberPreviewVisibleTextProjection(
  markdown: string,
  projection: PreviewVisibleTextProjection,
): void {
  projectionMemo.delete(markdown)
  projectionMemo.set(markdown, projection)
  if (projectionMemo.size > PROJECTION_MEMO_SIZE) {
    const oldest = projectionMemo.keys().next()
    if (!oldest.done) projectionMemo.delete(oldest.value)
  }
}
