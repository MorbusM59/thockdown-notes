import { describe, expect, it } from 'vitest'
import {
  buildScrollPlanFromCurrentParams,
  DEFAULT_RENDER_SCROLL_MAX_SPEED_PX_PER_SEC,
  sampleScrollPlan,
  setRenderScrollMaxSpeedPxPerSec,
} from './ScrollCurvePlan'

describe('the max-speed default', () => {
  it('is the value the Options slider offers, not a tenth of it', () => {
    // Every fallback path lands here -- a fresh install, a state file written
    // before the setting existed, a non-finite value handed to the setter --
    // and while this was 6000 all of them silently gave a tenth of the
    // intended speed.
    expect(DEFAULT_RENDER_SCROLL_MAX_SPEED_PX_PER_SEC).toBe(80000)
  })

  it('is what the setter falls back to when handed nonsense', () => {
    setRenderScrollMaxSpeedPxPerSec(Number.NaN)
    const plan = buildScrollPlanFromCurrentParams(500000)
    // The distance is far enough to reach the cap, so the plateau speed IS
    // the fallback. At the old 6000 default this ran at a tenth of that.
    expect(plan.plateauSpeedPxPerSec).toBeCloseTo(80000, 5)
  })
})

describe('max speed means max speed, and nothing else', () => {
  it('never exceeds the chosen speed, however far the journey', () => {
    // It used to, deliberately: the same slider also set a duration ceiling of
    // 200,000px / maxSpeed seconds, and a journey that could not fit under
    // both lost the velocity one. The bridge retired that trade -- a long
    // journey no longer plays its whole distance at all -- so the cap is now
    // simply true.
    setRenderScrollMaxSpeedPxPerSec(100000)
    expect(buildScrollPlanFromCurrentParams(5000000).plateauSpeedPxPerSec)
      .toBeLessThanOrEqual(100000 + 1e-6)
  })

  it('leaves a raw plan for an enormous distance genuinely long', () => {
    // Which is the point, and the reason such a journey must be bridged rather
    // than played: 5,000,000px at 100,000px/s is fifty seconds of travel. Any
    // caller reaching this plan for a distance like it has a bug -- see
    // editor/scrollJourney.ts for what is meant to happen instead.
    setRenderScrollMaxSpeedPxPerSec(100000)
    expect(buildScrollPlanFromCurrentParams(5000000).totalDurationSec).toBeGreaterThan(40)
  })

  it('leaves an ordinary short jump to the timing the curve chose', () => {
    setRenderScrollMaxSpeedPxPerSec(DEFAULT_RENDER_SCROLL_MAX_SPEED_PX_PER_SEC)
    expect(buildScrollPlanFromCurrentParams(600).totalDurationSec).toBeLessThan(1)
  })

  it('reaches the destination exactly', () => {
    setRenderScrollMaxSpeedPxPerSec(100000)
    const distance = 5000000
    const plan = buildScrollPlanFromCurrentParams(distance)
    expect(sampleScrollPlan(plan, 0)).toBe(0)
    expect(sampleScrollPlan(plan, plan.totalDurationSec)).toBe(distance)
  })

  it('still eases in on a jump that has a ramp to speak of', () => {
    // Measured across distances at 80,000px/s: 2,000px is a pure bell (no
    // plateau at all), 20,000px ramps for 0.15s, 100,000px for 0.05s, and by
    // 350,000px the ramp has vanished into the plateau -- the bell's natural
    // peak speed grows with distance while t does not, so x1 -> 0. That is
    // the curve's own behaviour, so the easing is checked where easing exists.
    setRenderScrollMaxSpeedPxPerSec(80000)
    const plan = buildScrollPlanFromCurrentParams(20000)
    expect(plan.hasPlateau).toBe(true)
    expect(plan.rampUpEndSec).toBeGreaterThan(0)
    const rampDistance = sampleScrollPlan(plan, plan.rampUpEndSec)
    expect(rampDistance).toBeLessThan(plan.plateauSpeedPxPerSec * plan.rampUpEndSec)
  })

  it('moves forward the whole way, never backwards', () => {
    setRenderScrollMaxSpeedPxPerSec(100000)
    const plan = buildScrollPlanFromCurrentParams(5000000)
    let previous = -1
    for (let i = 0; i <= 200; i += 1) {
      const value = sampleScrollPlan(plan, (plan.totalDurationSec * i) / 200)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })

  it('handles a negative (upward) journey the same way', () => {
    setRenderScrollMaxSpeedPxPerSec(100000)
    const plan = buildScrollPlanFromCurrentParams(-5000000)
    expect(sampleScrollPlan(plan, plan.totalDurationSec)).toBe(-5000000)
  })
})
