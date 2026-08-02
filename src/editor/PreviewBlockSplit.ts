import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'

// Loose structural shape for mdast nodes -- mirrors the RehypeAstNode
// pattern in PreviewMarkdown.tsx rather than pulling in full mdast types,
// since this only ever reads `type`/`position`/`children`.
interface MdastAstNode {
  type: string
  position?: { start?: { line?: number }; end?: { line?: number } }
  children?: MdastAstNode[]
}

// Parse-only: no remark-rehype/rehype-react in this pipeline, so this never
// does any of the expensive work (hast construction, React element
// creation) -- just enough to learn where remark itself draws top-level
// block boundaries. Uses the same remark-gfm config as the real per-block
// ReactMarkdown calls (PREVIEW_MARKDOWN_REMARK_PLUGINS) so the boundaries
// this derives are guaranteed to match how each slice re-parses in isolation.
const structuralProcessor = unified().use(remarkParse).use(remarkGfm).freeze()

const DEFINITION_NODE_TYPES = new Set(['definition', 'footnoteDefinition'])

export interface PreviewMarkdownBlock {
  text: string
  /** 0-indexed absolute start line within the full document -- same convention createPreviewSourceAnchorRehypePlugin already uses (remark's 1-indexed line minus 1). */
  startLine: number
}

/**
 * One top-level structural range -- just the line span remark assigned a
 * top-level node, before definition-text propagation turns it into a
 * materialized block. The unit of incremental reuse in
 * splitMarkdownIntoPreviewBlocksIncremental below.
 */
interface PreviewBlockRange {
  type: string
  /** 1-indexed, inclusive. */
  rangeStartLine1: number
  rangeEndLine1: number
}

/**
 * Runs remark far enough to learn top-level block boundaries for `text`
 * (already split into `lines`). A document with 0 or 1 top-level nodes
 * collapses to one synthetic range spanning every line -- not just up to
 * the node's own end position -- so trailing blank lines survive verbatim
 * instead of being trimmed by remark's own position tracking; this matches
 * what a plain single-block document round-trips to today.
 *
 * Every range's *start* absorbs blank lines between it and the previous
 * range (previousEndLine1 + 1), so leading blank lines belong to whichever
 * node comes after them. Nothing symmetric exists for the very last node,
 * though: trailing blank lines *after* it have no next node to belong to.
 * Real documents routinely end in a trailing newline (or several), so
 * without this the last range silently stops short of `lineCount` -- always
 * true, not an edge case -- which breaks two things: fullSplit's
 * materialized blocks lose real trailing whitespace, and
 * splitMarkdownIntoPreviewBlocksIncremental's contiguity invariant
 * (ranges must tile exactly to `lineCount`) permanently fails for any edit
 * whose kept tail includes this node, forcing a full reparse on every
 * single keystroke forever -- found live on a real ~1.5M-character note
 * ending in "...Yes.\n\n". Force the last range to reach `lineCount`
 * unconditionally, the same way the single-node case already does above.
 */
function parseStructuralRanges(text: string, lineCount: number): PreviewBlockRange[] {
  const root = structuralProcessor.parse(text) as MdastAstNode
  const children = root.children ?? []

  if (children.length <= 1) {
    return [{ type: children[0]?.type ?? '', rangeStartLine1: 1, rangeEndLine1: lineCount }]
  }

  return children.map((node, index) => {
    const previousEndLine1 = index === 0 ? 0 : (children[index - 1].position?.end?.line ?? 0)
    const ownEndLine1 = node.position?.end?.line ?? previousEndLine1
    const rangeStartLine1 = Math.max(previousEndLine1 + 1, 1)
    const isLast = index === children.length - 1
    const rangeEndLine1 = isLast
      ? Math.max(rangeStartLine1, ownEndLine1, lineCount)
      : Math.max(rangeStartLine1, ownEndLine1)
    return { type: node.type, rangeStartLine1, rangeEndLine1 }
  })
}

