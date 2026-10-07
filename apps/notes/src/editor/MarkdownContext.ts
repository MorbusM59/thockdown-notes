import { readFenceTokenAt } from './textScanning'
import type { EditorSelectionState, EditorTextEdit, EditorTransformResult } from './EditorContract'
import { applyEditToDocumentLineIndex, buildDocumentLineIndex, lineIndexAtOffset, type DocumentLineIndex } from './DocumentLineIndex'
import { buildTransformResult, collapsedSelectionAt } from './TransformResult'
import { clamp } from '@thockdown/interaction/clamp'

export type MarkdownListKind = 'ordered' | 'unordered' | null

export type MarkdownInlineState = {
  inBold: boolean
  inItalic: boolean
  inStrikethrough: boolean
  inInlineCode: boolean
  inFencedCodeBlock: boolean
}

export type MarkdownLineContext = {
  lineStart: number
  lineEndExclusive: number
  lineText: string
  lineIndex: number
  column: number
  leadingWhitespaceCount: number
  blockquoteDepth: number
  headingLevel: 0 | 1 | 2 | 3 | 4 | 5 | 6
  listKind: MarkdownListKind
  listIndentLevel: number
  listMarker: string | null
  orderedListNumber: number | null
}

export type MarkdownSelectionContext = {
  caretOffset: number
  line: MarkdownLineContext
  inline: MarkdownInlineState
}

export type IndentDirection = 'indent' | 'outdent'

export type IndentationTransformResult = EditorTransformResult

export type EnterKeyTransformResult = EditorTransformResult


function countLeadingSpaces(line: string): number {
  let count = 0
  for (let index = 0; index < line.length; index += 1) {
    if (line.charCodeAt(index) !== 32) break
    count += 1
  }
  return count
}

function countLineIndex(text: string, offset: number): number {
  if (offset <= 0) return 0
  let count = 0
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) count += 1
  }
  return count
}

function resolveLineBounds(text: string, start: number, end: number): { lineStart: number; lineEndExclusive: number } {
  const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const endProbe = end > start ? end - 1 : end
  const lineEndNewline = text.indexOf('\n', endProbe)
  const lineEndExclusive = lineEndNewline === -1 ? text.length : lineEndNewline
  return { lineStart, lineEndExclusive }
}

