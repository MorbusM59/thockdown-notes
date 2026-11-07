/**
 * The music's EQ CURVE: one bump (or dip) across the audible range, shaped
 * by four numbers, skew (a), shape (b), stretch (c) and amount (d), and played by a bank of third-octave
 * peaking filters (`MusicPlayerService`). Music only; the soundscape has its
 * own tone (brilliance). Pure, and shared with the main process's state
 * sanitizer.
 *
 * THE CURVE (`curveShape`), on x from 0 (20 Hz) to 1 (20 kHz), log frequency:
 *   f(v) = sgn(b) * (-v)^(1/|b|)
 *   g(v) = f(v * (v - 1))                    a bump on 0..1, 0 at both ends
 *   h(v) = g(v^(2^a))                        a skews the bump along the axis
 *   i(x) = h((x + c/2 - 0.5^(2^(a*(c - 1)))) / c)   c widens it (1 to 5)
 *   j(x) = i(x) for a >= 0, i(1 - x) for a < 0
 * Outside the bump's support (h's input outside 0..1, where the formula has
 * no real value) the curve is 0, which is where the bump ends anyway, so the
 * curve is one bump with flat shoulders. b sets the bump's sharpness (the
 * power 1/|b|: a small |b| is a narrow spike, a large one a broad plateau)
 * and its sign; the SLIDER shows -b, so raising it turns a mid bump into a
 * bass-and-treble lift. b = 0 is EQ OFF, exactly flat.
 *
 * NORMALISED, then SCALED (`eqCurveGainsDb`): the curve as it falls on the
 * audible window is stretched to span 0..2, moved down by 1, and multiplied
 * by d (0 to 15 dB), so whatever the shape, the EQ runs from exactly -d to
 * +d dB across 20 Hz to 20 kHz. d therefore adds level as well as tone: a
 * mid bump of d = 6 lifts the mids 6 dB and lowers the extremes 6 dB.
 *
 * PLAYED (`fitEqBandGains`): the target curve is not a filter, so a bank of
 * EQ_BAND_COUNT third-octave peaking filters is fitted to it once per change
 * of a parameter (least squares on the filters' real dB responses, then a
 * fixed number of corrections for their interaction), and only the band
 * gains reach the audio graph. Nothing is computed per sample or per frame.
 * The Options graph draws the FITTED response (`eqBankResponseDb`), what is
 * actually heard, not the formula.
 */

export interface EqCurveParams {
  /** Skew, EQ_SKEW_MIN..EQ_SKEW_MAX: 0 centres the bump, positive moves it up, negative down. */
  skew: number
  /** Sharpness and sign, EQ_SHAPE_MIN..EQ_SHAPE_MAX in steps of EQ_SHAPE_STEP; 0 is EQ off. */
  shape: number
  /** Width, EQ_STRETCH_MIN..EQ_STRETCH_MAX. */
  stretch: number
  /** Depth in dB, EQ_AMOUNT_MIN..EQ_AMOUNT_MAX: the curve spans -d..+d. */
  amount: number
}

export const EQ_SKEW_MIN = -3
export const EQ_SKEW_MAX = 3
export const EQ_SHAPE_MIN = -5
export const EQ_SHAPE_MAX = 5
export const EQ_SHAPE_STEP = 0.1
export const EQ_STRETCH_MIN = 1
export const EQ_STRETCH_MAX = 5
export const EQ_AMOUNT_MIN = 0
export const EQ_AMOUNT_MAX = 15

/** EQ off: b = 0. The others sit where a reader turning it on would want to start. */
export const FLAT_EQ_CURVE: Readonly<EqCurveParams> = { skew: 0, shape: 0, stretch: 1, amount: 0 }

export const EQ_LOW_HZ = 20
export const EQ_HIGH_HZ = 20000

