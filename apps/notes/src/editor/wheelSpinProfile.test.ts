import { describe, expect, it } from 'vitest'

import {
  DEFAULT_WHEEL_SPIN_CUTOFF_MS,
  DEFAULT_WHEEL_SPIN_DAMPEN_DIVISOR,
  WHEEL_SPIN_DAMPEN_ENDLESS,
  resolveWheelSpinDecay,
} from './wheelSpin'
import {
  addWheelSpinProfileCarry,
  buildWheelSpinProfile,
  sampleWheelSpinProfile,
  wheelSpinProfileEndMs,
  wheelSpinProfileSpeedPxPerMs,
  wheelSpinProfileUndeliveredCarryPx,
} from './wheelSpinProfile'

const PIXELS_PER_NUDGE = 76.8

const buildDefault = (overrides: Partial<Parameters<typeof buildWheelSpinProfile>[0]> = {}) =>
  buildWheelSpinProfile({
    direction: 1,
    pixelsPerNudge: PIXELS_PER_NUDGE,
    averageGapMs: 20,
    dampenDivisor: DEFAULT_WHEEL_SPIN_DAMPEN_DIVISOR,
    cutoffMs: DEFAULT_WHEEL_SPIN_CUTOFF_MS,
    ...overrides,
  })

/** The schedule `wheelSpin.ts` describes, walked independently of the profile. */
function scheduleDots(averageGapMs: number, dampenDivisor: number, cutoffMs: number) {
  const decay = resolveWheelSpinDecay(dampenDivisor)
  const dots: { tMs: number; nudges: number }[] = [{ tMs: 0, nudges: 0 }]
  let tMs = 0
  for (let n = 0; n < 5000; n += 1) {
    const intervalMs = averageGapMs * Math.pow(1 + (n * decay), n)
    if (intervalMs > cutoffMs) break
    tMs += intervalMs
    dots.push({ tMs, nudges: n + 1 })
  }
  return dots
}