function resolveHeadingLevel(lineText: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  const match = lineText.match(/^\s*(?:>\s*)*(#{1,6})(?:\s|$)/)
  if (!match) return 0
  return match[1].length as 1 | 2 | 3 | 4 | 5 | 6
}

function resolveBlockquoteDepth(lineText: string): number {
  const match = lineText.match(/^\s*((?:>\s*)+)/)
  if (!match) return 0
  const markers = match[1].match(/>/g)
  return markers ? markers.length : 0
}

function resolveListMeta(lineText: string): {
  listKind: MarkdownListKind
  listIndentLevel: number
  listMarker: string | null
  orderedListNumber: number | null
} {
  const unorderedMatch = lineText.match(/^(\s*)(?:> ?)*(\s*)([-*+])\s+/)
  if (unorderedMatch) {
    const indent = unorderedMatch[1].length + unorderedMatch[2].length
    return {
      listKind: 'unordered',
      listIndentLevel: Math.floor(indent / 3),
      listMarker: unorderedMatch[3],
      orderedListNumber: null,
    }
  }

  const orderedMatch = lineText.match(/^(\s*)(?:> ?)*(\s*)(\d+)([.)])\s+/)
  if (orderedMatch) {
    const indent = orderedMatch[1].length + orderedMatch[2].length
    return {
      listKind: 'ordered',
      listIndentLevel: Math.floor(indent / 3),
      listMarker: `${orderedMatch[3]}${orderedMatch[4]}`,
      orderedListNumber: Number.parseInt(orderedMatch[3], 10),
    }
  }

  return {
    listKind: null,
    listIndentLevel: 0,
    listMarker: null,
    orderedListNumber: null,
  }
}

const LIST_CONTINUATION_ARTIFACT_PATTERN = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/

function stripListContinuationArtifacts(remainder: string): string {
  let result = remainder
  while (LIST_CONTINUATION_ARTIFACT_PATTERN.test(result)) {
    result = result.replace(LIST_CONTINUATION_ARTIFACT_PATTERN, '')
  }
  return result.replace(/^[ \t]+/, '')
}

function readDelimiterRun(text: string, from: number, charCode: number): number {
  let index = from
  while (index < text.length && text.charCodeAt(index) === charCode) {
    index += 1
  }
  return index - from
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0
  let cursor = index - 1
  while (cursor >= 0 && text.charCodeAt(cursor) === 92) {
    slashCount += 1
    cursor -= 1
  }
  return slashCount % 2 === 1
}

/** Internal scan state threaded through scanInlineStateFrom below -- a superset of the public MarkdownInlineState (tracks fence/inline-code delimiter identity and length, not just the booleans callers see) needed to correctly continue scanning from a non-zero starting point. */
interface InlineScanState {
  inBold: boolean
  inItalic: boolean
  inStrikethrough: boolean
  activeCodeFence: '`' | '~' | null
  activeCodeFenceLen: number
  activeInlineCodeLen: number
}

const INITIAL_SCAN_STATE: InlineScanState = {
  inBold: false,
  inItalic: false,
  inStrikethrough: false,
  activeCodeFence: null,
  activeCodeFenceLen: 0,
  activeInlineCodeLen: 0,
}

function toMarkdownInlineState(state: InlineScanState): MarkdownInlineState {
  return {
    inBold: state.inBold,
    inItalic: state.inItalic,
    inStrikethrough: state.inStrikethrough,
    inInlineCode: state.activeInlineCodeLen > 0,
    inFencedCodeBlock: state.activeCodeFence !== null,
  }
}

/**
 * Scans `text` from `startCursor` (must land exactly on a line start -- 0,
 * or immediately after a '\n') up to `offset`, treating `initialState` as
 * whatever this same scan would have already accumulated for everything
 * before `startCursor`. computeInlineStateAtOffset (the O(document length)
 * ground truth) is just this called with startCursor=0 and
 * initialState=INITIAL_SCAN_STATE; the incremental line cache below
 * (buildInlineStateLineCache/updateInlineStateLineCacheIncremental) calls
 * this exact same function starting partway through the document, with
 * initialState supplied by the cache, so the fast and slow paths can never
 * silently drift apart -- one implementation, two starting points, per this
 * codebase's own established fast-path/slow-path pattern.
 */
function scanInlineStateFrom(text: string, startCursor: number, initialState: InlineScanState, offset: number): InlineScanState {
  const safeOffset = clamp(offset, 0, text.length)
  let inBold = initialState.inBold
  let inItalic = initialState.inItalic
  let inStrikethrough = initialState.inStrikethrough
  let activeCodeFence = initialState.activeCodeFence
  let activeCodeFenceLen = initialState.activeCodeFenceLen
  let activeInlineCodeLen = initialState.activeInlineCodeLen

  let cursor = startCursor
  while (cursor < safeOffset) {
    const lineStart = cursor
    let lineEnd = text.indexOf('\n', lineStart)
    if (lineEnd === -1 || lineEnd > safeOffset) lineEnd = safeOffset

    // Read in place rather than slicing the line out to run a regex over it:
    // the slice was the only allocation in this loop, paid once per line for
    // a question about the line's first few characters. See
    // textScanning.ts's own note on why that mattered.
    const fenceToken = activeInlineCodeLen ? null : readFenceTokenAt(text, lineStart, lineEnd)
    if (fenceToken) {
      const fenceChar = fenceToken.char
      const fenceLen = fenceToken.length

      if (!activeCodeFence) {
        activeCodeFence = fenceChar
        activeCodeFenceLen = fenceLen
        cursor = lineEnd + 1
        continue
      }

      if (activeCodeFence === fenceChar && fenceLen >= activeCodeFenceLen) {
        activeCodeFence = null
        activeCodeFenceLen = 0
        cursor = lineEnd + 1
        continue
      }
    }

    if (activeCodeFence) {
      cursor = lineEnd + 1
      continue
    }

    let index = lineStart
    while (index < lineEnd) {
      const charCode = text.charCodeAt(index)

      if (charCode === 96 && !isEscaped(text, index)) {
        const runLen = readDelimiterRun(text, index, 96)
        if (activeInlineCodeLen === 0) {
          activeInlineCodeLen = runLen
          index += runLen
          continue
        }
        if (runLen >= activeInlineCodeLen) {
          activeInlineCodeLen = 0
        }
        index += runLen
        continue
      }

      if (activeInlineCodeLen > 0) {
        index += 1
        continue
      }

      if (charCode === 126 && !isEscaped(text, index)) {
        const runLen = readDelimiterRun(text, index, 126)
        if (runLen >= 2) {
          inStrikethrough = !inStrikethrough
          index += 2
          continue
        }
      }

      if ((charCode === 42 || charCode === 95) && !isEscaped(text, index)) {
        let runLen = readDelimiterRun(text, index, charCode)

        while (runLen >= 2) {
          inBold = !inBold
          runLen -= 2
          index += 2
        }

        if (runLen === 1) {
          inItalic = !inItalic
          index += 1
          continue
        }

        continue
      }

      index += 1
    }

    cursor = lineEnd + 1
  }

  return {
    inBold,
    inItalic,
    inStrikethrough,
    activeCodeFence,
    activeCodeFenceLen,
    activeInlineCodeLen,
  }
}

/**
 * O(document length) ground truth -- always correct, just not fast for a
 * huge document. Prefer resolveMarkdownSelectionContextIncremental for any
 * call site that has a previous call's cache available (see that function's
 * doc comment); this stays around as the correctness fallback it degrades
 * to, and as direct ground truth for the fuzz test.
 */
function computeInlineStateAtOffset(text: string, offset: number): MarkdownInlineState {
  return toMarkdownInlineState(scanInlineStateFrom(text, 0, INITIAL_SCAN_STATE, offset))
}

export interface InlineStateLineCache {
  /** The document as lines. Shared representation so the edit-fed and text-diff paths agree, and so a caller holding one index can serve several caches. */
  index: DocumentLineIndex
  /** lineStartStates[i] = scan state entering line i, i.e. after fully processing lines[0..i-1]. */
  lineStartStates: InlineScanState[]
  /** Scan state after fully processing the very last line -- not one of lineStartStates (those are entering states), needed to resume when an edit purely appends new lines after every old one. */
  endState: InlineScanState
}

function buildInlineStateLineCache(text: string): InlineStateLineCache {
  const index = buildDocumentLineIndex(text)
  const lineStartStates: InlineScanState[] = new Array(index.lines.length)
  let state = INITIAL_SCAN_STATE
  for (let i = 0; i < index.lines.length; i += 1) {
    lineStartStates[i] = state
    const lineStart = index.lineStartOffsets[i]
    state = scanInlineStateFrom(text, lineStart, state, lineStart + index.lines[i].length)
  }
  return { index, lineStartStates, endState: state }
}

function computeCommonLinePrefixSuffixLen(oldLines: string[], newLines: string[]): { prefixLen: number; suffixLen: number } {
  const maxCommon = Math.min(oldLines.length, newLines.length)
  let prefixLen = 0
  while (prefixLen < maxCommon && oldLines[prefixLen] === newLines[prefixLen]) {
    prefixLen += 1
  }
  let suffixLen = 0
  const maxSuffix = maxCommon - prefixLen
  while (
    suffixLen < maxSuffix &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen += 1
  }
  return { prefixLen, suffixLen }
}

function scanStatesEqual(a: InlineScanState, b: InlineScanState): boolean {
  return (
    a.inBold === b.inBold &&
    a.inItalic === b.inItalic &&
    a.inStrikethrough === b.inStrikethrough &&
    a.activeCodeFence === b.activeCodeFence &&
    a.activeCodeFenceLen === b.activeCodeFenceLen &&
    a.activeInlineCodeLen === b.activeInlineCodeLen
  )
}

/**
 * Incremental counterpart to a full buildInlineStateLineCache: reuses the
 * previous call's per-line entering states for every line unaffected by the
 * edit, and only re-runs scanInlineStateFrom -- the expensive part -- across
 * the lines that actually changed.
 *
 * Unlike PreviewBlockSplit's block boundaries, this scan has no backward
 * hazard to guard against (nothing here ever looks behind the current
 * cursor), but it does have the same *forward*-unbounded hazard class: an
 * edit that opens or closes a fence/inline-code run changes the state
 * flowing into every following line, however far away the next real
 * terminator is. Handled the CodeMirror/incremental-tokenizer way: after
 * recomputing state forward from the edit, stop as soon as a line inside
 * the untouched trailing span produces the *same* entering state it had
 * before the edit -- from that point on, since the state matches and every
 * line's own content from here to the end is provably unchanged (per the
 * prefix/suffix line diff below), the rest of the cached states are
 * guaranteed identical to a full recompute, by this scan's own determinism.
 * If the state never restabilizes, this naturally degrades to recomputing
 * all the way to the end -- always correct, just not faster for that edit.
 *
 * Line offsets, unlike states, need no such stabilization: they're pure
 * arithmetic (this edit's total character-length delta, applied uniformly)
 * with no toggle/matching-length coupling, so the untouched trailing span's
 * offsets are unconditionally correct to shift and copy regardless of
 * whether state has stabilized yet.
 */
export function updateInlineStateLineCacheIncremental(
  text: string,
  previous: InlineStateLineCache | null,
): InlineStateLineCache {
  if (previous === null) {
    return buildInlineStateLineCache(text)
  }
  if (text === previous.index.text) {
    return previous
  }

  const oldLines = previous.index.lines
  const newLines = text.split('\n')
  const { prefixLen, suffixLen } = computeCommonLinePrefixSuffixLen(oldLines, newLines)

  const lineStartOffsets: number[] = new Array(newLines.length)
  const lineStartStates: InlineScanState[] = new Array(newLines.length)

  for (let i = 0; i < prefixLen; i += 1) {
    lineStartOffsets[i] = previous.index.lineStartOffsets[i]
    lineStartStates[i] = previous.lineStartStates[i]
  }

  let state = prefixLen < oldLines.length ? previous.lineStartStates[prefixLen] : previous.endState
  let offset = prefixLen < oldLines.length ? previous.index.lineStartOffsets[prefixLen] : previous.index.text.length + 1

  const shift = newLines.length - oldLines.length
  const suffixStartNew = newLines.length - suffixLen

  for (let i = prefixLen; i < newLines.length; i += 1) {
    if (i >= suffixStartNew) {
      const oldIndex = i - shift
      if (scanStatesEqual(state, previous.lineStartStates[oldIndex])) {
        const charDelta = text.length - previous.index.text.length
        for (let j = i; j < newLines.length; j += 1) {
          const oj = j - shift
          lineStartOffsets[j] = previous.index.lineStartOffsets[oj] + charDelta
          lineStartStates[j] = previous.lineStartStates[oj]
        }
        return { index: { text, lines: newLines, lineStartOffsets }, lineStartStates, endState: previous.endState }
      }
    }

    lineStartOffsets[i] = offset
    lineStartStates[i] = state
    const lineEnd = offset + newLines[i].length
    state = scanInlineStateFrom(text, offset, state, lineEnd)
    offset = lineEnd + 1
  }

  return { index: { text, lines: newLines, lineStartOffsets }, lineStartStates, endState: state }
}

/**
 * The same incremental update, but told exactly what changed instead of
 * having to work it out.
 *
 * `updateInlineStateLineCacheIncremental` has to reconstruct the edit from
 * two whole documents: it splits the new text into lines (~30,000 substring
 * allocations on a 1.5M-character note) and then walks both arrays comparing
 * strings, all to find the handful of lines that actually moved. That front
 * end costs more than the scan it is a prelude to.
 *
 * When the caller knows the edit -- and since the transform contract carries
 * it and CM6 hands it over, callers on the typing path now do -- neither step
 * is needed: DocumentLineIndex splices the lines in O(edit), and the changed
 * line range falls out of the edit directly.
 *
 * The stabilization argument is unchanged, and it is the load-bearing part:
 * an edit that opens or closes a fence or an inline-code run changes the
 * state entering every following line, however far away the next terminator
 * is. Scan forward from the edit and stop only once a line inside the
 * untouched trailing span produces the same entering state it had before --
 * from there the rest of the cached states are provably identical, by this
 * scan's own determinism. If state never restabilizes this degrades to a
 * full recompute: correct, just not fast for that edit.
 *
 * `previousText` is the text `edit` was computed against. It is compared
 * against the cache's own text rather than trusted, so a caller that hands
 * over a stale or mismatched edit gets the safe path instead of a corrupted
 * cache. In practice the two are the same string instance, so `===` settles
 * it on identity without walking either one.
 */
export function updateInlineStateLineCacheForEdit(
  text: string,
  previous: InlineStateLineCache | null,
  previousText: string,
  edit: EditorTextEdit,
): InlineStateLineCache {
  if (previous === null || previous.index.text !== previousText) {
    return updateInlineStateLineCacheIncremental(text, previous)
  }
  if (text === previous.index.text) return previous

  const firstLine = lineIndexAtOffset(previous.index, edit.from)
  const lastLineBefore = lineIndexAtOffset(previous.index, edit.to)
  const index = applyEditToDocumentLineIndex(previous.index, text, edit)
  const lineDelta = index.lines.length - previous.index.lines.length
  // The new lines the edit produced occupy [firstLine, replacedEnd). Only
  // past that point is a line's own content guaranteed unchanged, which is
  // the precondition the stabilization probe below relies on.
  const replacedEnd = firstLine + (lastLineBefore - firstLine + 1) + lineDelta

  const lineStartStates: InlineScanState[] = new Array(index.lines.length)
  for (let i = 0; i < firstLine; i += 1) {
    lineStartStates[i] = previous.lineStartStates[i]
  }

  let state = previous.lineStartStates[firstLine]
  for (let i = firstLine; i < index.lines.length; i += 1) {
    if (i >= replacedEnd) {
      const oldIndex = i - lineDelta
      if (scanStatesEqual(state, previous.lineStartStates[oldIndex])) {
        for (let j = i; j < index.lines.length; j += 1) {
          lineStartStates[j] = previous.lineStartStates[j - lineDelta]
        }
        return { index, lineStartStates, endState: previous.endState }
      }
    }

    lineStartStates[i] = state
    const lineStart = index.lineStartOffsets[i]
    state = scanInlineStateFrom(text, lineStart, state, lineStart + index.lines[i].length)
  }

  return { index, lineStartStates, endState: state }
}

/** Largest index i such that cache.lineStartOffsets[i] <= offset. Always well-defined (lineStartOffsets is never empty and its first entry is always 0). Equivalent to countLineIndex(cache.text, offset) whenever offset lands exactly on a line start, per updateInlineStateLineCacheIncremental's doc comment -- verified by fuzz test, not just asserted. */
function findLineIndexForOffset(cache: InlineStateLineCache, offset: number): number {
  return lineIndexAtOffset(cache.index, offset)
}

/**
 * Incremental counterpart to resolveMarkdownSelectionContext: reuses
 * `previousCache` (from this same function's previous call, or null on the
 * first call) to avoid rescanning the whole document for inline state and
 * line index on every call -- see updateInlineStateLineCacheIncremental's
 * doc comment for the caching strategy and its safety argument. Returns the
 * updated cache alongside the result; callers hold it (typically in a
 * useRef) and pass it back in on the next call.
 *
 * Always produces byte-identical results to resolveMarkdownSelectionContext
 * -- verified by MarkdownContext.test.ts's fuzz test across randomized edit
 * sequences, not just reasoned about, per this codebase's own established
 * rule for incremental/caching logic.
 */
export function resolveMarkdownSelectionContextIncremental(
  text: string,
  selection: EditorSelectionState,
  previousCache: InlineStateLineCache | null,
  /**
   * The edit that produced `text`, and the text it was computed against.
   * Optional: when a caller knows it, the cache is updated in O(edit)
   * instead of by diffing two whole documents. Passing null (or a stale
   * pair) is always safe -- it falls back to the diff, which is what every
   * caller did unconditionally before.
   */
  change?: { previousText: string; edit: EditorTextEdit } | null,
): { context: MarkdownSelectionContext; cache: InlineStateLineCache } {
  const safeText = text ?? ''
  const caretOffset = clamp(selection.focus, 0, safeText.length)
  const { lineStart, lineEndExclusive } = resolveLineBounds(safeText, caretOffset, caretOffset)
  const lineText = safeText.slice(lineStart, lineEndExclusive)
  const blockquoteDepth = resolveBlockquoteDepth(lineText)
  const headingLevel = resolveHeadingLevel(lineText)
  const listMeta = resolveListMeta(lineText)

  const cache = change
    ? updateInlineStateLineCacheForEdit(safeText, previousCache, change.previousText, change.edit)
    : updateInlineStateLineCacheIncremental(safeText, previousCache)
  const lineIndex = findLineIndexForOffset(cache, lineStart)
  const enteringState = cache.lineStartStates[lineIndex]
  const inline = toMarkdownInlineState(scanInlineStateFrom(safeText, lineStart, enteringState, caretOffset))

  return {
    context: {
      caretOffset,
      line: {
        lineStart,
        lineEndExclusive,
        lineText,
        lineIndex,
        column: caretOffset - lineStart,
        leadingWhitespaceCount: countLeadingSpaces(lineText),
        blockquoteDepth,
        headingLevel,
        listKind: listMeta.listKind,
        listIndentLevel: listMeta.listIndentLevel,
        listMarker: listMeta.listMarker,
        orderedListNumber: listMeta.orderedListNumber,
      },
      inline,
    },
    cache,
  }
}

export function resolveMarkdownSelectionContext(text: string, selection: EditorSelectionState): MarkdownSelectionContext {
  const safeText = text ?? ''
  const caretOffset = clamp(selection.focus, 0, safeText.length)
  const { lineStart, lineEndExclusive } = resolveLineBounds(safeText, caretOffset, caretOffset)
  const lineText = safeText.slice(lineStart, lineEndExclusive)
  const blockquoteDepth = resolveBlockquoteDepth(lineText)
  const headingLevel = resolveHeadingLevel(lineText)
  const listMeta = resolveListMeta(lineText)

  return {
    caretOffset,
    line: {
      lineStart,
      lineEndExclusive,
      lineText,
      lineIndex: countLineIndex(safeText, lineStart),
      column: caretOffset - lineStart,
      leadingWhitespaceCount: countLeadingSpaces(lineText),
      blockquoteDepth,
      headingLevel,
      listKind: listMeta.listKind,
      listIndentLevel: listMeta.listIndentLevel,
      listMarker: listMeta.listMarker,
      orderedListNumber: listMeta.orderedListNumber,
    },
    inline: computeInlineStateAtOffset(safeText, caretOffset),
  }
}

function resolveNextIndentCount(currentCount: number, direction: IndentDirection, step: number): number {
  const safeStep = Math.max(1, step)
  if (direction === 'indent') {
    return Math.ceil((currentCount + 1) / safeStep) * safeStep
  }
  if (currentCount <= 0) return 0
  return Math.floor((currentCount - 1) / safeStep) * safeStep
}

function mapOffsetWithinLine(
  localOffset: number,
  oldIndent: number,
  newIndent: number,
): number {
  const delta = newIndent - oldIndent
  if (localOffset <= oldIndent) {
    return clamp(localOffset + delta, 0, newIndent)
  }
  return Math.max(0, localOffset + delta)
}

export function indentSelectionByStep(
  text: string,
  selection: EditorSelectionState,
  direction: IndentDirection,
  step = 3,
): IndentationTransformResult {
  const sourceText = text ?? ''
  const safeAnchor = clamp(selection.anchor, 0, sourceText.length)
  const safeFocus = clamp(selection.focus, 0, sourceText.length)
  const safeStart = Math.min(safeAnchor, safeFocus)
  const safeEnd = Math.max(safeAnchor, safeFocus)
  const { lineStart, lineEndExclusive } = resolveLineBounds(sourceText, safeStart, safeEnd)

  const selectedBlock = sourceText.slice(lineStart, lineEndExclusive)
  const lines = selectedBlock.split('\n')

  const lineStartsInBlock: number[] = []
  let runningOffset = 0
  for (const line of lines) {
    lineStartsInBlock.push(runningOffset)
    runningOffset += line.length + 1
  }

  const transformedLines: string[] = []
  const indentDeltas: number[] = []

  for (const line of lines) {
    const oldIndent = countLeadingSpaces(line)
    const newIndent = resolveNextIndentCount(oldIndent, direction, step)
    const nextLine = `${' '.repeat(newIndent)}${line.slice(oldIndent)}`
    transformedLines.push(nextLine)
    indentDeltas.push(newIndent - oldIndent)
  }

  const nextBlock = transformedLines.join('\n')
  const nextText = `${sourceText.slice(0, lineStart)}${nextBlock}${sourceText.slice(lineEndExclusive)}`

  const mapGlobalOffset = (globalOffset: number): number => {
    if (globalOffset < lineStart) return globalOffset
    if (globalOffset > lineEndExclusive) {
      return globalOffset + (nextBlock.length - selectedBlock.length)
    }

    const offsetInBlock = globalOffset - lineStart
    let lineIndex = lines.length - 1
    for (let index = 0; index < lineStartsInBlock.length; index += 1) {
      const lineLocalStart = lineStartsInBlock[index]
      const nextLineStart = index + 1 < lineStartsInBlock.length ? lineStartsInBlock[index + 1] : Number.POSITIVE_INFINITY
      if (offsetInBlock >= lineLocalStart && offsetInBlock < nextLineStart) {
        lineIndex = index
        break
      }
    }

    const oldLineStart = lineStartsInBlock[lineIndex]
    const oldIndent = countLeadingSpaces(lines[lineIndex])
    const newIndent = oldIndent + indentDeltas[lineIndex]

    const localOffset = offsetInBlock - oldLineStart
    const mappedLocalOffset = mapOffsetWithinLine(localOffset, oldIndent, newIndent)

    let newLineStart = 0
    for (let index = 0; index < lineIndex; index += 1) {
      newLineStart += transformedLines[index].length + 1
    }

    return lineStart + newLineStart + mappedLocalOffset
  }

  const nextAnchor = clamp(mapGlobalOffset(safeAnchor), 0, nextText.length)
  const nextFocus = clamp(mapGlobalOffset(safeFocus), 0, nextText.length)

  // The edit is exactly the selected line block -- this function never
  // touches a character outside [lineStart, lineEndExclusive).
  return buildTransformResult(
    sourceText,
    { from: lineStart, to: lineEndExclusive, insert: nextBlock },
    {
      anchor: nextAnchor,
      focus: nextFocus,
      start: Math.min(nextAnchor, nextFocus),
      end: Math.max(nextAnchor, nextFocus),
      isCollapsed: nextAnchor === nextFocus,
    },
  )
}

type ParsedLineStructure = {
  leadingSpaces: string
  quotePrefix: string
  postQuoteIndent: string
  listPrefix: string | null
  listKind: MarkdownListKind
  unorderedMarker: '-' | '*' | '+' | null
  checklistPrefix: string | null
  listNumber: number | null
  listDelimiter: '.' | ')' | null
  contentAfterPrefixes: string
}

function parseLineStructure(lineText: string): ParsedLineStructure {
  const leadingSpacesMatch = lineText.match(/^(\s*)/)
  const leadingSpaces = leadingSpacesMatch ? leadingSpacesMatch[1] : ''
  let remainder = lineText.slice(leadingSpaces.length)

  let quotePrefix = ''
  while (remainder.startsWith('>')) {
    quotePrefix += '>'
    remainder = remainder.slice(1)
    if (remainder.startsWith(' ')) {
      quotePrefix += ' '
      remainder = remainder.slice(1)
    }
  }

  const postQuoteIndentMatch = remainder.match(/^(\s*)/)
  const postQuoteIndent = postQuoteIndentMatch ? postQuoteIndentMatch[1] : ''
  remainder = remainder.slice(postQuoteIndent.length)

  const unorderedMatch = remainder.match(/^([-*+])\s+/)
  if (unorderedMatch) {
    const afterListPrefix = remainder.slice(unorderedMatch[0].length)
    const checklistMatch = afterListPrefix.match(/^(\[[^\]\n\r]\])\s+/)
    const checklistPrefix = checklistMatch ? `${checklistMatch[1]} ` : null

    return {
      leadingSpaces,
      quotePrefix,
      postQuoteIndent,
      listPrefix: unorderedMatch[0],
      listKind: 'unordered',
      unorderedMarker: unorderedMatch[1] as '-' | '*' | '+',
      checklistPrefix,
      listNumber: null,
      listDelimiter: null,
      contentAfterPrefixes: checklistMatch
        ? afterListPrefix.slice(checklistMatch[0].length)
        : afterListPrefix,
    }
  }

  const orderedMatch = remainder.match(/^(\d+)([.)])\s+/)
  if (orderedMatch) {
    return {
      leadingSpaces,
      quotePrefix,
      postQuoteIndent,
      listPrefix: orderedMatch[0],
      listKind: 'ordered',
      unorderedMarker: null,
      checklistPrefix: null,
      listNumber: Number.parseInt(orderedMatch[1], 10),
      listDelimiter: orderedMatch[2] as '.' | ')',
      contentAfterPrefixes: remainder.slice(orderedMatch[0].length),
    }
  }

  return {
    leadingSpaces,
    quotePrefix,
    postQuoteIndent,
    listPrefix: null,
    listKind: null,
    unorderedMarker: null,
    checklistPrefix: null,
    listNumber: null,
    listDelimiter: null,
    contentAfterPrefixes: `${postQuoteIndent}${remainder}`,
  }
}

