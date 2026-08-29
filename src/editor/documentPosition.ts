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
 * How far through a chunked document the viewport sits.
 *
 * `thumbRatio` is not decoration here, it is what makes the mapping reach its
 * own end. The span a scroll position moves through is the document minus the
 * screenful that is always visible, and expressing that screenful as
 * `totalChars * thumbRatio` -- rather than measuring the characters actually
 * on screen -- buys two things:
 *
 *  - the thumb lands flush against the bottom of the track exactly when the
 *    document does, because the same ratio sizes the thumb and shortens the
 *    span. Sizing with one number and positioning with another leaves the
 *    thumb short of the end, or past it;
 *  - the mapping is a function of position alone. A live count of visible
 *    characters makes the denominator move with local text density, so the
 *    same position reports differently depending on what happens to be on
 *    screen -- and the thumb can then drift BACKWARDS while the reader
 *    scrolls forwards.
 */
export function resolveChunkedScrollRatio(options: {
  startChar: number
  totalChars: number
  thumbRatio: number
}): number | null {
  const { startChar, totalChars, thumbRatio } = options
  if (!(totalChars > 0)) return null

  const spanChars = totalChars * (1 - clamp01(thumbRatio))
  if (!(spanChars > 0)) return 0
  return clamp01(startChar / spanChars)
}

/**
 * The character offset that puts the viewport at `ratio`.
 *
 * The exact inverse of the reading above, and it has to stay that way: a drag
 * that reads position one way and writes it another drops the thumb somewhere
 * other than where the reader released it.
 */
export function resolveChunkedCharTarget(options: {
  ratio: number
  totalChars: number
  thumbRatio: number
}): number {
  const { ratio, totalChars, thumbRatio } = options
  if (!(totalChars > 0)) return 0
  return clamp01(ratio) * totalChars * (1 - clamp01(thumbRatio))
}
