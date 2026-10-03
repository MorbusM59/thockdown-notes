/**
 * How far a scrollbar thumb stops short of each END of its track: the gap at
 * the top and the bottom (the gap at the sides is `--canonical-scroll-handle-gap`).
 *
 * Stated here, once, because every custom scrollbar computes its thumb position
 * in JS on every scroll frame, where reading a CSS value back would be a style
 * recalculation per frame. The stylesheet gets the same number as
 * `--canonical-scroll-track-edge-gap`, written onto the root at startup by
 * `installScrollTrackTokens`, for what is drawn in a track by CSS alone (the
 * adventure's rail gauges) -- so both kinds of handle stop at the same line.
 */
export const SCROLL_TRACK_EDGE_GAP_PX = 3

export function installScrollTrackTokens(): void {
  document.documentElement.style.setProperty('--canonical-scroll-track-edge-gap', `${SCROLL_TRACK_EDGE_GAP_PX}px`)
}

/** Where a scrollbar's thumb sits, in px within its track; `active` is false when there is nothing to scroll. */
export interface ScrollThumb {
  top: number
  height: number
  active: boolean
}

/**
 * The thumb for a scroller: as tall as the share of the content in view
 * (never shorter than it is wide, so the smallest thumb is a square), at the
 * share of the way down the scroller is, inside the track's end gaps. With
 * nothing to scroll it fills the track and is inactive.
 */
export function scrollThumbFor(scroller: { scrollTop: number; scrollHeight: number; clientHeight: number }, trackHeight: number, thumbWidth: number): ScrollThumb {
  const usable = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2))
  const { clientHeight: viewport, scrollHeight: content } = scroller
  if (viewport <= 0 || content <= 0 || trackHeight <= 0) return { top: 0, height: 0, active: false }
  if (content <= viewport) return { top: SCROLL_TRACK_EDGE_GAP_PX, height: usable, active: false }
  const height = Math.max(thumbWidth, Math.min(usable, Math.round(usable * (viewport / content))))
  const maxScrollTop = content - viewport
  const top = SCROLL_TRACK_EDGE_GAP_PX + Math.round(Math.max(0, usable - height) * (scroller.scrollTop / maxScrollTop))
  return { top, height, active: true }
}

/** The scrollTop that puts a thumb of `thumbHeight` at `thumbTop` (clamped to the track), the inverse of scrollThumbFor. */
export function scrollTopForThumb(scroller: { scrollHeight: number; clientHeight: number }, trackHeight: number, thumbHeight: number, thumbTop: number): number {
  const usable = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2))
  const travel = Math.max(0, usable - thumbHeight)
  const clamped = Math.max(SCROLL_TRACK_EDGE_GAP_PX, Math.min(thumbTop, SCROLL_TRACK_EDGE_GAP_PX + travel))
  const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  return travel > 0 ? ((clamped - SCROLL_TRACK_EDGE_GAP_PX) / travel) * maxScrollTop : 0
}