/**
 * Whether `caretOffset` sits inside a fenced code block.
 *
 * With a cache current for `text`, this costs one binary search plus a scan
 * of the caret's own line. Without one it falls back to the O(document)
 * ground truth. Both produce the same answer -- the cached path is the same
 * scan, resumed from a state the cache already proved correct (see
 * updateInlineStateLineCacheIncremental's stabilization argument and its
 * fuzz tests).
 */
function resolveInFencedCodeBlock(
  text: string,
  caretOffset: number,
  lineStart: number,
  inlineCache: InlineStateLineCache | null | undefined,
): boolean {
  if (!inlineCache || inlineCache.index.text !== text) {
    return computeInlineStateAtOffset(text, caretOffset).inFencedCodeBlock
  }
  const lineIndex = lineIndexAtOffset(inlineCache.index, lineStart)
  const entering = inlineCache.lineStartStates[lineIndex]
  return toMarkdownInlineState(scanInlineStateFrom(text, lineStart, entering, caretOffset)).inFencedCodeBlock
}

/**
 * Whether `offset` sits inside a fenced code block -- the public form of
 * resolveInFencedCodeBlock, for callers that have an offset but not its
 * line start. Same cost rules: cheap with a cache current for `text`, the
 * O(document) ground truth without one.
 */
