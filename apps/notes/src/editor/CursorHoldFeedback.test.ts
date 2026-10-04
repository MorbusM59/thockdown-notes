import { describe, expect, it } from 'vitest'
import {
  cursorClickApexTimeSec,
  cursorHoldHaloMultiplier,
  cursorTwitchDurationSec,
  cursorTwitchRadiusMultiplier,
  resolveCursorClickDurationSec,
  sampleCursorHoldLevel,
  sampleCursorHoldReleaseLevel,
} from './CursorClickCurve'
import {
  CURSOR_CLICK_RAMP_DEFAULT,
  CURSOR_CLICK_SKEW_DEFAULT,
  CURSOR_CLICK_SPEED_X_DEFAULT,
  CURSOR_CLICK_MAX_SPEED_DEFAULT,
} from '@thockdown/look/cursorSettings'

const RAMP = CURSOR_CLICK_RAMP_DEFAULT
const SKEW = CURSOR_CLICK_SKEW_DEFAULT
const DURATION = cursorTwitchDurationSec(resolveCursorClickDurationSec(CURSOR_CLICK_SPEED_X_DEFAULT))

function sample(direction: -1 | 1, elapsedSec: number, maxImpact = CURSOR_CLICK_MAX_SPEED_DEFAULT): number {
  return cursorTwitchRadiusMultiplier(direction, elapsedSec, RAMP, SKEW, DURATION, maxImpact)
}

describe('the confirmation twitch', () => {
  it('runs at the click response\'s own duration, not a fraction of it', () => {
    // Pinned because it was HALF, and the halving was dropped by feel rather
    // than by reasoning -- exactly the kind of decision that drifts back.
    for (const speedX of [0, 0.25, 0.6, 0.9, 1]) {
      const clickDurationSec = resolveCursorClickDurationSec(speedX)
      expect(cursorTwitchDurationSec(clickDurationSec)).toBeCloseTo(clickDurationSec, 10)
    }
  })

  it('reaches exactly the held radius times (1 + max impact), or divided by it', () => {
    // The property the whole thing exists for: the excursion is measured
    // from wherever the hold left the orbit, and the two polarities are
    // exact reciprocals rather than merely similar-looking.
    const apexSec = cursorClickApexTimeSec(SKEW, DURATION)
    for (const maxImpact of [0.05, 0.35, 0.7, 1]) {
      expect(sample(1, apexSec, maxImpact)).toBeCloseTo(1 + maxImpact, 10)
      expect(sample(-1, apexSec, maxImpact)).toBeCloseTo(1 / (1 + maxImpact), 10)
      expect(sample(1, apexSec, maxImpact) * sample(-1, apexSec, maxImpact)).toBeCloseTo(1, 10)
    }
  })

  it('starts and finishes at exactly the held radius, so nothing has to put it back', () => {
    // Both ends are exactly 1 -- the press axis keeps sustaining underneath,
    // so a twitch that ends at a factor of 1 has already restored the held
    // state. Exactly, not nearly: the underlying bell stands at ~0.098 of its
    // peak at both ends, and discarding the twitch with 3.6% of radius still
    // standing pops. Fails without twitchHeight's floor subtraction.
    for (const direction of [-1, 1] as const) {
      expect(sample(direction, 0)).toBeCloseTo(1, 10)
      expect(sample(direction, DURATION)).toBeCloseTo(1, 10)
    }
  })

  it('never overshoots its apex anywhere in between', () => {
    const apex = sample(1, cursorClickApexTimeSec(SKEW, DURATION))
    for (let t = 0; t <= DURATION; t += DURATION / 200) {
      const expanding = sample(1, t)
      expect(expanding).toBeGreaterThanOrEqual(1 - 1e-9)
      expect(expanding).toBeLessThanOrEqual(apex + 1e-9)
      // The mirror holds at every sample, not only at the apex.
      expect(expanding * sample(-1, t)).toBeCloseTo(1, 10)
    }
  })

  it('does nothing at all when max impact is zero', () => {
    for (let t = 0; t <= DURATION; t += DURATION / 20) {
      expect(sample(1, t, 0)).toBeCloseTo(1, 10)
      expect(sample(-1, t, 0)).toBeCloseTo(1, 10)
    }
  })
})

describe("the halo's swell while a hold runs", () => {
  const HOLD_SEC = 0.25

  const level = (elapsedSec: number) => sampleCursorHoldLevel(elapsedSec, RAMP, SKEW, HOLD_SEC)

  it('reaches full extension exactly at the threshold, and not before', () => {
    // The property the stretch exists for: full halo means "now", so the
    // apex has to land on the hold's own duration rather than on the speed
    // slider's. Fails if the curve is not stretched by 1/skew.
    expect(level(HOLD_SEC)).toBeCloseTo(1, 10)
    for (const fraction of [0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
      expect(level(HOLD_SEC * fraction)).toBeLessThan(1)
    }
  })

  it('rises from exactly nothing, and never falls back on the way up', () => {
    expect(level(0)).toBeCloseTo(0, 10)
    let previous = -1
    for (let t = 0; t <= HOLD_SEC; t += HOLD_SEC / 200) {
      const current = level(t)
      expect(current).toBeGreaterThanOrEqual(previous - 1e-12)
      previous = current
    }
  })

  it('holds full extension for a hold that outlives its own threshold', () => {
    // An abandon that has not arrived yet must not start the halo shrinking.
    expect(level(HOLD_SEC * 4)).toBe(1)
  })

  it('scales the halo to exactly (1 + max impact) at full extension', () => {
    for (const maxImpact of [0, 0.35, 0.7, 1]) {
      expect(cursorHoldHaloMultiplier(1, maxImpact)).toBeCloseTo(1 + maxImpact, 10)
      expect(cursorHoldHaloMultiplier(0, maxImpact)).toBeCloseTo(1, 10)
    }
  })

  it('releases from wherever an abandoned hold actually got to, back to nothing', () => {
    // An abandoned hold is a completed one caught early -- same release,
    // seeded lower. Nothing about it is a separate animation.
    const releaseDurationSec = resolveCursorClickDurationSec(CURSOR_CLICK_SPEED_X_DEFAULT)
    for (const caughtAt of [0.2, 0.5, 0.8, 1]) {
      const initial = level(HOLD_SEC * caughtAt)
      const decay = (t: number) => sampleCursorHoldReleaseLevel(initial, t, RAMP, SKEW, releaseDurationSec)
      expect(decay(0)).toBeCloseTo(initial, 10)
      expect(decay(releaseDurationSec)).toBeCloseTo(0, 10)
      let previous = Infinity
      for (let t = 0; t <= releaseDurationSec; t += releaseDurationSec / 100) {
        expect(decay(t)).toBeLessThanOrEqual(previous + 1e-12)
        previous = decay(t)
      }
    }
  })
})
