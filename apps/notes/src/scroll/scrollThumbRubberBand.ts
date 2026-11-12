// The scrollbar thumb during a bridged journey.
//
// ## What it does
//
// It stretches rather than slides. The edge in the direction of travel sets
// off first and runs the whole span while the other stays put; both hold still
// while the bridge covers the cut, the thumb stretched taut across everything
// it is crossing; then the trailing edge catches up and the thumb contracts to
// its normal size on the target.
//
//   ramp-up      leading edge runs the span, thumb grows
//   bridge       both edges still, thumb stretched across the whole journey
//   ramp-down    trailing edge catches up, thumb contracts
//
// ## Why the thumb does not simply slide
//
// Because the document is not sliding either -- its middle is being cut out.
// A thumb that slid smoothly would be describing a journey that did not
// happen, and it would have to cross the whole track in the time the two
// ramps take, which at that size reads as a twitch. Stretching says the true
// thing: for a moment the reader is spread across all of it.
//
// ## Position, not velocity
//
// Each edge follows the POSITION curve of its own ramp, normalized and applied
// to the full span (see sampleCurveRampProgress). The ramps' own pixel
// distances are irrelevant here: a ramp-up moves the document a few thousand
// pixels of a journey that may be a million, while the thumb's leading edge
// crosses the entire track in that same window. What carries over is the
// SHAPE -- ease-in as the leading edge sets off from rest, ease-out as the
// trailing edge settles.
//
// The velocity discontinuity where each edge stops for the bridge is
// deliberate, not an oversight. That freeze is the band held taut, and it is
// what makes the stretch read as speed rather than as a slow smear.

export interface ThumbRubberBandInput {
  /** Where the thumb rests at the start, as a track offset. */
  startTopPx: number
  /** Where it rests at the end. */
  targetTopPx: number
  /** Its resting height, which the stretch adds to. */
  thumbHeightPx: number
  /** How far through the leading edge's own travel, 0..1. */
  leadProgress: number
  /** How far through the trailing edge's own travel, 0..1. */
  trailProgress: number
}

export interface ThumbGeometry {
  topPx: number
  heightPx: number
}

/**
 * Where the thumb's two edges are, part way through a journey.
 *
 * Written in terms of both edges' own positions rather than as a
 * direction-dependent pair of cases, so a journey up the document and one down
 * it are the same arithmetic: whichever edge is further along leads, the other
 * trails, and the thumb is whatever lies between them.
 */
export function resolveThumbRubberBand(input: ThumbRubberBandInput): ThumbGeometry {
  const { startTopPx, targetTopPx, thumbHeightPx, leadProgress, trailProgress } = input
  const spanPx = targetTopPx - startTopPx

  const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
  const leadingEdgeTopPx = startTopPx + (spanPx * clamp01(leadProgress))
  const trailingEdgeTopPx = startTopPx + (spanPx * clamp01(trailProgress))

  return {
    topPx: Math.min(leadingEdgeTopPx, trailingEdgeTopPx),
    heightPx: thumbHeightPx + Math.abs(leadingEdgeTopPx - trailingEdgeTopPx),
  }
}
