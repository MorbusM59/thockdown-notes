import { sampleCurveRampProgress } from '@thockdown/interaction/ScrollCurvePlan'
import type { ScrollJourneyTiming } from '@thockdown/interaction/scrollJourney'
import { isSmoothScrollActive } from '@thockdown/interaction/smoothScrollRegistry'

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

export interface ThumbRubberBand {
  /** Stretch the thumb from `startTopPx` to `targetTopPx` over the journey's ramps. */
  start: (timing: ScrollJourneyTiming, startTopPx: number, targetTopPx: number) => void
  stop: () => void
  /** True while the band owns the thumb; the surface's ordinary sync stands down. */
  isRunning: () => boolean
}

/**
 * The frame loop that draws the band, the same for every scrollbar. The
 * surface supplies its scroller, its thumb's resting height, how to paint the
 * thumb, and `onSettled`, which hands the thumb back to the surface's own sync
 * once the journey is over.
 *
 * The reader may interrupt a journey with a wheel, a drag, a page key or
 * another click, and every one of those cancels the scroll without telling
 * the scrollbar. Asking the engine whether its journey is still running
 * covers all of them at once; without it the band would go on stretching
 * toward a target nobody is travelling to any more.
 */
export function createThumbRubberBand({
  scroller,
  thumbHeightPx,
  paint,
  onSettled,
}: {
  scroller: () => HTMLElement | null
  thumbHeightPx: () => number
  paint: (topPx: number, heightPx: number) => void
  onSettled: () => void
}): ThumbRubberBand {
  let raf: number | null = null
  const stop = () => {
    if (raf !== null) cancelAnimationFrame(raf)
    raf = null
  }
  const start = (timing: ScrollJourneyTiming, startTopPx: number, targetTopPx: number) => {
    stop()
    const heightPx = thumbHeightPx()
    const rampUpSec = timing.rampUp.durationSec
    const bridgeEndSec = rampUpSec + timing.bridgeDurationSec
    const totalSec = bridgeEndSec + timing.rampDown.durationSec
    let startedAtMs: number | null = null
    const frame = (nowMs: number) => {
      startedAtMs ??= nowMs
      const elapsedSec = (nowMs - startedAtMs) / 1000
      const el = scroller()
      if (elapsedSec >= totalSec || !el || !isSmoothScrollActive(el)) {
        raf = null
        onSettled()
        return
      }
      const leadProgress = elapsedSec < rampUpSec ? sampleCurveRampProgress(timing.rampUp, elapsedSec) : 1
      const trailProgress = elapsedSec <= bridgeEndSec
        ? 0
        : sampleCurveRampProgress(timing.rampDown, elapsedSec - bridgeEndSec)
      const band = resolveThumbRubberBand({ startTopPx, targetTopPx, thumbHeightPx: heightPx, leadProgress, trailProgress })
      paint(band.topPx, band.heightPx)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
  }
  return { start, stop, isRunning: () => raf !== null }
}
