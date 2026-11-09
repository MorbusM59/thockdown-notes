/**
 * The music's EQ CURVE, drawn by the reader: a smooth path through points on
 * a plane of frequency (log, 20 Hz to 20 kHz) by gain (-EQ_DB_MAX..+EQ_DB_MAX
 * dB), played by a bank of peaking filters fitted to it. Music only: the
 * soundscape never has it. Pure, and shared with the main process's state
 * sanitizer.
 *
 * POINTS (`EqPoint`): a frequency, a gain and a HANDLE (0..1). The first point
 * sits at EQ_LOW_HZ and the last at EQ_HIGH_HZ; they can be raised, lowered and
 * given handles, but not moved along the axis or removed. Points in between
 * keep at least EQ_MIN_GAP_SEMITONES from their neighbours, so their order is
 * fixed and two never share a frequency.
 *
 * THE PATH is a cubic Bezier between each pair of neighbouring points, on the
 * plane of semitones (from EQ_LOW_HZ) by dB. Each point's two handles point
 * the same way and are equally long: along the line from the previous point to
 * the next (the end points: towards their one neighbour), which is the
 * direction that bends the curve least through the point. A handle's length is
 * set by how far it reaches ALONG THE FREQUENCY AXIS: `handle` times half the
 * gap to the nearer neighbour, so 0 is a corner, 1 a round point, and up to
 * EQ_HANDLE_MAX (2) a flatter plateau. Where two facing handles would together
 * reach past the gap between their points, both are shortened in proportion
 * until they just meet (`eqSegment`), which keeps each segment's control
 * points in frequency order and so the path a function of frequency at every
 * setting: one gain per frequency, never a loop.
 *
 * PLAYED (`fitEqBandGains`): the path is sampled on EQ_GRID_POINTS and a bank
 * of EQ_BAND_COUNT peaking filters is fitted to it once per change of the
 * curve (least squares on the filters' real dB responses, then a fixed number
 * of corrections for their interaction), so only the band gains are applied
 * while the music plays.
 */

import {
  curvePointXRange,
  curveSegment,
  curveYAt,
  editCurvePoint,
  insertCurvePoint,
  insertCurvePointAfter,
  removeCurvePoint,
  sanitizeCurve,
  setCurvePointX,
  type CurvePlane,
  type CurvePoint,
} from './drawnCurve'

export interface EqPoint {
  /** EQ_LOW_HZ..EQ_HIGH_HZ. */
  hz: number
  /** -EQ_DB_MAX..+EQ_DB_MAX. */
  db: number
  /** 0..EQ_HANDLE_MAX: how round the curve is through this point (see the header). */
  handle: number
}

/** In frequency order, the first at EQ_LOW_HZ and the last at EQ_HIGH_HZ. */
export type EqCurve = readonly EqPoint[]

export const EQ_LOW_HZ = 20
export const EQ_HIGH_HZ = 20000
export const EQ_DB_MAX = 15
/** One arrow press, wheel notch or drag step of gain. */
export const EQ_DB_STEP = 0.5
/** One arrow press, wheel notch or drag step of frequency, in semitones. */
export const EQ_SEMITONE_STEP = 1
export const EQ_HANDLE_STEP = 0.05
/** The handle a point placed by the reader starts with. */
export const EQ_DEFAULT_HANDLE = 1
export const EQ_HANDLE_MAX = 2
export const EQ_MIN_GAP_SEMITONES = 1
/** The end points included. */
export const EQ_MAX_POINTS = 12

/** The whole axis in semitones, about 119.6. */
export const EQ_SPAN_SEMITONES = 12 * Math.log2(EQ_HIGH_HZ / EQ_LOW_HZ)

export function semitonesOf(hz: number): number {
  return 12 * Math.log2(hz / EQ_LOW_HZ)
}

export function hzAtSemitones(semitones: number): number {
  return EQ_LOW_HZ * (2 ** (semitones / 12))
}

/** Frequency at a share 0..1 of the log axis. */
export function eqFrequencyAt(x: number): number {
  return EQ_LOW_HZ * ((EQ_HIGH_HZ / EQ_LOW_HZ) ** x)
}

export const FLAT_EQ_CURVE: EqCurve = [
  { hz: EQ_LOW_HZ, db: 0, handle: 0 },
  { hz: EQ_HIGH_HZ, db: 0, handle: 0 },
]

