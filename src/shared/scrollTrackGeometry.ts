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
