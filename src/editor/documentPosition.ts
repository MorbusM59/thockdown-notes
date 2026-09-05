// Where the reader is in a document, and what the scrollbar should show for it.
//
// ## Why there are two answers
//
// A scrollbar asks two questions: how far through the document am I, and how
// much of it is on screen. Both have an exact answer when the document's
// rendered height is known -- and that is precisely what is not known for a
// large document, because knowing it means rendering every block nobody has
// looked at yet. Every symptom this area has ever had comes from answering a
// pixel question with a pixel estimate: a thumb that creeps while heights are
// discovered, a thumb that jumps when the font changes, an end-of-document
// that is wrong until it is measured.
//
// So there are two strategies, chosen by document size, and the scrollbar is
// told neither of them:
//
//   CONTINUOUS  (below CONTINUOUS_DOCUMENT_MAX_CHARS)
//     Every block is measured, so scrollHeight is the truth and the standard
//     scrollbar identity is exact. Nothing is estimated and nothing settles.
//
//   CHUNKED     (at or above it)
//     Blocks are rendered on demand and their heights are modelled, never
//     surveyed. Position is a CHARACTER OFFSET -- a location in the source,
//     which no layout can move -- and the pixel substrate underneath is only
//     ever a means of scrolling, never a source of truth.
//
// ## The scrollbar deals in ratios, and only in ratios
//
// That is what keeps the two strategies from leaking. A ratio is the one
// currency both can quote honestly, and it is also the currency the scrollbar
// natively thinks in: a thumb sits at a fraction of its track and occupies a
// fraction of it. A caller that could ask "which character am I on" would
// eventually branch on the answer, and then there would be two scrollbars
// again.

/**
 * The size above which a document is chunked rather than measured.
 *
 * A threshold, not a law of nature: below it, rendering and measuring the
 * whole document is cheap enough that being exact costs less than being
 * clever. Exposed as a constant because it is a plausible thing to want to
 * tune later, and because both the renderer and the scrollbar have to agree
 * on it -- a document rendered one way and described the other would be a
 * scrollbar that lies.
 */
export const CONTINUOUS_DOCUMENT_MAX_CHARS = 50000


/** Whether a document of this length gets the exact treatment. */
export function isContinuousDocument(charCount: number): boolean {
  return charCount < CONTINUOUS_DOCUMENT_MAX_CHARS
}

/**
 * How the scrollbar reads and writes position, whatever the unit underneath.
 *
 * Every method may answer null, meaning "not yet" rather than "zero" -- a
 * scrollbar handed zeroes draws a wrong thumb confidently, where one told
 * nothing keeps the last thing it drew.
 */