/** The EQ's plane for the shared curve model (`drawnCurve.ts`): semitones above EQ_LOW_HZ by dB. */
export const EQ_PLANE: CurvePlane = {
  xMax: EQ_SPAN_SEMITONES,
  yMin: -EQ_DB_MAX,
  yMax: EQ_DB_MAX,
  minGap: EQ_MIN_GAP_SEMITONES,
  maxPoints: EQ_MAX_POINTS,
  handleMax: EQ_HANDLE_MAX,
  wrap: false,
}

/** The curve on its plane: semitones and dB. */
export function eqToPlane(curve: EqCurve): CurvePoint[] {
  return curve.map((point) => ({ x: semitonesOf(point.hz), y: point.db, handle: point.handle }))
}

/** Back from the plane, the ends exactly on the axis's frequencies and the rest to a millionth of a hertz, so a frequency's round trip through semitones comes back as it went. */
export function eqFromPlane(points: readonly CurvePoint[]): EqPoint[] {
  return points.map((point, index) => ({
    hz: index === 0 ? EQ_LOW_HZ : index === points.length - 1 ? EQ_HIGH_HZ : Math.round(hzAtSemitones(point.x) * 1e6) / 1e6,
    db: point.y,
    handle: point.handle,
  }))
}

/**
 * Any stored value into a valid curve (`sanitizeCurve`): the ends pinned to
 * the axis, the points between in order and apart, at most EQ_MAX_POINTS.
 * Anything that is not a list (a curve stored in an older form) is the flat curve.
 */
export function sanitizeEqCurve(value: unknown): EqPoint[] {
  if (!Array.isArray(value)) return eqFromPlane(eqToPlane(FLAT_EQ_CURVE))
  const onPlane = value.map((entry) => {
    const record = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const hz = typeof record.hz === 'number' && record.hz > 0 ? record.hz : NaN
    return { x: semitonesOf(hz), y: record.db, handle: record.handle }
  })
  return eqFromPlane(sanitizeCurve(EQ_PLANE, onPlane, eqToPlane(FLAT_EQ_CURVE)))
}

/** Two curves are one when they have the same points, each value agreeing to a thousandth (frequency relatively). */
export function sameEqCurve(a: EqCurve, b: EqCurve): boolean {
  return a.length === b.length && a.every((point, i) => (
    Math.abs(point.hz - b[i].hz) < point.hz * 1e-5
    && Math.abs(point.db - b[i].db) < 0.0005
    && Math.abs(point.handle - b[i].handle) < 0.0005
  ))
}

export function isEqFlat(curve: EqCurve): boolean {
  return curve.every((point) => point.db === 0)
}

/** One segment's four control points, as [semitones, dB] pairs. */
export function eqSegment(curve: EqCurve, index: number): [number, number][] {
  return curveSegment(EQ_PLANE, eqToPlane(curve), index)
}

/** The curve's gain in dB at `semitones`, clamped to the plane. */
export function eqCurveDbAt(curve: EqCurve, semitones: number): number {
  return curveYAt(EQ_PLANE, eqToPlane(curve), semitones)
}

/** Where the curve is sampled for fitting and drawing: evenly on the log axis. */
export const EQ_GRID_POINTS = 241
const GRID: readonly number[] = Array.from({ length: EQ_GRID_POINTS }, (_, k) => k / (EQ_GRID_POINTS - 1))

/** The target in dB at each grid point. All zeros when flat. */
export function eqCurveGainsDb(curve: EqCurve): Float64Array {
  const out = new Float64Array(EQ_GRID_POINTS)
  if (isEqFlat(curve)) return out
  const points = eqToPlane(curve)
  for (let k = 0; k < EQ_GRID_POINTS; k += 1) out[k] = curveYAt(EQ_PLANE, points, GRID[k] * EQ_SPAN_SEMITONES)
  return out
}

// ── The filter bank ─────────────────────────────────────────────────────────