/**
 * Turns structural ranges into materialized preview blocks: slices each
 * range's own text out of `lines`, and appends every link-reference /
 * footnote definition found anywhere in the document to every block that
 * isn't itself a definition (see splitMarkdownIntoPreviewBlocks' doc
 * comment for why). Pure string/array work over the ranges given -- no
 * remark parsing -- so this stays cheap even though it touches the whole
 * document's lines every call.
 */
function materializeBlocks(ranges: PreviewBlockRange[], lines: string[]): PreviewMarkdownBlock[] {
  const definitionTextByIndex = new Map<number, string>()
  ranges.forEach(({ type, rangeStartLine1, rangeEndLine1 }, index) => {
    if (DEFINITION_NODE_TYPES.has(type)) {
      definitionTextByIndex.set(index, lines.slice(rangeStartLine1 - 1, rangeEndLine1).join('\n'))
    }
  })

  if (definitionTextByIndex.size === 0) {
    return ranges.map(({ rangeStartLine1, rangeEndLine1 }) => ({
      text: lines.slice(rangeStartLine1 - 1, rangeEndLine1).join('\n'),
      startLine: rangeStartLine1 - 1,
    }))
  }

  const allDefinitionsText = Array.from(definitionTextByIndex.values()).join('\n\n')

  return ranges.map(({ rangeStartLine1, rangeEndLine1 }, index) => {
    const ownText = lines.slice(rangeStartLine1 - 1, rangeEndLine1).join('\n')
    const text = definitionTextByIndex.has(index) ? ownText : `${ownText}\n\n${allDefinitionsText}`
    return { text, startLine: rangeStartLine1 - 1 }
  })
}

function fullSplit(text: string): PreviewBlockSplitCache {
  const lines = text.split('\n')
  const ranges = parseStructuralRanges(text, lines.length)
  return { text, ranges, blocks: materializeBlocks(ranges, lines) }
}

/** Schema version for PersistedPreviewBlockCache. Bump whenever the range/block shape changes. */
export const PREVIEW_BLOCK_CACHE_VERSION = 1

/**
 * Reconstructs a PreviewBlockSplitCache from a persisted range-only record
 * and the note's current text. The persisted cache intentionally omits
 * block text and relies on the caller to supply the exact normalized text
 * the cache was computed for (verified via textHash/contentChecksum).
 */
export function restorePreviewBlockSplitCacheFromRanges(
  text: string,
  ranges: Array<Pick<PreviewBlockRange, 'type' | 'rangeStartLine1' | 'rangeEndLine1'>>,
): PreviewBlockSplitCache {
  const lines = text.split('\n')
  return {
    text,
    ranges: ranges as PreviewBlockRange[],
    blocks: materializeBlocks(ranges as PreviewBlockRange[], lines),
  }
}

/**
 * Ranges must exactly tile 1..totalLines with no gaps or overlaps. Defensive
 * check on the incremental splice below -- should always hold by
 * construction; if it somehow doesn't, falling back to a full reparse is
 * strictly safer than trusting a broken splice.
 */
function rangesAreContiguous(ranges: PreviewBlockRange[], totalLines: number): boolean {
  if (ranges.length === 0) return totalLines === 0
  if (ranges[0].rangeStartLine1 !== 1) return false
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i].rangeStartLine1 !== ranges[i - 1].rangeEndLine1 + 1) return false
  }
  return ranges[ranges.length - 1].rangeEndLine1 === totalLines
}