export interface DocumentPosition {
  /** How far through the document the viewport sits, 0..1. */
  readScrollRatio: () => number | null
  /** How much of the document one screen holds, 0..1. */
  readThumbRatio: () => number | null
  /**
   * Whether `readThumbRatio` is done changing its mind.
   *
   * A ratio can be a real answer and still not be the FINAL one: a continuous
   * document's is read off `scrollHeight`, which is only the truth once every
   * block has actually been measured, and before that it is an estimate that
   * happens to be a number. A caller that commits to the thumb's size (see
   * editor/scrollThumbMetrics.ts) has to know the difference, or it freezes
   * the estimate and the exactness a small document is entitled to is lost --
   * measured at 79px against a true 69.2px.
   *
   * A chunked document answers true throughout: its ratio comes from lines of
   * source text, which no amount of measuring will revise.
   */
  isThumbRatioSettled: () => boolean
  /**
   * Where a line of the SOURCE text sits, as a ratio.
   *
   * The one place a caller is allowed to name a location rather than a
   * fraction, because some callers genuinely have one: a search hit, an
   * anchor, a restored reading position. It answers in the same currency
   * everything else here does, so `travelToRatio`/`jumpToRatio` take the
   * answer unchanged and the caller still never learns whether this document
   * is measured or modelled underneath.
   *
   * `leadViewportFraction` is how much of a screen to leave ABOVE the line on
   * arrival -- 0 puts it flush against the top edge, which is technically
   * correct and horrible to read. Expressed as a fraction of the viewport
   * rather than in pixels so it means the same thing on both strategies.
   *
   * Null when the document cannot place the line yet, which is "not yet"
   * rather than "the top" -- a caller handed 0 would travel confidently to
   * the wrong end.
   */
  ratioForSourceLine: (sourceLine: number, leadViewportFraction?: number) => number | null
  /**
   * The span of SOURCE lines the reader can currently see, inclusive.
   *
   * The reading twin of `ratioForSourceLine`, and the same exception applies:
   * it answers in locations because the question is about locations, and both
   * strategies answer it the same way -- from the blocks the viewport covers.
   * Block-granular by nature, so a block straddling the viewport edge counts
   * as visible in full; nothing that depends on this needs finer than that.
   *
   * Null while the pane cannot say -- no blocks, or nothing measured yet.
   */
  readVisibleSourceLineRange: () => { fromLine: number; toLine: number } | null
  /**
   * The ratio that lands the viewport on an exact pixel offset in the pane.
   *
   * For the caller that has already measured where it wants to be -- a match
   * whose element is on screen, so its position is known rather than
   * modelled. Going back out through a ratio rather than writing `scrollTop`
   * is what keeps such a caller on the same journey as everything else, and
   * the conversion is the exact inverse of the one `travelToRatio` runs, so
   * the pixel asked for is the pixel arrived at -- with nothing left over to
   * correct afterwards.
   */
  ratioForScrollOffsetPx: (offsetPx: number) => number | null
  /**
   * Whether the pane's scroll end in `direction` is the DOCUMENT's end.
   *
   * Optional, and absent means yes: a pane whose scroller holds the whole
   * document has no other kind of end. A WINDOWED pane does -- it runs out of
   * mounted content many times on the way through a large note -- and a
   * continuous scroll that reads that as arrival stops the reader in the
   * middle of the document and will not restart.
   */
  isAtDocumentEdge?: (direction: -1 | 1) => boolean
  /**
   * A scroll offset that counts continuously through the document.
   *
   * Optional, and absent means `scrollTop` already is one. Anything visually
   * glued to the content -- the pane's paper texture -- has to follow this
   * instead on a pane whose scrollTop is only local to a window.
   */
  readContinuousScrollOffsetPx?: () => number
  /** Put the viewport at this ratio now, with no animation. */
  jumpToRatio: (ratio: number) => void
  /**
   * Travel to this ratio.
   *
   * Reports the journey's shape when it was long enough to be bridged, so the
   * scrollbar can move its thumb in step with it, and null when it was an
   * ordinary curve with nothing to keep step with.
   */
  travelToRatio: (ratio: number) => ScrollJourneyTiming | null
}

import type { ScrollJourneyTiming } from './scrollJourney'

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

export interface ContinuousRatios {
  scrollRatio: number
  thumbRatio: number
}

/**
 * The exact answer, for a document whose every block has been measured.
 *
 * The plain scrollbar identity, and it is only correct because the caller has
 * guaranteed the premise: `scrollHeightPx` is a real total, not a running sum
 * of estimates. Used for nothing else.
 */
export function resolveContinuousRatios(options: {
  scrollTopPx: number
  clientHeightPx: number
  scrollHeightPx: number
}): ContinuousRatios | null {
  const { scrollTopPx, clientHeightPx, scrollHeightPx } = options
  if (!(clientHeightPx > 0) || !(scrollHeightPx > 0)) return null

  const maxScrollTopPx = scrollHeightPx - clientHeightPx
  return {
    scrollRatio: maxScrollTopPx > 0 ? clamp01(scrollTopPx / maxScrollTopPx) : 0,
    thumbRatio: clamp01(clientHeightPx / scrollHeightPx),
  }
}

/**
 * How much of the grid a screenful of prose actually fills.
 *
 * A viewport is `columns x rows` character cells, and no real document fills
 * them: lines end early, paragraphs break, spaces are cells too. A half is the
 * standing assumption, and it is deliberately a FIXED number rather than a
 * measurement -- the thumb has to be the same size for the same document every
 * time it is opened, and anything derived from the text currently on screen
 * makes it depend on where the reader happens to be standing.
 */
export const VIEWPORT_GRID_FILL_FACTOR = 0.5

