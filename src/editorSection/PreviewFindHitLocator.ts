import type { DocumentFindHit } from '../editor/FindReplaceEngine'

/**
 * Mirrors PreviewVisibleText.ts's BLOCK_NODE_TYPES on the DOM side: walking
 * a rendered element's text nodes has to insert the same block separators
 * the source-side projection did, or the two disagree about whether a match
 * spans a block boundary and their occurrence counts drift apart.
 */
const PREVIEW_BLOCK_LEVEL_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,blockquote,pre,li,td,th,tr,table,hr,div'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

interface PreviewTextSegment {
  node: Text
  start: number
  end: number
}

export interface PreviewElementVisibleText {
  text: string
  segments: PreviewTextSegment[]
}

/** Aggregates one rendered element's visible text, block-separated exactly the way the source-side projection is. */
export function collectPreviewElementVisibleText(root: HTMLElement): PreviewElementVisibleText {
  const segments: PreviewTextSegment[] = []
  let text = ''
  let previousBlockAncestor: Element | null = null

  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const value = node.nodeValue
    if (value && value.length > 0) {
      const blockAncestor = node.parentElement?.closest(PREVIEW_BLOCK_LEVEL_SELECTOR) ?? null
      if (text.length > 0 && blockAncestor !== previousBlockAncestor && !text.endsWith('\n')) {
        text += '\n'
      }
      previousBlockAncestor = blockAncestor
      const start = text.length
      text += value
      segments.push({ node: node as Text, start, end: text.length })
    }
    node = walker.nextNode()
  }

  return { text, segments }
}

/** 0-indexed source line containing `offset` -- the same line convention createPreviewSourceAnchorRehypePlugin stamps onto rendered elements. */
export function resolveSourceLineForOffset(text: string, offset: number): number {
  const clamped = clamp(offset, 0, text.length)
  let line = 0
  for (let index = 0; index < clamped; index += 1) {
    if (text.charCodeAt(index) === 10) line += 1
  }
  return line
}

/** Source offset range [start, end) covered by 0-indexed lines [startLine, endLine]. */
export function resolveSourceOffsetRangeForLines(
  text: string,
  startLine: number,
  endLine: number,
): { start: number; end: number } {
  let line = 0
  let index = 0
  while (line < startLine && index < text.length) {
    if (text.charCodeAt(index) === 10) line += 1
    index += 1
  }
  const start = index
  while (line <= endLine && index < text.length) {
    if (text.charCodeAt(index) === 10) line += 1
    index += 1
  }
  return { start, end: line <= endLine ? text.length : index }
}

/**
 * Rendered elements covering `sourceLine`, tightest first. Every ancestor
 * covering a line claims it (an `li` and the `p` inside it both do), and the
 * narrowest one localizes a match best -- wider ones stay as fallbacks for a
 * match the tightest element doesn't actually contain.
 */
export function findPreviewElementsForSourceLine(scroller: HTMLElement, sourceLine: number): HTMLElement[] {
  const candidates: { element: HTMLElement; span: number }[] = []
  scroller.querySelectorAll<HTMLElement>('[data-source-line-start]').forEach((element) => {
    const startLine = Number(element.dataset.sourceLineStart)
    const endLine = Number(element.dataset.sourceLineEnd ?? element.dataset.sourceLineStart)
    if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return
    if (sourceLine < startLine || sourceLine > endLine) return
    candidates.push({ element, span: endLine - startLine })
  })
  candidates.sort((left, right) => left.span - right.span)
  return candidates.map((candidate) => candidate.element)
}

export interface ResolvePreviewHitRangeOptions {
  /** The preview pane's scroll container -- only its currently mounted blocks are searched. */
  scroller: HTMLElement
  /** The note's normalized markdown source, used to turn line numbers back into offsets. */
  sourceText: string
  /** The hit being jumped to. */
  hit: DocumentFindHit
  /** The full preview hit list, used to work out which occurrence within its own block this hit is. */
  hits: DocumentFindHit[]
  needle: string
  caseSensitive: boolean
}

/**
 * Resolves a find hit to a DOM range inside the rendered pane.
 *
 * Deliberately *not* "the Nth occurrence of the needle in the pane's text",
 * which is what the preview jump used to do and why clicking a card could
 * land on a different match. That ordinal was wrong twice over: the hit list
 * came from the markdown source, where invisible syntax (`[anchor](#anchor)`)
 * contributes matches the rendered text doesn't have, shifting every later
 * hit's ordinal; and the pane is virtualized, so a DOM walk only ever sees
 * the mounted window, making "the Nth match in the DOM" a different match
 * from "the Nth match in the document" for anything below the fold.
 *
 * Instead the hit's own source line picks the block that owns it, and the
 * ordinal used is local to that one block -- counted over the hit list,
 * which in preview mode is itself restricted to visible text, so it stays
 * consistent with what the reader sees highlighted. Returns null when the
 * owning block isn't mounted (the caller scrolls it into range and retries).
 */
export function resolvePreviewHitRange({
  scroller,
  sourceText,
  hit,
  hits,
  needle,
  caseSensitive,
}: ResolvePreviewHitRangeOptions): Range | null {
  if (!needle) return null

  const compareNeedle = caseSensitive ? needle : needle.toLocaleLowerCase()
  const hitVisibleIndex = hit.visibleIndex ?? hit.index
  const sourceLine = resolveSourceLineForOffset(sourceText, hit.index)

  for (const element of findPreviewElementsForSourceLine(scroller, sourceLine)) {
    const startLine = Number(element.dataset.sourceLineStart)
    const endLine = Number(element.dataset.sourceLineEnd ?? element.dataset.sourceLineStart)
    const sourceRange = resolveSourceOffsetRangeForLines(sourceText, startLine, endLine)

    const localOrdinal = hits.reduce((count, candidate) => {
      if (candidate.index < sourceRange.start || candidate.index >= sourceRange.end) return count
      return (candidate.visibleIndex ?? candidate.index) < hitVisibleIndex ? count + 1 : count
    }, 0)

    const { text, segments } = collectPreviewElementVisibleText(element)
    if (segments.length === 0) continue
    const haystack = caseSensitive ? text : text.toLocaleLowerCase()

    let occurrence = -1
    let cursor = 0
    let found = true
    for (let index = 0; index <= localOrdinal; index += 1) {
      const foundIndex = haystack.indexOf(compareNeedle, cursor)
      if (foundIndex < 0) {
        found = false
        break
      }
      occurrence = foundIndex
      cursor = foundIndex + Math.max(1, compareNeedle.length)
    }
    if (!found || occurrence < 0) continue

    const occurrenceEnd = occurrence + Math.max(1, compareNeedle.length)
    const startSegment = segments.find((segment) => occurrence >= segment.start && occurrence < segment.end)
    if (!startSegment) continue
    const endSegment = segments.find((segment) => occurrenceEnd > segment.start && occurrenceEnd <= segment.end) ?? startSegment

    const startOffsetInNode = clamp(occurrence - startSegment.start, 0, startSegment.node.nodeValue?.length ?? 0)
    const endOffsetInNode = clamp(
      occurrenceEnd - endSegment.start,
      startSegment === endSegment ? startOffsetInNode : 0,
      endSegment.node.nodeValue?.length ?? 0,
    )

    const range = element.ownerDocument.createRange()
    range.setStart(startSegment.node, startOffsetInNode)
    range.setEnd(endSegment.node, endOffsetInNode)
    return range
  }

  return null
}
