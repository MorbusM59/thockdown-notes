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
export const SCROLL_TRACK_EDGE_GAP_PX = 2

/**
 * A track's thickness (every scrollbar, slider shell and the bottom utility
 * row) at UI font scale 1, and the gap between its thumb and its long sides.
 * The thickness follows the UI font scale, rounded to whole pixels so borders
 * stay crisp; the gap does not, so the thumb grows with the track and keeps
 * the same distance from its edges.
 */
export const SCROLL_THICKNESS_BASE_PX = 16
// 4 leaves a thumb (handle + 2px, offset gap - 2px) 2px from the track's
// long sides, the same as SCROLL_TRACK_EDGE_GAP_PX leaves at its ends.
export const SCROLL_HANDLE_GAP_BASE_PX = 4

export interface ScrollTrackSize {
  thicknessPx: number
  handleGapPx: number
  handleThicknessPx: number
}

export function scrollTrackSizeFor(uiFontScale: number): ScrollTrackSize {
  const thicknessPx = Math.round(SCROLL_THICKNESS_BASE_PX * uiFontScale)
  const handleGapPx = SCROLL_HANDLE_GAP_BASE_PX
  return { thicknessPx, handleGapPx, handleThicknessPx: thicknessPx - (handleGapPx * 2) }
}

/**
 * Writes the track tokens onto the root as plain pixel values. JS is the one
 * source of these numbers: the sidebar's width is computed from the thickness
 * in JS, and a pixel value (unlike a calc() in a custom property) reads back
 * through getComputedStyle as a number. tokens.css carries the scale-1 values
 * only as a fallback for the first paint.
 */
export function installScrollTrackTokens(uiFontScale: number): void {
  const rootStyle = document.documentElement.style
  const size = scrollTrackSizeFor(uiFontScale)
  rootStyle.setProperty('--canonical-scroll-track-edge-gap', `${SCROLL_TRACK_EDGE_GAP_PX}px`)
  rootStyle.setProperty('--canonical-scroll-thickness', `${size.thicknessPx}px`)
  rootStyle.setProperty('--canonical-scroll-handle-gap', `${size.handleGapPx}px`)
  rootStyle.setProperty('--canonical-scroll-handle-thickness', `${size.handleThicknessPx}px`)
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
