import { describe, expect, it } from 'vitest'

import {
  EQ_BAND_COUNT,
  EQ_GRID_POINTS,
  EQ_HIGH_HZ,
  EQ_LOW_HZ,
  EQ_MAX_POINTS,
  EQ_SPAN_SEMITONES,
  FLAT_EQ_CURVE,
  eqBankResponseDb,
  eqCurveDbAt,
  eqCurveGainsDb,
  editEqPoint,
  eqSegment,
  insertEqPoint,
  insertEqPointAfter,
  removeEqPoint,
  setEqPointFrequency,
  fitEqBandGains,
  hzAtSemitones,
  sanitizeEqCurve,
  semitonesOf,
  type EqPoint,
} from './musicEqCurve'

function curve(...middle: [number, number, number][]): EqPoint[] {
  return [
    { hz: EQ_LOW_HZ, db: 2, handle: 0.3 },
    ...middle.map(([hz, db, handle]) => ({ hz, db, handle })),
    { hz: EQ_HIGH_HZ, db: -3, handle: 0.6 },
  ]
}

const SAMPLES: EqPoint[][] = []
for (const handle of [0, 0.25, 0.5, 1, 2]) {
  SAMPLES.push(curve([100, 6, handle], [1000, -6, handle], [8000, 4, handle]))
  SAMPLES.push(curve([60, -12, handle], [61, 12, handle], [5000, 15, handle], [5200, -15, handle]))
  SAMPLES.push(curve([400, 9, handle]))
}

describe('musicEqCurve', () => {
  it('is exactly flat when every point is at 0 dB', () => {
    expect(Array.from(fitEqBandGains(FLAT_EQ_CURVE)).every((gain) => gain === 0)).toBe(true)
  })

  it('passes through every point', () => {
    for (const points of SAMPLES) {
      for (const point of points) expect(eqCurveDbAt(points, semitonesOf(point.hz))).toBeCloseTo(point.db, 6)
    }
  })

  it('keeps each segment a function of frequency at every handle length', () => {
    for (const points of SAMPLES) {
      for (let index = 0; index < points.length - 1; index += 1) {
        const xs = eqSegment(points, index).map(([x]) => x)
        for (let k = 1; k < xs.length; k += 1) expect(xs[k]).toBeGreaterThanOrEqual(xs[k - 1] - 1e-9)
      }
    }
  })

  it('is straight between points with no handles', () => {
    const points = curve([1000, 10, 0]).map((point) => ({ ...point, handle: 0 }))
    const mid = (semitonesOf(1000) + semitonesOf(EQ_HIGH_HZ)) / 2
    expect(eqCurveDbAt(points, mid)).toBeCloseTo((10 - 3) / 2, 6)
  })

  it('is played by the bank within half a dB from 30 Hz to 10 kHz on smooth curves', () => {
    let worst = 0
    for (const handle of [0.5, 1]) {
      const points = curve([100, 6, handle], [1000, -6, handle], [8000, 4, handle])
      const gains = fitEqBandGains(points)
      expect(gains.length).toBe(EQ_BAND_COUNT)
      const target = eqCurveGainsDb(points)
      const response = eqBankResponseDb(gains)
      for (let k = 14; k < 201; k += 1) worst = Math.max(worst, Math.abs(response[k] - target[k]))
    }
    expect(worst).toBeLessThan(0.5)
    expect(EQ_GRID_POINTS).toBeGreaterThan(200)
  })

  it('sanitizes into a valid curve', () => {
    expect(sanitizeEqCurve({ skew: 1 })).toEqual(FLAT_EQ_CURVE)
    const out = sanitizeEqCurve([
      { hz: 5, db: 99, handle: 3 },
      { hz: 200, db: 1, handle: 0.5 },
      { hz: 205, db: 2, handle: 0.5 },
      { hz: 100, db: 2, handle: 0.5 },
      { hz: 'x', db: 0 },
      { hz: 30000, db: -99, handle: -1 },
    ])
    expect(out).toEqual([
      { hz: EQ_LOW_HZ, db: 15, handle: 2 },
      { hz: 200, db: 1, handle: 0.5 },
      { hz: EQ_HIGH_HZ, db: -15, handle: 0 },
    ])
    const many = Array.from({ length: 30 }, (_, k) => ({ hz: hzAtSemitones(2 + (k * 3)), db: 0, handle: 0 }))
    expect(sanitizeEqCurve([FLAT_EQ_CURVE[0], ...many, FLAT_EQ_CURVE[1]]).length).toBe(EQ_MAX_POINTS)
    expect(semitonesOf(EQ_HIGH_HZ)).toBeCloseTo(EQ_SPAN_SEMITONES, 9)
  })
})

describe('musicEqCurve editing', () => {
  const base = curve([1000, 0, 0.5])

  it('keeps the ends on the axis and the points between their neighbours', () => {
    expect(editEqPoint(base, 0, { semitones: 30, db: 4 })[0]).toEqual({ hz: EQ_LOW_HZ, db: 4, handle: 0.3 })
    const moved = editEqPoint(base, 1, { semitones: 500, db: 99, handle: 2 })[1]
    expect(semitonesOf(moved.hz)).toBeCloseTo(EQ_SPAN_SEMITONES - 1, 9)
    expect(moved.db).toBe(15)
    expect(moved.handle).toBe(2)
  })

  it('inserts in order, refuses one too close or past the cap, and never removes an end', () => {
    const added = insertEqPoint(base, 12, 3)
    expect(added?.index).toBe(1)
    expect(added?.curve.length).toBe(4)
    expect(insertEqPoint(base, 0.5, 0)).toBeNull()
    expect(insertEqPoint(base, semitonesOf(1000) + 0.5, 0)).toBeNull()
    let full: EqPoint[] = base
    for (let k = 1; full.length < EQ_MAX_POINTS; k += 1) full = insertEqPoint(full, k * 6, 0)?.curve ?? full
    expect(insertEqPoint(full, 100, 0)).toBeNull()
    expect(removeEqPoint(base, 0)).toEqual(base)
    expect(removeEqPoint(base, 2)).toEqual(base)
    expect(removeEqPoint(base, 1).length).toBe(2)
  })

  it('moves a typed frequency past its neighbours into its place, inside the axis', () => {
    const points = curve([100, 1, 0.5], [1000, 2, 0.5])
    const moved = setEqPointFrequency(points, 1, 5000)
    expect(moved?.index).toBe(2)
    expect(moved?.curve.map((point) => Math.round(point.hz))).toEqual([20, 1000, 5000, 20000])
    expect(moved?.curve[2].db).toBe(1)
    expect(semitonesOf(setEqPointFrequency(points, 1, 99999)!.curve[2].hz)).toBeCloseTo(EQ_SPAN_SEMITONES - 1, 9)
    expect(setEqPointFrequency(points, 1, 1001)).toBeNull()
    expect(setEqPointFrequency(points, 0, 500)).toBeNull()
  })

  it('adds a point between a point and the next one, on the curve', () => {
    const added = insertEqPointAfter(base, 1)
    expect(added?.index).toBe(2)
    const at = semitonesOf(added!.curve[2].hz)
    expect(at).toBeGreaterThan(semitonesOf(1000))
    expect(added!.curve[2].db).toBeCloseTo(Math.round(eqCurveDbAt(base, at) * 2) / 2, 9)
    expect(insertEqPointAfter(base, 2)?.index).toBe(2)
  })
})