export function isOffsetInFencedCodeBlock(
  text: string,
  offset: number,
  inlineCache: InlineStateLineCache | null | undefined,
): boolean {
  const lineStart = offset <= 0 ? 0 : text.lastIndexOf('\n', offset - 1) + 1
  return resolveInFencedCodeBlock(text, offset, lineStart, inlineCache)
}

export function applyMarkdownEnter(
  text: string,
  selection: EditorSelectionState,
  /**
   * Optional, and the difference between O(line) and O(document) per press.
   *
   * Of everything resolveMarkdownSelectionContext used to compute for this
   * function, exactly four fields were read: `inFencedCodeBlock` and the
   * caret line's bounds and text. The line bounds are O(line) already. The
   * fence flag was the only genuinely document-wide input -- and it arrived
   * via computeInlineStateAtOffset, a character-by-character scan from
   * offset 0 to the caret, tracking bold, italic, strikethrough and
   * inline-code runs, of which one boolean survived. `countLineIndex`, also
   * O(document), was computed and discarded entirely.
   *
   * When a caller holds a current inline-state cache, the fence flag comes
   * from the caret line's cached entering state plus a scan of that one
   * line. The cache is verified against `text` rather than trusted; a stale
   * or absent one falls back to the full scan, which is what every call did
   * unconditionally before.
   */
  inlineCache?: InlineStateLineCache | null,
): EnterKeyTransformResult | null {
  if (!selection.isCollapsed) return null

  const sourceText = text ?? ''
  const caretOffset = clamp(selection.focus, 0, sourceText.length)
  const { lineStart, lineEndExclusive } = resolveLineBounds(sourceText, caretOffset, caretOffset)
  const context = {
    line: { lineStart, lineEndExclusive, lineText: sourceText.slice(lineStart, lineEndExclusive) },
  }

  if (resolveInFencedCodeBlock(sourceText, caretOffset, lineStart, inlineCache)) {
    return null
  }

  const lineText = context.line.lineText
  const lineStructure = parseLineStructure(lineText)
  const basePrefix = `${lineStructure.leadingSpaces}${lineStructure.quotePrefix}${lineStructure.postQuoteIndent}`

  const isEmptyListItem =
    lineStructure.listKind !== null &&
    lineStructure.contentAfterPrefixes.trim().length === 0

  if (isEmptyListItem) {
    return buildTransformResult(
      sourceText,
      { from: context.line.lineStart, to: context.line.lineEndExclusive, insert: '' },
      collapsedSelectionAt(context.line.lineStart),
    )
  }

  let inserted = '\n'
  let isListContinuation = false

  if (lineStructure.listKind === 'unordered') {
    const marker = lineStructure.unorderedMarker ?? '-'
    const checklistPrefix = lineStructure.checklistPrefix !== null ? '[ ] ' : ''
    inserted = `\n${basePrefix}${marker} ${checklistPrefix}`
    isListContinuation = true
  } else if (
    lineStructure.listKind === 'ordered' &&
    lineStructure.listNumber !== null &&
    lineStructure.listDelimiter !== null
  ) {
    inserted = `\n${basePrefix}${lineStructure.listNumber + 1}${lineStructure.listDelimiter} `
    isListContinuation = true
  } else if (lineStructure.quotePrefix.length > 0) {
    inserted = `\n${basePrefix}`
  } else if (lineStructure.leadingSpaces.length > 0) {
    const linePrefixBeforeCaret = sourceText.slice(context.line.lineStart, caretOffset)
    const newLineIndent = lineText.trim().length === 0
      ? ' '.repeat(countLeadingSpaces(linePrefixBeforeCaret))
      : lineStructure.leadingSpaces

    inserted = `\n${newLineIndent}`
  }
  // else: plain line with no list/quote/indent — plain newline insert.
  // We handle this ourselves rather than returning null and falling through to Lexical's
  // native paragraph-split. Lexical's native Enter at the start of a paragraph places
  // the caret on the newly-created empty paragraph before the content, whereas our
  // canonical model inserts '\n' and advances the caret past it, keeping it at the
  // start of the content line. The difference is only observable at column 0, which is
  // exactly the case that causes the delete→enter bug: after deleting an empty line the
  // caret sits at column 0 of the following line, and native Enter re-creates the empty
  // line with the caret on it instead of keeping the caret on the content line.

  const restOfLine = sourceText.slice(caretOffset, context.line.lineEndExclusive)
  const sanitizedRestOfLine = isListContinuation ? stripListContinuationArtifacts(restOfLine) : restOfLine

  return buildTransformResult(
    sourceText,
    {
      from: caretOffset,
      to: context.line.lineEndExclusive,
      insert: `${inserted}${sanitizedRestOfLine}`,
    },
    collapsedSelectionAt(caretOffset + inserted.length),
  )
}
