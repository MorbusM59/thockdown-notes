import { describe, expect, it } from 'vitest'
import { RESTING, speedShareAt, stepSpeedEnvelope, type SpeedCurve, type SpeedEnvelopeState } from './speedEnvelope'

const curves: SpeedCurve[] = [
  { ramp: 5 / 3, shape: 0.5, speedSec: 1.5 },
  { ramp: 0.3, shape: 0.2, speedSec: 0.8 },
  { ramp: 4.5, shape: 0.85, speedSec: 3 },
]

describe('speed envelope', () => {
  it('is exactly at rest at both ends of the curve and exactly at full pace at its apex', () => {
    for (const curve of curves) {
      expect(speedShareAt(curve, 0)).toBeCloseTo(0, 9)
      expect(speedShareAt(curve, 1)).toBeCloseTo(0, 9)
      expect(speedShareAt(curve, curve.shape)).toBeCloseTo(1, 9)
    }
  })

  it('reaches full pace after the ease in, and rest after the ease out', () => {
    for (const curve of curves) {
      let state: SpeedEnvelopeState = RESTING
      let share = 0
      for (let i = 0; i < 400; i += 1) ({ state, share } = stepSpeedEnvelope(curve, state, 1, 1 / 60))
      expect(share).toBeCloseTo(1, 9)
      for (let i = 0; i < 400; i += 1) ({ state, share } = stepSpeedEnvelope(curve, state, 0, 1 / 60))
      expect(share).toBeCloseTo(0, 9)
    }
  })

  it('keeps the pace continuous through a change of direction part-way through either half', () => {
    for (const curve of curves) {
      let state: SpeedEnvelopeState = RESTING
      let share = 0
      const frame = 1 / 240
      const largestStep = (from: number, target: 0 | 1, frames: number) => {
        let previous = from
        let worst = 0
        for (let i = 0; i < frames; i += 1) {
          ;({ state, share } = stepSpeedEnvelope(curve, state, target, frame))
          worst = Math.max(worst, Math.abs(share - previous))
          previous = share
        }
        return worst
      }
      // Up part-way, down part-way, up again, down to rest: no frame jumps.
      expect(largestStep(share, 1, 60)).toBeLessThan(0.1)
      expect(largestStep(share, 0, 40)).toBeLessThan(0.1)
      expect(largestStep(share, 1, 30)).toBeLessThan(0.1)
      expect(largestStep(share, 0, 2000)).toBeLessThan(0.1)
      expect(share).toBeCloseTo(0, 9)
    }
  })

  it('changes at once when the curve takes no time', () => {
    const instant: SpeedCurve = { ramp: 5 / 3, shape: 0.5, speedSec: 0 }
    expect(stepSpeedEnvelope(instant, RESTING, 1, 0.016).share).toBeCloseTo(1, 9)
  })
})