/** Third-octave centres from 20 Hz: 20 * 2^(k/3), the last at 20.3 kHz. */
export const EQ_BAND_COUNT = 31
export const EQ_BAND_FREQUENCIES_HZ: readonly number[] = Array.from({ length: EQ_BAND_COUNT }, (_, k) => EQ_LOW_HZ * 2 ** (k / 3))
/**
 * Wider than the third-octave spacing: a bell exactly as wide as the gap
 * between centres (Q ~4.3) leaves a dip between neighbours and a bump at each
 * centre, a scalloped ripple of about +-0.5 dB that the fit cannot remove,
 * since it sets only the heights. Overlapping bells sum smoothly, and the fit
 * already accounts for the overlap; the cost is that the narrowest spikes come
 * out a little rounder.
 */
export const EQ_BAND_Q = 1.5
/** The rate the fit assumes; a peaking filter's shape barely changes between 44.1 and 48 kHz in the audible range. */
const FIT_SAMPLE_RATE = 48000

/**
 * The dB response at `frequencyHz` of one peaking filter as Web Audio builds
 * it (the Audio EQ Cookbook's peakingEQ, which is what BiquadFilterNode
 * implements), at `gainDb`.
 */
function peakingResponseDb(centreHz: number, q: number, gainDb: number, frequencyHz: number): number {
  if (gainDb === 0) return 0
  const A = 10 ** (gainDb / 40)
  const w0 = (2 * Math.PI * centreHz) / FIT_SAMPLE_RATE
  const alpha = Math.sin(w0) / (2 * q)
  const cosw0 = Math.cos(w0)
  const b0 = 1 + (alpha * A)
  const b1 = -2 * cosw0
  const b2 = 1 - (alpha * A)
  const a0 = 1 + (alpha / A)
  const a1 = -2 * cosw0
  const a2 = 1 - (alpha / A)
  const w = (2 * Math.PI * frequencyHz) / FIT_SAMPLE_RATE
  const c1 = Math.cos(w)
  const s1 = Math.sin(w)
  const c2 = Math.cos(2 * w)
  const s2 = Math.sin(2 * w)
  const numRe = b0 + (b1 * c1) + (b2 * c2)
  const numIm = -((b1 * s1) + (b2 * s2))
  const denRe = a0 + (a1 * c1) + (a2 * c2)
  const denIm = -((a1 * s1) + (a2 * s2))
  return 10 * Math.log10(((numRe * numRe) + (numIm * numIm)) / ((denRe * denRe) + (denIm * denIm)))
}

const GRID_HZ = GRID.map(eqFrequencyAt)

/** The bank's dB response on the grid for the given band gains. */
export function eqBankResponseDb(gainsDb: ArrayLike<number>): Float64Array {
  const out = new Float64Array(EQ_GRID_POINTS)
  for (let band = 0; band < EQ_BAND_COUNT; band += 1) {
    const gain = gainsDb[band]
    if (gain === 0) continue
    for (let k = 0; k < EQ_GRID_POINTS; k += 1) out[k] += peakingResponseDb(EQ_BAND_FREQUENCIES_HZ[band], EQ_BAND_Q, gain, GRID_HZ[k])
  }
  return out
}

/** Each band's response at 1 dB, the linear model the fit starts from. */
const UNIT_BASIS: readonly Float64Array[] = EQ_BAND_FREQUENCIES_HZ.map((centre) => (
  Float64Array.from(GRID_HZ, (hz) => peakingResponseDb(centre, EQ_BAND_Q, 1, hz))
))

/** B^T B + lambda I, the same for every curve, so built once. */
const NORMAL_MATRIX: Float64Array = (() => {
  const n = EQ_BAND_COUNT
  const m = new Float64Array(n * n)
  const ridge = 1e-3
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      let sum = 0
      for (let k = 0; k < EQ_GRID_POINTS; k += 1) sum += UNIT_BASIS[i][k] * UNIT_BASIS[j][k]
      m[(i * n) + j] = sum + (i === j ? ridge : 0)
    }
  }
  return m
})()

