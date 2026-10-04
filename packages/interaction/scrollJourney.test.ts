import { beforeEach, describe, expect, it } from 'vitest'
import {
  planScrollJourney,
  resolveBridgeDurationMs,
  resolveBridgeLandingPx,
  SCROLL_BRIDGE_MAX_MS,
  SCROLL_BRIDGE_MIN_MS,
  type BridgedJourney,
} from './scrollJourney'
import {
  DEFAULT_RENDER_SCROLL_DYNAMIC,
  DEFAULT_RENDER_SCROLL_MAX_SPEED_PX_PER_SEC,
  DEFAULT_RENDER_SCROLL_SKEW,
  DEFAULT_RENDER_SCROLL_TOTAL_TIME_SEC,
  sampleCurveRampPlan,
  setRenderScrollDynamic,
  setRenderScrollMaxSpeedPxPerSec,
  setRenderScrollSkew,
  setRenderScrollTotalTimeSec,
} from './ScrollCurvePlan'

const bridged = (distance: number): BridgedJourney => {
  const journey = planScrollJourney(distance)
  if (!journey || journey.kind !== 'bridged') throw new Error(`expected a bridged journey for ${distance}`)
  return journey
}

describe('planScrollJourney', () => {
  beforeEach(() => {
    setRenderScrollDynamic(DEFAULT_RENDER_SCROLL_DYNAMIC)
    setRenderScrollTotalTimeSec(DEFAULT_RENDER_SCROLL_TOTAL_TIME_SEC)
    setRenderScrollSkew(DEFAULT_RENDER_SCROLL_SKEW)
    setRenderScrollMaxSpeedPxPerSec(DEFAULT_RENDER_SCROLL_MAX_SPEED_PX_PER_SEC)
  })

  it('travels a short journey directly, with no middle to cut', () => {
    expect(planScrollJourney(0)?.kind).toBe('direct')
    expect(planScrollJourney(500)?.kind).toBe('direct')
    expect(planScrollJourney(-500)?.kind).toBe('direct')
  })

  it('bridges once the journey is longer than its own two ramps', () => {
    // The threshold is derived, not chosen: it is exactly the distance the
    // ramps cover between them.
    const journey = bridged(400000)
    const threshold = Math.abs(journey.rampUp.signedDistancePx) + Math.abs(journey.rampDown.signedDistancePx)
    expect(planScrollJourney(threshold * 0.99)?.kind).toBe('direct')
    expect(planScrollJourney(threshold * 1.01)?.kind).toBe('bridged')
  })

  it('takes the same time whether the jump is long or enormous', () => {
    const short = bridged(20000)
    const long = bridged(1200000)
    const totalSec = (j: BridgedJourney) =>
      j.rampUp.durationSec + j.bridgeDurationSec + j.rampDown.durationSec
    // Only the bridge grows, and only within its own bounds -- so the whole
    // journey stays inside a fifth of a second of itself across two orders of
    // magnitude of distance.
    expect(totalSec(long) - totalSec(short)).toBeLessThan(0.2)
    expect(totalSec(long)).toBeLessThan(0.75)
  })

  it('ramps up to exactly the peak the ramp-down comes back from', () => {
    const journey = bridged(400000)
    const speedAtEndOfRampUp = (sampleCurveRampPlan(journey.rampUp, journey.rampUp.durationSec)
      - sampleCurveRampPlan(journey.rampUp, journey.rampUp.durationSec - 0.001)) / 0.001
    const speedAtStartOfRampDown = (sampleCurveRampPlan(journey.rampDown, 0.001)
      - sampleCurveRampPlan(journey.rampDown, 0)) / 0.001
    expect(speedAtEndOfRampUp).toBeCloseTo(journey.peakSpeedPxPerSec, -2)
    expect(speedAtStartOfRampDown).toBeCloseTo(journey.peakSpeedPxPerSec, -2)
  })

  it('keeps its direction', () => {
    const up = bridged(-400000)
    expect(up.rampUp.signedDistancePx).toBeLessThan(0)
    expect(up.rampDown.signedDistancePx).toBeLessThan(0)
    expect(up.bridgeDistancePx).toBeLessThan(0)
  })

  it('lands the cut exactly one ramp-down short of the target', () => {
    const journey = bridged(400000)
    const target = 500000
    const landing = resolveBridgeLandingPx(journey, target)
    // Playing the ramp-down out from the landing point arrives on the target.
    expect(landing + sampleCurveRampPlan(journey.rampDown, journey.rampDown.durationSec))
      .toBeCloseTo(target, 6)
  })

  it('never asks for more real scrolling than the journey has', () => {
    for (const distance of [12000, 30000, 100000, 1500000]) {
      const journey = planScrollJourney(distance)
      if (!journey || journey.kind !== 'bridged') continue
      const real = Math.abs(journey.rampUp.signedDistancePx) + Math.abs(journey.rampDown.signedDistancePx)
      expect(real).toBeLessThanOrEqual(distance)
    }
  })

  it('slows the peak when the reader has asked for a slower one', () => {
    setRenderScrollMaxSpeedPxPerSec(20000)
    const slow = bridged(400000)
    expect(slow.peakSpeedPxPerSec).toBe(20000)
    // A slower peak means shorter ramps, so shorter journeys start bridging.
    setRenderScrollMaxSpeedPxPerSec(100000)
    const fast = bridged(400000)
    expect(Math.abs(slow.rampDown.signedDistancePx)).toBeLessThan(Math.abs(fast.rampDown.signedDistancePx))
  })
})

describe('resolveBridgeDurationMs', () => {
  it('grows with the logarithm of the distance, between its bounds', () => {
    const threshold = 10000
    expect(resolveBridgeDurationMs(threshold, threshold)).toBe(SCROLL_BRIDGE_MIN_MS)
    expect(resolveBridgeDurationMs(threshold * 2, threshold)).toBeGreaterThan(SCROLL_BRIDGE_MIN_MS)
    expect(resolveBridgeDurationMs(threshold * 10, threshold))
      .toBeLessThan(resolveBridgeDurationMs(threshold * 100, threshold))
    expect(resolveBridgeDurationMs(threshold * 1e6, threshold)).toBe(SCROLL_BRIDGE_MAX_MS)
  })

  it('is never below its floor, whatever it is asked', () => {
    expect(resolveBridgeDurationMs(0, 10000)).toBe(SCROLL_BRIDGE_MIN_MS)
    expect(resolveBridgeDurationMs(100, 0)).toBe(SCROLL_BRIDGE_MIN_MS)
  })
})