describe('buildWheelSpinProfile', () => {
  it('is at the model distance at every nudge time', () => {
    const profile = buildDefault()
    const dots = scheduleDots(20, DEFAULT_WHEEL_SPIN_DAMPEN_DIVISOR, DEFAULT_WHEEL_SPIN_CUTOFF_MS)

    expect(dots.length).toBeGreaterThan(20)
    for (const dot of dots) {
      const { travelledPx } = sampleWheelSpinProfile(profile, dot.tMs)
      expect(travelledPx).toBeCloseTo(dot.nudges * PIXELS_PER_NUDGE, 6)
    }
  })

  it('never reverses or stalls between dots', () => {
    const profile = buildDefault()
    let previousPx = -1
    for (let tMs = 0; tMs <= profile.totalDurationMs; tMs += 1) {
      const { travelledPx } = sampleWheelSpinProfile(profile, tMs)
      expect(travelledPx).toBeGreaterThan(previousPx)
      previousPx = travelledPx
    }
  })

  it('has no velocity step at a nudge boundary', () => {
    // The defect this module replaced: the previous delivery paid each nudge
    // out at constant velocity, so speed fell by up to 9% at the default
    // settings in one instant at every boundary. Anything left here is
    // curvature over the sample window, not a step.
    const profile = buildDefault()
    const h = 0.5
    const speedAt = (tMs: number) =>
      (sampleWheelSpinProfile(profile, tMs + h).travelledPx
        - sampleWheelSpinProfile(profile, tMs - h).travelledPx) / (2 * h)

    for (let i = 1; i < profile.timesMs.length - 1; i += 1) {
      const tMs = profile.timesMs[i]
      const before = speedAt(tMs - 2)
      const after = speedAt(tMs + 2)
      expect(Math.abs(after - before) / before).toBeLessThan(0.01)
    }
  })

  it('starts at exactly the rate the hand set', () => {
    const profile = buildDefault({ averageGapMs: 20 })
    const speedPxPerMs = sampleWheelSpinProfile(profile, 0.5).travelledPx / 0.5
    expect(speedPxPerMs).toBeCloseTo(PIXELS_PER_NUDGE / 20, 2)
  })

  it('brakes down to a speed the reader cannot see, instead of ending at one they can', () => {
    // The shared bell tail is truncated at its own endpoint, not carried to
    // zero -- it is a Lorentzian, and f(t) / f(apex) is about 19% at the
    // default dynamic and responsiveness. Every release ramp in the app ends
    // that way. What matters is the absolute figure it leaves: at the
    // default settings the old cliff dropped 558px/s (9.3px per 60fps frame)
    // in one frame, and this leaves 39px/s, which is 0.65px. Pinned as a
    // per-frame pixel count rather than a ratio because that is the quantity
    // the eye actually judges.
    const profile = buildDefault()
    expect(profile.tailDurationMs).toBeGreaterThan(0)
    expect(profile.tailDistancePx).toBeGreaterThan(0)

    const h = 0.25
    const speedPxPerMsAt = (tMs: number) =>
      (sampleWheelSpinProfile(profile, tMs + h).travelledPx
        - sampleWheelSpinProfile(profile, tMs - h).travelledPx) / (2 * h)

    const joinSpeed = speedPxPerMsAt(profile.tailStartMs - 1)
    const endSpeed = speedPxPerMsAt(profile.totalDurationMs - 1)

    expect(joinSpeed * 16.7).toBeGreaterThan(5)
    expect(endSpeed * 16.7).toBeLessThan(1)
  })

  it('joins the tail at the speed the schedule ends on', () => {
    const profile = buildDefault()
    const h = 0.5
    const beforeJoin = (sampleWheelSpinProfile(profile, profile.tailStartMs).travelledPx
      - sampleWheelSpinProfile(profile, profile.tailStartMs - h).travelledPx) / h
    const afterJoin = (sampleWheelSpinProfile(profile, profile.tailStartMs + h).travelledPx
      - sampleWheelSpinProfile(profile, profile.tailStartMs).travelledPx) / h
    expect(Math.abs(afterJoin - beforeJoin) / beforeJoin).toBeLessThan(0.05)
  })

  it('reports finished only once the tail is spent', () => {
    const profile = buildDefault()
    expect(sampleWheelSpinProfile(profile, profile.tailStartMs).finished).toBe(false)
    expect(sampleWheelSpinProfile(profile, profile.totalDurationMs - 1).finished).toBe(false)
    expect(sampleWheelSpinProfile(profile, profile.totalDurationMs).finished).toBe(true)
  })

  it('gives the same distance however coarsely it is sampled', () => {
    // The property the old per-frame payout did not have: a caller that
    // misses frames is owed the same total as one that does not.
    const profile = buildDefault()
    const at = profile.tailStartMs * 0.6
    const fine = sampleWheelSpinProfile(buildDefault(), at).travelledPx
    let coarse = 0
    for (let tMs = 0; tMs <= at; tMs += 97) {
      coarse = sampleWheelSpinProfile(profile, Math.min(tMs, at)).travelledPx
    }
    coarse = sampleWheelSpinProfile(profile, at).travelledPx
    expect(coarse).toBeCloseTo(fine, 6)
  })

  it('runs at one constant speed forever at the endless dampen position', () => {
    const profile = buildWheelSpinProfile({
      direction: -1,
      pixelsPerNudge: PIXELS_PER_NUDGE,
      averageGapMs: 20,
      dampenDivisor: WHEEL_SPIN_DAMPEN_ENDLESS,
      cutoffMs: DEFAULT_WHEEL_SPIN_CUTOFF_MS,
    })
    expect(profile.endlessSpeedPxPerMs).toBeCloseTo(PIXELS_PER_NUDGE / 20, 10)
    expect(profile.totalDurationMs).toBe(Number.POSITIVE_INFINITY)
    expect(sampleWheelSpinProfile(profile, 60_000).finished).toBe(false)
    expect(sampleWheelSpinProfile(profile, 1000).travelledPx)
      .toBeCloseTo(PIXELS_PER_NUDGE * 50, 6)
  })

  it('plans a schedule of a sane length across the whole slider range', () => {
    for (const dampenDivisor of [1, 20, 50, 80, 100]) {
      for (const cutoffMs of [50, 150, 300, 500]) {
        for (const averageGapMs of [10, 20, 35, 50]) {
          const profile = buildWheelSpinProfile({
            direction: 1,
            pixelsPerNudge: PIXELS_PER_NUDGE,
            averageGapMs,
            dampenDivisor,
            cutoffMs,
          })
          expect(profile.timesMs.length).toBeGreaterThan(1)
          expect(profile.timesMs.length).toBeLessThan(200)
          expect(Number.isFinite(profile.totalDurationMs)).toBe(true)
        }
      }
    }
  })

  describe('the carry from the notch that started the coast', () => {
    const CARRY_PX = 130
    const CARRY_BLEND_MS = 110

    const buildCarried = (direction: 1 | -1 = 1, carryPx = CARRY_PX) =>
      buildWheelSpinProfile({
        direction,
        pixelsPerNudge: PIXELS_PER_NUDGE,
        averageGapMs: 20,
        dampenDivisor: DEFAULT_WHEEL_SPIN_DAMPEN_DIVISOR,
        cutoffMs: DEFAULT_WHEEL_SPIN_CUTOFF_MS,
        carryPx: direction * carryPx,
        carryBlendMs: CARRY_BLEND_MS,
      })

    it('delivers the remainder on top of the schedule, in full', () => {
      const plain = buildDefault()
      const carried = buildCarried()
      const plainEnd = sampleWheelSpinProfile(plain, plain.totalDurationMs).travelledPx
      const carriedEnd = sampleWheelSpinProfile(carried, carried.totalDurationMs).travelledPx
      expect(carriedEnd - plainEnd).toBeCloseTo(CARRY_PX, 6)
    })

    it('is fully folded in by the end of the blend, and not before', () => {
      const carried = buildCarried()
      const plain = buildDefault()
      const extraAt = (tMs: number) =>
        sampleWheelSpinProfile(carried, tMs).travelledPx
        - sampleWheelSpinProfile(plain, tMs).travelledPx
      expect(extraAt(0)).toBeCloseTo(0, 6)
      expect(extraAt(CARRY_BLEND_MS / 2)).toBeCloseTo(CARRY_PX / 2, 4)
      expect(extraAt(CARRY_BLEND_MS)).toBeCloseTo(CARRY_PX, 6)
      expect(extraAt(CARRY_BLEND_MS * 3)).toBeCloseTo(CARRY_PX, 6)
    })

    it('adds no velocity step at either end of the blend', () => {
      // The whole reason it is a smootherstep: an extra distance eased in
      // with zero velocity and zero acceleration at both ends cannot put
      // back the discontinuity this module exists to remove.
      const carried = buildCarried()
      const plain = buildDefault()
      const h = 0.25
      const speedAt = (profile: ReturnType<typeof buildDefault>, tMs: number) =>
        (sampleWheelSpinProfile(profile, tMs + h).travelledPx
          - sampleWheelSpinProfile(profile, tMs - h).travelledPx) / (2 * h)

      // At the opening edge there is nothing before t = 0 to measure across,
      // so the question is instead whether the carry has added any speed to
      // the coast yet. It must not have: that is what a zero derivative at
      // the start of the blend means.
      const plainOpening = speedAt(plain, 1)
      expect(Math.abs(speedAt(carried, 1) - plainOpening) / plainOpening).toBeLessThan(0.05)

      // At the closing edge the carry stops contributing, and the coast must
      // not drop when it does.
      const before = speedAt(carried, CARRY_BLEND_MS - 2)
      const after = speedAt(carried, CARRY_BLEND_MS + 2)
      expect(Math.abs(after - before) / before).toBeLessThan(0.05)
    })

    it('still never reverses', () => {
      const carried = buildCarried()
      let previousPx = -1
      for (let tMs = 0; tMs <= carried.totalDurationMs; tMs += 1) {
        const { travelledPx } = sampleWheelSpinProfile(carried, tMs)
        expect(travelledPx).toBeGreaterThan(previousPx)
        previousPx = travelledPx
      }
    })

    it('carries in the endless coast too', () => {
      const profile = buildWheelSpinProfile({
        direction: 1,
        pixelsPerNudge: PIXELS_PER_NUDGE,
        averageGapMs: 20,
        dampenDivisor: WHEEL_SPIN_DAMPEN_ENDLESS,
        cutoffMs: DEFAULT_WHEEL_SPIN_CUTOFF_MS,
        carryPx: CARRY_PX,
        carryBlendMs: CARRY_BLEND_MS,
      })
      expect(sampleWheelSpinProfile(profile, 1000).travelledPx)
        .toBeCloseTo((PIXELS_PER_NUDGE * 50) + CARRY_PX, 6)
    })

    it('spreads the carry over the whole schedule by default', () => {
      // Folded into the coast's opening instead, the same distance nearly
      // doubles the speed it starts at: measured 93% above the uncarried
      // coast at 55ms, against 19% at 1,163ms when spread, for an identical
      // total. A carry is owed, not urgent.
      const carried = buildWheelSpinProfile({
        direction: 1,
        pixelsPerNudge: PIXELS_PER_NUDGE,
        averageGapMs: 20,
        dampenDivisor: DEFAULT_WHEEL_SPIN_DAMPEN_DIVISOR,
        cutoffMs: DEFAULT_WHEEL_SPIN_CUTOFF_MS,
        carryPx: CARRY_PX,
      })
      const plain = buildDefault()
      expect(carried.carries[0].blendMs).toBeCloseTo(carried.tailStartMs, 6)

      const h = 0.25
      const speedAt = (profile: typeof carried, tMs: number) =>
        (sampleWheelSpinProfile(profile, tMs + h).travelledPx
          - sampleWheelSpinProfile(profile, tMs - h).travelledPx) / (2 * h)
      let peakRatio = 0
      for (let tMs = 1; tMs < carried.tailStartMs; tMs += 1) {
        peakRatio = Math.max(peakRatio, speedAt(carried, tMs) / speedAt(plain, tMs))
      }
      expect(peakRatio).toBeLessThan(1.25)
    })

    it('ignores a remainder pointing the other way', () => {
      // A leg reversing right as a spin is detected owes its distance to the
      // direction it was going, not to this coast.
      const profile = buildWheelSpinProfile({
        direction: 1,
        pixelsPerNudge: PIXELS_PER_NUDGE,
        averageGapMs: 20,
        dampenDivisor: DEFAULT_WHEEL_SPIN_DAMPEN_DIVISOR,
        cutoffMs: DEFAULT_WHEEL_SPIN_CUTOFF_MS,
        carryPx: -50,
        carryBlendMs: CARRY_BLEND_MS,
      })
      expect(profile.carries).toHaveLength(0)
    })

    it('is measured in the direction of travel, whichever way that is', () => {
      const up = buildCarried(-1)
      expect(up.carries[0].px).toBeCloseTo(CARRY_PX, 6)
      expect(sampleWheelSpinProfile(up, up.totalDurationMs).travelledPx)
        .toBeGreaterThan(sampleWheelSpinProfile(buildDefault(), up.totalDurationMs).travelledPx)
    })
  })

  describe('a nudge given DURING a coast', () => {
    const BLEND_MS = 200

    it('adds exactly one nudge, on top of everything else', () => {
      const plain = buildDefault()
      const extended = buildDefault()
      addWheelSpinProfileCarry(extended, PIXELS_PER_NUDGE, 600, BLEND_MS)
      const endMs = wheelSpinProfileEndMs(extended)
      const gained = sampleWheelSpinProfile(extended, endMs).travelledPx
        - sampleWheelSpinProfile(plain, endMs).travelledPx
      expect(gained).toBeCloseTo(PIXELS_PER_NUDGE, 6)
    })

    it('changes nothing before the moment it was asked for', () => {
      const plain = buildDefault()
      const extended = buildDefault()
      addWheelSpinProfileCarry(extended, PIXELS_PER_NUDGE, 600, BLEND_MS)
      for (const tMs of [0, 100, 400, 599]) {
        expect(sampleWheelSpinProfile(extended, tMs).travelledPx)
          .toBeCloseTo(sampleWheelSpinProfile(plain, tMs).travelledPx, 6)
      }
    })

    it('adds no velocity step at either end of its blend', () => {
      const extended = buildDefault()
      addWheelSpinProfileCarry(extended, PIXELS_PER_NUDGE, 600, BLEND_MS)
      for (const edgeMs of [600, 600 + BLEND_MS]) {
        const before = wheelSpinProfileSpeedPxPerMs(extended, edgeMs - 3)
        const after = wheelSpinProfileSpeedPxPerMs(extended, edgeMs + 3)
        expect(Math.abs(after - before) / before).toBeLessThan(0.1)
      }
    })

    it('accumulates when the reader keeps nudging', () => {
      const plain = buildDefault()
      const extended = buildDefault()
      for (let n = 0; n < 4; n += 1) {
        addWheelSpinProfileCarry(extended, PIXELS_PER_NUDGE, 400 + (n * 150), BLEND_MS)
      }
      const endMs = wheelSpinProfileEndMs(extended)
      expect(sampleWheelSpinProfile(extended, endMs).travelledPx
        - sampleWheelSpinProfile(plain, endMs).travelledPx)
        .toBeCloseTo(PIXELS_PER_NUDGE * 4, 6)
    })

    it('refuses a nudge pointing the other way -- that stops a coast, it does not shorten one', () => {
      const extended = buildDefault()
      addWheelSpinProfileCarry(extended, -PIXELS_PER_NUDGE, 600, BLEND_MS)
      expect(extended.carries).toHaveLength(0)
    })

    it('is not finished while a late nudge is still arriving', () => {
      // Reporting the coast over here would drop the very distance the
      // reader last asked for.
      const extended = buildDefault()
      const lateMs = extended.totalDurationMs - 20
      addWheelSpinProfileCarry(extended, PIXELS_PER_NUDGE, lateMs, BLEND_MS)
      expect(wheelSpinProfileEndMs(extended)).toBeGreaterThan(extended.totalDurationMs)
      expect(sampleWheelSpinProfile(extended, extended.totalDurationMs).finished).toBe(false)
      expect(sampleWheelSpinProfile(extended, wheelSpinProfileEndMs(extended)).finished).toBe(true)
    })

    it('still never reverses', () => {
      const extended = buildDefault()
      addWheelSpinProfileCarry(extended, PIXELS_PER_NUDGE, 600, BLEND_MS)
      addWheelSpinProfileCarry(extended, PIXELS_PER_NUDGE, 1700, BLEND_MS)
      let previousPx = -1
      for (let tMs = 0; tMs <= wheelSpinProfileEndMs(extended); tMs += 1) {
        const { travelledPx } = sampleWheelSpinProfile(extended, tMs)
        expect(travelledPx).toBeGreaterThan(previousPx)
        previousPx = travelledPx
      }
    })

    it('reports a speed a respin can be judged against', () => {
      const profile = buildDefault()
      const opening = wheelSpinProfileSpeedPxPerMs(profile, 1)
      const late = wheelSpinProfileSpeedPxPerMs(profile, profile.tailStartMs - 1)
      expect(opening).toBeCloseTo(PIXELS_PER_NUDGE / 20, 2)
      // A coast well into its decay is far slower than the rate it was set
      // at -- which is exactly why a respin is judged against this and not
      // against the coast's original gap.
      expect(late).toBeLessThan(opening * 0.25)
    })
  })
})

describe('what a replaced coast still owes', () => {
  it('is every carry not yet folded in, signed, and nothing once they have landed', () => {
    for (const direction of [1, -1] as const) {
      const profile = buildDefault({ direction, carryPx: direction * 200, carryBlendMs: 100 })
      addWheelSpinProfileCarry(profile, direction * PIXELS_PER_NUDGE, 50, 60)
      expect(wheelSpinProfileUndeliveredCarryPx(profile, 0)).toBeCloseTo(direction * (200 + PIXELS_PER_NUDGE), 9)
      let previous = Infinity
      for (let atMs = 0; atMs <= 120; atMs += 5) {
        const owed = Math.abs(wheelSpinProfileUndeliveredCarryPx(profile, atMs))
        expect(owed).toBeLessThanOrEqual(previous)
        previous = owed
      }
      expect(Math.abs(wheelSpinProfileUndeliveredCarryPx(profile, 111))).toBe(0)
    }
  })
})