/**
 * How many characters one screen holds, from the viewport's character grid.
 *
 * `columns x rows / 2`. Both terms are geometry -- the column width comes from
 * a measured character advance, the row height from the line height -- so this
 * is a property of the pane and the typography, not of the text in it.
 *
 * Null when it has not been given enough to answer; a caller with no capacity
 * yet should keep whatever it last drew rather than draw a wrong one.
 */
export function resolveViewportCharCapacity(options: {
  contentWidthPx: number
  viewportHeightPx: number
  charWidthPx: number
  lineHeightPx: number
}): number | null {
  const { contentWidthPx, viewportHeightPx, charWidthPx, lineHeightPx } = options
  if (!(contentWidthPx > 0) || !(viewportHeightPx > 0)) return null
  if (!(charWidthPx > 0) || !(lineHeightPx > 0)) return null
  const columns = Math.floor(contentWidthPx / charWidthPx)
  const rows = Math.floor(viewportHeightPx / lineHeightPx)
  if (columns <= 0 || rows <= 0) return null
  return columns * rows * VIEWPORT_GRID_FILL_FACTOR
}

/**
 * How much of a chunked document one screen holds, as a fraction of it.
 *
 * The thumb's size, before the caller applies its own pixel minimum. On a large
 * document this is a very small number and the minimum takes over -- which is
 * correct, and is why the minimum exists.
 */
export function resolveChunkedThumbRatio(options: {
  charsPerScreen: number
  totalChars: number
}): number | null {
  const { charsPerScreen, totalChars } = options
  if (!(charsPerScreen > 0) || !(totalChars > 0)) return null
  return Math.min(1, charsPerScreen / totalChars)
}

/**
 * How far through a chunked document the viewport sits.
 *
 * The first character on screen, over the span a reader can actually move
 * through. That span is not the document: the furthest anyone can go is the
 * START of the last screenful, so it is `totalChars - lastScreenChars`
 * (previewCharPosition.ts's resolveLastScreenChars measures that tail).
 *
 * Which makes this exact at both ends -- 0 with nothing behind the reader, 1
 * with the last screen in view -- and its inverse below exact too, so a drag
 * lands where it was dropped with nothing left to settle afterwards. Two
 * earlier versions of this function approximated the same quantity instead,
 * one by subtracting a fraction of the track from the span and one by blending
 * two readings that each fell short at one end; both left the thumb a few
 * pixels off the bottom of its track at the end of a document. Measuring the
 * tail costs one pass over a handful of blocks and removes the need for either.
 */
export function resolveChunkedScrollRatio(options: {
  startChar: number
  totalChars: number
  lastScreenChars: number
}): number | null {
  const { startChar, totalChars, lastScreenChars } = options
  if (!(totalChars > 0)) return null
  const spanChars = totalChars - Math.max(0, Math.min(totalChars, lastScreenChars))
  // One screen holds the whole document: there is nowhere to scroll, and the
  // reader is at both ends of it at once. Zero is the honest reading.
  if (!(spanChars > 0)) return 0
  return clamp01(startChar / spanChars)
}

/**
 * The character offset that puts the viewport at `ratio`.
 *
 * The exact inverse of the reading above -- a drag that reads position one way
 * and writes it another drops the thumb somewhere other than where the reader
 * released it. Ratio 1 lands on the start of the last screenful, which is the
 * furthest a reader can be, never a character past the document's end.
 */
export function resolveChunkedCharTarget(options: {
  ratio: number
  totalChars: number
  lastScreenChars: number
}): number {
  const { ratio, totalChars, lastScreenChars } = options
  if (!(totalChars > 0)) return 0
  // "Take me to the end" means the end.
  //
  // Everywhere else this divides by the span, which is the document minus a
  // MEASURED last screen -- and that measurement carries a small error, because
  // converting the screen's top edge into a character assumes characters are
  // spread evenly down the block it lands in, and a paragraph's last line is
  // short. Measured: dragging to the very bottom landed 18px above the true end
  // of a 400,000-character document, about two thirds of a line. Harmless in
  // the middle of the track, wrong at the one place the reader's intent is not
  // in doubt, so the extreme is answered directly rather than through the
  // measurement. The scroller clamps the overshoot itself.
  if (clamp01(ratio) >= 1) return totalChars
  const spanChars = totalChars - Math.max(0, Math.min(totalChars, lastScreenChars))
  return clamp01(ratio) * Math.max(0, spanChars)
}