/** x (0..1) to frequency, log scale. */
export function eqFrequencyAt(x: number): number {
  return EQ_LOW_HZ * (EQ_HIGH_HZ / EQ_LOW_HZ) ** x
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

/** b on its 0.1 grid, so "off" is exactly 0 and a stored value matches a stage. */
function snapShape(b: number): number {
  return Math.round(clamp(b, EQ_SHAPE_MIN, EQ_SHAPE_MAX) / EQ_SHAPE_STEP) * EQ_SHAPE_STEP
}

export function sanitizeEqCurve(value: unknown): EqCurveParams {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const number = (raw: unknown, fallback: number) => (typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback)
  return {
    skew: clamp(number(input.skew, FLAT_EQ_CURVE.skew), EQ_SKEW_MIN, EQ_SKEW_MAX),
    shape: snapShape(number(input.shape, FLAT_EQ_CURVE.shape)),
    stretch: clamp(number(input.stretch, FLAT_EQ_CURVE.stretch), EQ_STRETCH_MIN, EQ_STRETCH_MAX),
    amount: clamp(number(input.amount, FLAT_EQ_CURVE.amount), EQ_AMOUNT_MIN, EQ_AMOUNT_MAX),
  }
}

export function isEqOff(params: EqCurveParams): boolean {
  return Math.abs(params.shape) < EQ_SHAPE_STEP / 2 || params.amount <= 0
}

/** The raw curve j(x) above, 0 outside the bump's support. */
export function curveShape(x: number, { skew: a, shape: b, stretch: c }: EqCurveParams): number {
  if (Math.abs(b) < EQ_SHAPE_STEP / 2) return 0
  const along = a >= 0 ? x : 1 - x
  const u = (along + (0.5 * c) - (0.5 ** (2 ** (a * (c - 1))))) / c
  if (!(u >= 0 && u <= 1)) return 0
  const v = u ** (2 ** a)
  const inner = -(v * (v - 1))
  return Math.sign(b) * (inner ** (1 / Math.abs(b)))
}

/** Where the curve is sampled for normalising, fitting and drawing: evenly on the log axis. */
export const EQ_GRID_POINTS = 241
const GRID: readonly number[] = Array.from({ length: EQ_GRID_POINTS }, (_, k) => k / (EQ_GRID_POINTS - 1))

/** The target in dB at each grid point: normalised to -1..1 over the audible window, times d. All zeros when off. */
export function eqCurveGainsDb(params: EqCurveParams): Float64Array {
  const out = new Float64Array(EQ_GRID_POINTS)
  if (isEqOff(params)) return out
  let low = Infinity
  let high = -Infinity
  for (let k = 0; k < EQ_GRID_POINTS; k += 1) {
    const value = curveShape(GRID[k], params)
    out[k] = value
    if (value < low) low = value
    if (value > high) high = value
  }
  const span = high - low
  if (!(span > 1e-12)) return out.fill(0)
  for (let k = 0; k < EQ_GRID_POINTS; k += 1) out[k] = params.amount * ((2 * (out[k] - low) / span) - 1)
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

/** Normal equations (B^T B + lambda I) g = B^T r, solved by Gaussian elimination. */
function solveLeastSquares(residual: Float64Array): Float64Array {
  const n = EQ_BAND_COUNT
  const m = new Float64Array(n * (n + 1))
  const ridge = 1e-3
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      let sum = 0
      for (let k = 0; k < EQ_GRID_POINTS; k += 1) sum += UNIT_BASIS[i][k] * UNIT_BASIS[j][k]
      m[(i * (n + 1)) + j] = sum + (i === j ? ridge : 0)
    }
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
export function fitEqBandGains(params: EqCurveParams): Float64Array {
  const target = eqCurveGainsDb(params)
  const gains = new Float64Array(EQ_BAND_COUNT)
  if (isEqOff(params)) return gains
  let residual = target
  for (let pass = 0; pass <= FIT_CORRECTIONS; pass += 1) {
    const step = solveLeastSquares(residual)
    for (let band = 0; band < EQ_BAND_COUNT; band += 1) gains[band] += step[band]
    const response = eqBankResponseDb(gains)
    residual = Float64Array.from(target, (value, k) => value - response[k])
  }
  return gains
}