/**
 * Splits markdown source into independently-renderable top-level blocks
 * (paragraphs, headings, lists, tables, code fences, blockquotes, ...) at
 * remark's own block boundaries, so a "loose" list or a multi-line table is
 * never split apart mid-construct.
 *
 * This is the unit of memoization for the preview pane: as long as a
 * block's own text is unchanged, React.memo on PreviewMarkdownBlock skips
 * that block's ReactMarkdown parse + hast-to-react conversion entirely.
 * Editing inside one paragraph then costs O(1), not O(document length), for
 * that *reconciliation* step; only an edit that changes the document's own
 * block count/order (Enter, deleting a whole line) forces the blocks after
 * the edit point to re-render, since their absolute position shifted.
 *
 * Link-reference definitions (`[label]: url`) and footnote definitions
 * (`[^id]: text`) resolve document-wide under CommonMark/GFM, not scoped to
 * whichever block happens to contain them. Every other block gets them
 * appended (a definition unreferenced by that block's own text renders
 * nothing, per GFM's footnote handling only emitting entries that are
 * actually referenced) so cross-block references and footnotes keep
 * working the same as a single whole-document parse would. One visible
 * difference: footnote definitions render immediately after whichever
 * block references them, rather than aggregated once at the document's end.
 *
 * This does a full remark parse of `text` every call -- O(document length)
 * with a real constant factor (measured: ~1.6-4.6s on a ~12,000-line note).
 * Called on every keystroke (see usePreviewMarkdownRendering.tsx), that
 * makes this the dominant cost for editing large documents -- more so than
 * anything in ContractBridgePlugin.tsx. Prefer
 * splitMarkdownIntoPreviewBlocksIncremental for any call site that has a
 * previous call's result available; this whole-document version stays
 * around as the correctness fallback that one degrades to, and as direct
 * ground truth for tests.
 */
export function splitMarkdownIntoPreviewBlocks(text: string): PreviewMarkdownBlock[] {
  return fullSplit(text).blocks
}

export interface PreviewBlockSplitCache {
  text: string
  ranges: PreviewBlockRange[]
  blocks: PreviewMarkdownBlock[]
}

function shiftRange(range: PreviewBlockRange, delta: number): PreviewBlockRange {
  return { type: range.type, rangeStartLine1: range.rangeStartLine1 + delta, rangeEndLine1: range.rangeEndLine1 + delta }
}

/**
 * Incremental counterpart to splitMarkdownIntoPreviewBlocks: reuses the
 * previous call's structural ranges for any leading/trailing span of
 * top-level blocks provably unaffected by the edit, and only re-runs
 * remark's parser -- the expensive part -- across the span that changed,
 * plus one full neighboring block on each side as adjacency buffer.
 *
 * Why a whole neighboring block on the *head* side, not just the changed
 * lines: CommonMark has a class of block-level construct whose meaning
 * depends on the single line immediately after it -- a setext heading's
 * `===`/`---` underline turning the preceding paragraph into a heading; a
 * list marker "interrupting" a paragraph or not, per CommonMark's interrupt
 * rules. That backward dependency never reaches further than one line, and
 * a lazy-continuation span (a loose list's items, a blockquote absorbing a
 * following plain line) is always fully contained within a *single*
 * top-level range already, by construction of the full parse that produced
 * it. So including the entire adjacent head range (always more than the one
 * line that dependency can reach) directly in the reparsed window gives
 * remark the exact same context a full-document parse would have had, and
 * its classification of that boundary is identical either way -- verified,
 * not just assumed, by the fuzz test below finding no counterexample across
 * hundreds of randomized edit sequences including exactly this construct.
 *
 * The *tail* side needs an extra step, because it's not symmetric: CommonMark
 * block parsing is a forward single pass, and some constructs are
 * forward-*unbounded* -- an unclosed code fence or HTML block keeps
 * absorbing lines until it finds its own terminator, however far away that
 * is. An edit to a fence's own delimiter line can turn a previously-closed
 * fence into one that now swallows everything up to the next real closing
 * fence, however many ranges later that falls -- not bounded to one
 * neighboring range the way setext/interrupt is. (This was caught live by
 * the fuzz test, not reasoned out in advance -- see PreviewBlockSplit.test.ts;
 * an earlier version of this function trusted the one-range tail buffer the
 * same way as the head side, which is the exact class of assumption this
 * codebase has been burned by before, per the project's large-document perf
 * handover notes.) So before trusting the tail buffer's cached ranges,
 * probe by reparsing the window together with just the next cached tail
 * range and checking the boundary between them still falls in the same
 * place. If it doesn't, something in the window reaches further than
 * assumed and this call falls back to a full reparse -- always correct,
 * just not faster for that one keystroke.
 *
 * Falls back to a full splitMarkdownIntoPreviewBlocks() pass -- always
 * correct, just not faster -- whenever there's no previous result, no
 * usable unchanged span, the tail-boundary probe fails, or the spliced
 * ranges fail the contiguity check (defensive; should never trigger given
 * the above, but a broken splice is worse than a slow one).
 */
