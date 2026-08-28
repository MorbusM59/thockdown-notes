import { describe, expect, it } from 'vitest'
import {
  buildScrollPlanFromCurrentParams,
  compressScrollPlanToDuration,
  DEFAULT_RENDER_SCROLL_MAX_SPEED_PX_PER_SEC,
  sampleScrollPlan,
  SCROLL_DURATION_CAP_PX,
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
    // 500,000px at 80,000px/s would be 6.25s uncapped; the cap (below) puts it
    // at 2.5s. Either way it is nowhere near the 80s the 6000 default gave.
    expect(plan.totalDurationSec).toBeLessThan(3)
  })
})

describe('max speed also caps duration', () => {
  const capFor = (maxSpeed: number) => SCROLL_DURATION_CAP_PX / maxSpeed

  it('takes at most two seconds at the slider maximum', () => {
    setRenderScrollMaxSpeedPxPerSec(100000)
    // Longer than any real document, so the cap is what decides.
    const plan = buildScrollPlanFromCurrentParams(5000000)
    expect(plan.totalDurationSec).toBeCloseTo(2, 5)
  })

  it('takes longer as the speed is wound down', () => {
    setRenderScrollMaxSpeedPxPerSec(20000)
    const plan = buildScrollPlanFromCurrentParams(5000000)
    expect(plan.totalDurationSec).toBeCloseTo(capFor(20000), 5)
    expect(plan.totalDurationSec).toBeGreaterThan(2)
  })

  it('leaves an ordinary short jump alone', () => {
    setRenderScrollMaxSpeedPxPerSec(DEFAULT_RENDER_SCROLL_MAX_SPEED_PX_PER_SEC)
    const plan = buildScrollPlanFromCurrentParams(600)
    // Well inside the ceiling, so the curve keeps its own timing.
    expect(plan.totalDurationSec).toBeLessThan(capFor(DEFAULT_RENDER_SCROLL_MAX_SPEED_PX_PER_SEC))
  })

  it('reaches the destination exactly, however hard it was compressed', () => {
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
    // the curve's own pre-existing behaviour, not something the duration
    // ceiling introduced, so the easing is checked where easing exists.
    setRenderScrollMaxSpeedPxPerSec(80000)
    const plan = buildScrollPlanFromCurrentParams(20000)
    expect(plan.hasPlateau).toBe(true)
    expect(plan.rampUpEndSec).toBeGreaterThan(0)
    const rampDistance = sampleScrollPlan(plan, plan.rampUpEndSec)
    expect(rampDistance).toBeLessThan(plan.plateauSpeedPxPerSec * plan.rampUpEndSec)
  })

  it('exceeds the nominal max speed when it has to, which is the trade', () => {
    // The velocity cap shapes ordinary travel; the duration ceiling bounds the
    // extraordinary kind, and a journey that cannot fit under both loses the
    // velocity one. Worth an explicit test so nobody "fixes" it later.
    setRenderScrollMaxSpeedPxPerSec(100000)
    const plan = buildScrollPlanFromCurrentParams(5000000)
    expect(plan.plateauSpeedPxPerSec).toBeGreaterThan(100000)
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
    expect(plan.totalDurationSec).toBeCloseTo(2, 5)
    expect(sampleScrollPlan(plan, plan.totalDurationSec)).toBe(-5000000)
  })
})

describe('compressScrollPlanToDuration', () => {
  it('plays exactly the same curve, only faster', () => {
    // The invariant the whole approach rests on: compression is a uniform
    // scaling of the plan's clock, so the position at the same FRACTION of the
    // journey is unchanged. Easing, plateau, endpoints -- all preserved.
    setRenderScrollMaxSpeedPxPerSec(80000)
    const original = buildScrollPlanFromCurrentParams(100000)
    const compressed = compressScrollPlanToDuration(original, original.totalDurationSec / 3)
    expect(compressed.totalDurationSec).toBeCloseTo(original.totalDurationSec / 3, 6)
    for (let i = 0; i <= 20; i += 1) {
      const fraction = i / 20
      expect(sampleScrollPlan(compressed, compressed.totalDurationSec * fraction))
        .toBeCloseTo(sampleScrollPlan(original, original.totalDurationSec * fraction), 6)
    }
  })

  it('leaves a plan that already fits untouched', () => {
    setRenderScrollMaxSpeedPxPerSec(DEFAULT_RENDER_SCROLL_MAX_SPEED_PX_PER_SEC)
    const plan = buildScrollPlanFromCurrentParams(1000)
    expect(compressScrollPlanToDuration(plan, 60)).toBe(plan)
  })

  it('ignores a nonsense ceiling rather than freezing the scroll', () => {
    setRenderScrollMaxSpeedPxPerSec(DEFAULT_RENDER_SCROLL_MAX_SPEED_PX_PER_SEC)
    const plan = buildScrollPlanFromCurrentParams(1000)
    expect(compressScrollPlanToDuration(plan, 0)).toBe(plan)
    expect(compressScrollPlanToDuration(plan, Number.NaN)).toBe(plan)
  })
})
