import { describe, expect, it } from 'vitest'

import {
  EQ_BAND_COUNT,
  FLAT_EQ_CURVE,
  eqBankResponseDb,
  eqCurveGainsDb,
  fitEqBandGains,
  sanitizeEqCurve,
  type EqCurveParams,
} from './musicEqCurve'

const SAMPLES: EqCurveParams[] = []
for (const skew of [-3, -1.5, 0, 1, 3]) {
  for (const shape of [-5, -1, -0.3, 0.5, 2, 5]) {
    for (const stretch of [1, 2.5, 5]) SAMPLES.push({ skew, shape, stretch, amount: 10 })
  }
}

function maxAbs(values: ArrayLike<number>): number {
  let out = 0
  for (let k = 0; k < values.length; k += 1) out = Math.max(out, Math.abs(values[k]))
  return out
}

describe('musicEqCurve', () => {
  it('is exactly flat when off', () => {
    expect(maxAbs(fitEqBandGains(FLAT_EQ_CURVE))).toBe(0)
    expect(maxAbs(fitEqBandGains({ skew: 1, shape: 0, stretch: 2, amount: 12 }))).toBe(0)
    expect(maxAbs(fitEqBandGains({ skew: 1, shape: 2, stretch: 2, amount: 0 }))).toBe(0)
  })

  it('spans exactly -amount..+amount wherever it is on', () => {
    for (const params of SAMPLES) {
      const target = eqCurveGainsDb(params)
      const values = Array.from(target)
      expect(Math.min(...values)).toBeCloseTo(-10, 9)
      expect(Math.max(...values)).toBeCloseTo(10, 9)
    }
  })

  it('is finite everywhere and the bank follows it', () => {
    let worst = 0
    let edge = 0
    for (const params of SAMPLES) {
      const gains = fitEqBandGains(params)
      expect(gains.length).toBe(EQ_BAND_COUNT)
      for (const gain of gains) expect(Number.isFinite(gain)).toBe(true)
      const target = eqCurveGainsDb(params)
      const response = eqBankResponseDb(gains)
      // 30 Hz to 10 kHz: at the window's ends the curve can rise near-vertically (a plateau's power 1/|shape|)
      // and a third-octave bank rolls off there, so the edges (to 18 kHz; above it nothing is held) get a looser bound.
      for (let k = 0; k < 235; k += 1) edge = Math.max(edge, Math.abs(response[k] - target[k]))
      for (let k = 14; k < 201; k += 1) worst = Math.max(worst, Math.abs(response[k] - target[k]))
    }
    expect(worst).toBeLessThan(1.5)
    expect(edge).toBeLessThan(7)
  })

  it('snaps shape to its 0.1 grid and clamps', () => {
    expect(sanitizeEqCurve({ skew: 9, shape: 0.04, stretch: 0, amount: 99 })).toEqual({ skew: 3, shape: 0, stretch: 1, amount: 15 })
    expect(sanitizeEqCurve({ shape: 1.26 }).shape).toBeCloseTo(1.3, 9)
    expect(sanitizeEqCurve(null)).toEqual(FLAT_EQ_CURVE)
  })
})