/** Normal equations (B^T B + lambda I) g = B^T r, solved by Gaussian elimination. */
function solveLeastSquares(residual: Float64Array): Float64Array {
  const n = EQ_BAND_COUNT
  const m = new Float64Array(n * (n + 1))
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) m[(i * (n + 1)) + j] = NORMAL_MATRIX[(i * n) + j]
    let rhs = 0
    for (let k = 0; k < EQ_GRID_POINTS; k += 1) rhs += UNIT_BASIS[i][k] * residual[k]
    m[(i * (n + 1)) + n] = rhs
  }
  for (let col = 0; col < n; col += 1) {
    let pivot = col
    for (let row = col + 1; row < n; row += 1) if (Math.abs(m[(row * (n + 1)) + col]) > Math.abs(m[(pivot * (n + 1)) + col])) pivot = row
    if (pivot !== col) {
      for (let j = col; j <= n; j += 1) {
        const t = m[(col * (n + 1)) + j]
        m[(col * (n + 1)) + j] = m[(pivot * (n + 1)) + j]
        m[(pivot * (n + 1)) + j] = t
      }
    }
    const diag = m[(col * (n + 1)) + col]
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue
      const factor = m[(row * (n + 1)) + col] / diag
      if (factor === 0) continue
      for (let j = col; j <= n; j += 1) m[(row * (n + 1)) + j] -= factor * m[(col * (n + 1)) + j]
    }
  }
  return Float64Array.from({ length: n }, (_, i) => m[(i * (n + 1)) + n] / m[(i * (n + 1)) + i])
}

/** How many times the fit corrects for the filters not adding exactly in dB; a fixed count, so the cost is fixed. */
const FIT_CORRECTIONS = 3

/** The band gains in dB that make the bank follow the curve: all zeros when the EQ is off. */
export function fitEqBandGains(curve: EqCurve): Float64Array {
  const gains = new Float64Array(EQ_BAND_COUNT)
  if (isEqFlat(curve)) return gains
  const target = eqCurveGainsDb(curve)
  let residual = target
  for (let pass = 0; pass <= FIT_CORRECTIONS; pass += 1) {
    const step = solveLeastSquares(residual)
    for (let band = 0; band < EQ_BAND_COUNT; band += 1) gains[band] += step[band]
    const response = eqBankResponseDb(gains)
    residual = Float64Array.from(target, (value, k) => value - response[k])
  }
  return gains
}

// ── Editing ─────────────────────────────────────────────────────────────────
// The shared model's operations (`drawnCurve.ts`) in the EQ's units.

/** The range of frequency, in semitones, a point may move in: fixed for the ends, between its neighbours' gaps otherwise. */
export function eqPointSemitoneRange(curve: EqCurve, index: number): [number, number] {
  return curvePointXRange(EQ_PLANE, eqToPlane(curve), index)
}

/** One point changed, each value clamped to what the point may take. */
export function editEqPoint(curve: EqCurve, index: number, change: { semitones?: number; db?: number; handle?: number }): EqPoint[] {
  return eqFromPlane(editCurvePoint(EQ_PLANE, eqToPlane(curve), index, { x: change.semitones, y: change.db, handle: change.handle }))
}

const placed = (result: { curve: CurvePoint[]; index: number } | null) => (result ? { curve: eqFromPlane(result.curve), index: result.index } : null)

/** A new point at `semitones` and `db`, or null when it cannot go there (the curve is full, or a neighbour is too close). */
export function insertEqPoint(curve: EqCurve, semitones: number, db: number, handle = EQ_DEFAULT_HANDLE): { curve: EqPoint[]; index: number } | null {
  return placed(insertCurvePoint(EQ_PLANE, eqToPlane(curve), semitones, db, handle))
}

/** A point halfway (in frequency) between point `index` and the next one, on the curve; for the last point, between it and the one before. */
export function insertEqPointAfter(curve: EqCurve, index: number): { curve: EqPoint[]; index: number } | null {
  return placed(insertCurvePointAfter(EQ_PLANE, eqToPlane(curve), index, EQ_SEMITONE_STEP, EQ_DB_STEP, EQ_DEFAULT_HANDLE))
}

/** The curve without point `index`; the ends cannot be removed. */
export function removeEqPoint(curve: EqCurve, index: number): EqPoint[] {
  return eqFromPlane(removeCurvePoint(eqToPlane(curve), index))
}

/** A typed frequency, which may land past a neighbour (`setCurvePointX`); null where it is refused. */
export function setEqPointFrequency(curve: EqCurve, index: number, hz: number): { curve: EqPoint[]; index: number } | null {
  if (!(hz > 0)) return null
  return placed(setCurvePointX(EQ_PLANE, eqToPlane(curve), index, semitonesOf(hz)))
}
