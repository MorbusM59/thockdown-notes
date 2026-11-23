import { afterEach, describe, expect, it } from 'vitest'
import {
  buildHoldRampPlan,
  HOLD_TRAVEL_ANIMATION_MULTIPLIER,
  HOLD_TRAVEL_BASE_SEC,
  holdFullTravelSec,
  quantizeHoldTravel,
  sampleHoldTravel,
} from './holdToAdjust'
import {
  DEFAULT_RENDER_SCROLL_TOTAL_TIME_SEC,
  setRenderScrollDynamic,
  setRenderScrollSkew,
  setRenderScrollTotalTimeSec,
} from '@thockdown/interaction/ScrollCurvePlan'

const RANGE = 99

// The curve reads live global settings, so a test that changes them has to put
// them back even when it fails -- otherwise one failure cascades into every
// test that runs after it, and the real cause is buried.
afterEach(() => {
  setRenderScrollTotalTimeSec(DEFAULT_RENDER_SCROLL_TOTAL_TIME_SEC)
  setRenderScrollSkew(0.5)
  setRenderScrollDynamic(1.5)
})

describe('hold travel time from the animation setting', () => {
  /**
   * The PROPERTY, not the arithmetic -- the test below owns the formula, and
   * owns it against the constants themselves.
   *
   * This used to assert `holdFullTravelSec(0.4)` was `0.5 + 0.4 * 5`, with the
   * multiplier written out by hand two lines under an import of that very
   * constant, and a second assertion pinning the same input's answer to a bare
   * `2.5`. Both were snapshots of one tuning of the constant, so tuning it (5
   * -> 2.5, a deliberate feel change) broke a test that had no opinion about
   * feel at all. The rule the function actually has to obey is the one its doc
   * comment states: the scroll setting's own range is far shorter than any
   * sensible time to walk a hundred steps, so this SCALES the setting rather
   * than copying it.
   */
  it('restates the animation speed as a whole-range crossing time', () => {
    // A restatement, not a copy: crossing the range always takes longer than
    // the scroll animation whose setting it comes from.
    for (const speed of [0, 0.1, 0.4, 1, 2]) {
      expect(holdFullTravelSec(speed)).toBeGreaterThan(speed)
    }

    // Affine in the setting: equal steps in the setting are equal steps in the
    // travel time, so the slider reads as one continuous control.
    const stepA = holdFullTravelSec(1) - holdFullTravelSec(0.5)
    const stepB = holdFullTravelSec(1.5) - holdFullTravelSec(1)
    expect(stepA).toBeCloseTo(stepB, 10)
    expect(stepA).toBeGreaterThan(0)

    // And the default setting lands somewhere a reader can actually aim: fast
    // enough not to be a chore, slow enough to stop on a value.
    const atDefault = holdFullTravelSec(DEFAULT_RENDER_SCROLL_TOTAL_TIME_SEC)
    expect(atDefault).toBeGreaterThan(0.75)
    expect(atDefault).toBeLessThan(6)
  })

  it('keeps a floor so the snappiest setting is still aimable', () => {
    expect(holdFullTravelSec(0)).toBe(HOLD_TRAVEL_BASE_SEC)
    // A control that crosses 99 steps instantly could not be stopped anywhere.
    expect(holdFullTravelSec(0)).toBeGreaterThan(0.2)
  })

  it('scales with the setting rather than copying it', () => {
    const slow = holdFullTravelSec(2)
    expect(slow).toBeCloseTo(HOLD_TRAVEL_BASE_SEC + 2 * HOLD_TRAVEL_ANIMATION_MULTIPLIER, 10)
    expect(slow).toBeGreaterThan(holdFullTravelSec(0.4))
  })
})

describe('hold ramp plan', () => {
  it('crosses exactly the range in exactly the requested time', () => {
    const plan = buildHoldRampPlan(RANGE, 2.5)!
    expect(plan).not.toBeNull()
    expect(sampleHoldTravel(plan, 2.5)).toBeCloseTo(RANGE, 6)
  })

  it('holds that promise across every animation setting', () => {
    for (const speed of [0, 0.1, 0.4, 1, 2]) {
      for (const skew of [0.1, 0.5, 0.9]) {
        for (const ramp of [0.1, 1.5, 5]) {
          setRenderScrollTotalTimeSec(speed)
          setRenderScrollSkew(skew)
          setRenderScrollDynamic(ramp)
          const travelSec = holdFullTravelSec(speed)
          const plan = buildHoldRampPlan(RANGE, travelSec)!
          expect(plan).not.toBeNull()
          expect(sampleHoldTravel(plan, travelSec)).toBeCloseTo(RANGE, 4)
          // The ramp never outlasts the travel it is part of.
          expect(plan.rampDurationSec).toBeLessThan(travelSec)
          // Easing off means no ramp at all, which is the setting honoured.
          expect(plan.ramp === null).toBe(speed === 0)
        }
      }
    }
  })

  it('starts from rest, so a brief press moves barely at all', () => {
    const plan = buildHoldRampPlan(RANGE, 2.5)!
    // The whole point: 4% of the travel time must not have covered 4% of
    // the range, or precise adjustment is impossible.
    const early = sampleHoldTravel(plan, 0.1)
    expect(early).toBeLessThan(RANGE * 0.04)
    expect(early).toBeGreaterThan(0)
  })

  it('accelerates and then stops accelerating', () => {
    const plan = buildHoldRampPlan(RANGE, 2.5)!
    const speedOver = (from: number, to: number) =>
      (sampleHoldTravel(plan, to) - sampleHoldTravel(plan, from)) / (to - from)

    const early = speedOver(0.0, 0.05)
    const mid = speedOver(0.05, 0.1)
    const late = speedOver(1.0, 1.2)
    const later = speedOver(1.8, 2.0)

    expect(mid).toBeGreaterThan(early)          // ramping up
    expect(late).toBeGreaterThan(mid)
    expect(later).toBeCloseTo(late, 6)          // coasting, not still accelerating
    expect(later).toBeCloseTo(plan.coastSpeedUnitsPerSec, 6)
  })

  it('is monotonic — a hold never walks the value backwards', () => {
    const plan = buildHoldRampPlan(RANGE, 2.5)!
    let previous = -1
    for (let t = 0; t <= 3; t += 0.02) {
      const travel = sampleHoldTravel(plan, t)
      expect(travel).toBeGreaterThanOrEqual(previous)
      previous = travel
    }
  })

  it('refuses a degenerate range or duration rather than guessing', () => {
    expect(buildHoldRampPlan(0, 2.5)).toBeNull()
    expect(buildHoldRampPlan(RANGE, 0)).toBeNull()
    expect(buildHoldRampPlan(-5, 2.5)).toBeNull()
  })
})

describe('quantizing', () => {
  it('waits for a whole step before reporting one', () => {
    expect(quantizeHoldTravel(0.99, 1)).toBe(0)
    expect(quantizeHoldTravel(1, 1)).toBe(1)
    expect(quantizeHoldTravel(7.9, 1)).toBe(7)
  })

  it('honours a coarser step', () => {
    expect(quantizeHoldTravel(9, 5)).toBe(5)
    expect(quantizeHoldTravel(10, 5)).toBe(10)
  })
})