/** Throwaway diagnostic for the incremental-split fallback investigation -- see CM6Editor.tsx's debugInputLagEnabled. */
function debugLogFallback(reason: string): void {
  if (typeof window === 'undefined') return
  if (window.localStorage.getItem('thockdown:debug-input-lag') !== '1') return
  console.log(`[input-lag] splitMarkdownIntoPreviewBlocksIncremental -> fullSplit (${reason})`)
}

export function splitMarkdownIntoPreviewBlocksIncremental(
  text: string,
  previous: PreviewBlockSplitCache | null,
): PreviewBlockSplitCache {
  if (previous === null) {
    debugLogFallback('no previous cache')
    return fullSplit(text)
  }
  if (text === previous.text) {
    return previous
  }

  const oldLines = previous.text.split('\n')
  const newLines = text.split('\n')
  const ranges = previous.ranges

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

  // Ranges entirely within the common prefix/suffix -- none of their own
  // lines changed.
  let headRangeCount = 0
  while (headRangeCount < ranges.length && ranges[headRangeCount].rangeEndLine1 <= prefixLen) {
    headRangeCount += 1
  }
  const oldSuffixStartLine1 = oldLines.length - suffixLen + 1
  let tailRangeCount = 0
  while (
    tailRangeCount < ranges.length - headRangeCount &&
    ranges[ranges.length - 1 - tailRangeCount].rangeStartLine1 >= oldSuffixStartLine1
  ) {
    tailRangeCount += 1
  }

  // Peel one more range off each side as adjacency buffer (see doc comment
  // above) before deciding what's actually safe to keep verbatim.
  const headKeepCount = Math.max(0, headRangeCount - 1)
  const tailKeepCount = Math.max(0, tailRangeCount - 1)

  if (headKeepCount === 0 && tailKeepCount === 0) {
    // Nothing safely reusable -- not worth the bookkeeping over a full reparse.
    debugLogFallback(`headKeepCount=0 tailKeepCount=0 (headRangeCount=${headRangeCount} tailRangeCount=${tailRangeCount} totalRanges=${ranges.length} prefixLen=${prefixLen} suffixLen=${suffixLen})`)
    return fullSplit(text)
  }

  const shift = newLines.length - oldLines.length
  const headRanges = ranges.slice(0, headKeepCount)
  const tailRanges = ranges.slice(ranges.length - tailKeepCount).map((range) => shiftRange(range, shift))

  const windowStartLine1 = headKeepCount > 0 ? ranges[headKeepCount - 1].rangeEndLine1 + 1 : 1
  const oldWindowEndLine1 = tailKeepCount > 0
    ? ranges[ranges.length - tailKeepCount].rangeStartLine1 - 1
    : oldLines.length
  const windowEndLine1 = oldWindowEndLine1 + shift

  const windowLines = newLines.slice(windowStartLine1 - 1, windowEndLine1)

  // Tail-boundary stability probe -- see doc comment above for why this is
  // required (asymmetric with the head side) and sufficient (any real
  // instability shows up as soon as *any* further real content is added,
  // regardless of how far away the construct's true resolution lies).
  //
  // parseStructuralRanges assigns each node's range as "right after the
  // previous range ends" through its own true end line -- so blank lines
  // *before* a node get absorbed backward into that node's range. That
  // convention only tiles correctly when computed with the real neighboring
  // context present. A window parsed in isolation has no next node to
  // absorb its own trailing blank lines into, so those get silently
  // dropped, breaking contiguity against tailRanges even when the probe
  // above (which *does* include that context) confirms the boundary is
  // structurally stable. Reuse the probe's own ranges for the window's
  // coverage instead of re-deriving it from a context-free parse that
  // disagrees with the probe by construction, not by chance.
  let windowRanges: PreviewBlockRange[]
  if (tailRanges.length > 0) {
    const nextTailRange = tailRanges[0]
    const nextTailLines = newLines.slice(nextTailRange.rangeStartLine1 - 1, nextTailRange.rangeEndLine1)
    const probeLines = [...windowLines, ...nextTailLines]
    const probeRanges = parseStructuralRanges(probeLines.join('\n'), probeLines.length)
    const boundaryHolds = probeRanges.some((range) => range.rangeEndLine1 === windowLines.length)
    if (!boundaryHolds) {
      debugLogFallback(`tail-boundary probe failed (windowLines=${windowLines.length})`)
      return fullSplit(text)
    }
    windowRanges = probeRanges
      .filter((range) => range.rangeEndLine1 <= windowLines.length)
      .map((range) => shiftRange(range, windowStartLine1 - 1))
  } else {
    windowRanges = parseStructuralRanges(windowLines.join('\n'), windowLines.length)
      .map((range) => shiftRange(range, windowStartLine1 - 1))
  }

  const nextRanges = [...headRanges, ...windowRanges, ...tailRanges]

  if (!rangesAreContiguous(nextRanges, newLines.length)) {
    debugLogFallback(`ranges not contiguous (windowLines=${windowLines.length} headKeepCount=${headKeepCount} tailKeepCount=${tailKeepCount})`)
    debugLogFallback(`  headRanges[0]: ${JSON.stringify(headRanges[0])}`)
    debugLogFallback(`  headRanges tail: ${JSON.stringify(headRanges.slice(-2))}`)
    debugLogFallback(`  windowRanges: ${JSON.stringify(windowRanges)}`)
    debugLogFallback(`  tailRanges head: ${JSON.stringify(tailRanges.slice(0, 2))}`)
    debugLogFallback(`  tailRanges last: ${JSON.stringify(tailRanges[tailRanges.length - 1])}`)
    debugLogFallback(`  windowStartLine1=${windowStartLine1} windowEndLine1=${windowEndLine1} totalLines=${newLines.length}`)
    // Pinpoint the exact adjacent pair that breaks tiling, scanning the
    // assembled array directly rather than guessing from the head/tail/
    // window pieces in isolation.
    for (let i = 1; i < nextRanges.length; i += 1) {
      if (nextRanges[i].rangeStartLine1 !== nextRanges[i - 1].rangeEndLine1 + 1) {
        debugLogFallback(`  gap/overlap at index ${i}: prev=${JSON.stringify(nextRanges[i - 1])} next=${JSON.stringify(nextRanges[i])}`)
      }
    }
    if (nextRanges[0]?.rangeStartLine1 !== 1) {
      debugLogFallback(`  first range doesn't start at line 1: ${JSON.stringify(nextRanges[0])}`)
    }
    if (nextRanges[nextRanges.length - 1]?.rangeEndLine1 !== newLines.length) {
      debugLogFallback(`  last range doesn't reach totalLines: ${JSON.stringify(nextRanges[nextRanges.length - 1])}`)
    }
    return fullSplit(text)
  }

  return { text, ranges: nextRanges, blocks: materializeBlocks(nextRanges, newLines) }
}
