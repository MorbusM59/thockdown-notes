/**
 * The visualizer mode's spectrum analyser, as numbers: which frequencies a
 * column shows, how loud each column is, and how the drawn bars move.
 * Pure, so the rules are tested against synthesized signals rather than
 * reasoned about (spectrumBands.test.ts). The Web Audio side, which reads
 * the music and feeds these, is `spectrumTap.ts`.
 *
 * ONE COLUMN IS ONE BAND, and the bands are spaced LOGARITHMICALLY from
 * `SPECTRUM_MIN_HZ` to `SPECTRUM_MAX_HZ`, so every column spans the same
 * number of octaves. How many columns there are is whatever fits across the
 * screen, so the resolution follows the box size.
 *
 * A BAND'S LEVEL IS THE POWER IT HOLDS, summed over the FFT bins it covers,
 * not their average. Bands of equal width in octaves then read equal for
 * pink noise, which is what music is closest to, so a balanced mix draws
 * flat instead of sloping off to the right. A small extra tilt
 * (`TILT_DB_PER_OCTAVE`, about 1 kHz) makes up for real masters falling off
 * a little faster than pink.
 *
 * A low band can be narrower than one FFT bin. Summing would then hand the
 * same bin to several neighbouring bands, which draws as a staircase, so
 * such a band reads the spectrum INTERPOLATED at its centre (linearly, in
 * dB, between the two nearest bins) and scales it by its share of a bin.
 *
 * The scale is FIXED, from `SPECTRUM_FLOOR_DB` to `SPECTRUM_CEILING_DB`, so
 * a quiet track draws low bars. An auto-ranging scale would make every track
 * look equally loud.
 */

export const SPECTRUM_MIN_HZ = 20
export const SPECTRUM_MAX_HZ = 20000

/**
 * The drawn range, as band power in dB (the analyser's dBFS bin values
 * turned into power and summed). A full-scale sine fills about the top row,
 * and a loud modern master spread over ~100 bands sits in the upper half.
 */
export const SPECTRUM_CEILING_DB = -18
export const SPECTRUM_FLOOR_DB = -78

/** Extra slope applied about `TILT_PIVOT_HZ`, on top of pink reading flat. */
export const TILT_DB_PER_OCTAVE = 1.5
const TILT_PIVOT_HZ = 1000

/** How fast a bar falls once its band gets quieter, in dB per second. A rise is immediate. */
export const RELEASE_DB_PER_SEC = 36
/** How long a peak box hangs at the highest point a bar reached before it starts to fall. */
export const PEAK_HOLD_SEC = 0.7
/** How fast a falling peak box speeds up, in dB per second per second. */
export const PEAK_GRAVITY_DB_PER_SEC2 = 120

/** The `count + 1` band edges, geometrically spaced from `minHz` to `maxHz`. Band `i` is `[edges[i], edges[i + 1])`. */
export function logBandEdges(count: number, minHz = SPECTRUM_MIN_HZ, maxHz = SPECTRUM_MAX_HZ): Float64Array {
  const edges = new Float64Array(Math.max(0, count) + 1)
  const ratio = maxHz / minHz
  for (let i = 0; i <= count; i += 1) edges[i] = minHz * ratio ** (i / Math.max(1, count))
  return edges
}

/** A band's centre on the log axis. */
export function bandCentreHz(edges: Float64Array, band: number): number {
  return Math.sqrt(edges[band] * edges[band + 1])
}

function dbToPower(db: number): number {
  return db > -400 ? 10 ** (db / 10) : 0
}

/**
 * Writes the level in dB of bands `[fromBand, toBand)` into `out`, read off
 * one analyser frame (`spectrumDb`, one dBFS value per bin as
 * `AnalyserNode.getFloatFrequencyData` gives them; bin `k` is centred on
 * `k * binHz`). See the module comment for why power is summed and when it
 * is interpolated instead. A silent band reads -Infinity.
 */
export function writeBandLevels(
  spectrumDb: Float32Array,
  binHz: number,
  edges: Float64Array,
  fromBand: number,
  toBand: number,
  out: Float32Array,
): void {
  const lastBin = spectrumDb.length - 1
  for (let band = fromBand; band < toBand; band += 1) {
    const lo = edges[band]
    const hi = edges[band + 1]
    let power = 0
    if (hi - lo < binHz) {
      // Narrower than a bin: the spectrum interpolated at the centre, as a
      // density (per bin), times the share of a bin the band spans.
      const at = Math.min(lastBin, Math.max(0, bandCentreHz(edges, band) / binHz))
      const below = Math.floor(at)
      const above = Math.min(lastBin, below + 1)
      const share = at - below
      const a = spectrumDb[below]
      const b = spectrumDb[above]
      const db = Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * share : Math.max(a, b)
      power = dbToPower(db) * ((hi - lo) / binHz)
    } else {
      // Every bin the band overlaps, weighted by how much of the bin it
      // covers (bin k spans [k - 0.5, k + 0.5) bins), so a band boundary
      // between two bins splits them rather than giving each wholly to one.
      const first = Math.max(0, Math.floor(lo / binHz + 0.5))
      const last = Math.min(lastBin, Math.floor(hi / binHz + 0.5))
      for (let bin = first; bin <= last; bin += 1) {
        const binLo = (bin - 0.5) * binHz
        const binHi = (bin + 0.5) * binHz
        const overlap = Math.min(hi, binHi) - Math.max(lo, binLo)
        if (overlap > 0) power += dbToPower(spectrumDb[bin]) * (overlap / binHz)
      }
    }
    const tilt = TILT_DB_PER_OCTAVE * Math.log2(bandCentreHz(edges, band) / TILT_PIVOT_HZ)
    out[band] = power > 0 ? 10 * Math.log10(power) + tilt : -Infinity
  }
}

/** How many of `maxRows` boxes a level lights: none at or below the floor, all at the ceiling, linear in dB between. */
export function litRows(levelDb: number, maxRows: number): number {
  if (!(levelDb > SPECTRUM_FLOOR_DB)) return 0
  const share = (levelDb - SPECTRUM_FLOOR_DB) / (SPECTRUM_CEILING_DB - SPECTRUM_FLOOR_DB)
  return Math.max(0, Math.min(maxRows, Math.round(share * maxRows)))
}

/**
 * The drawn bars' motion, per band: a bar RISES AT ONCE to a louder level and
 * FALLS at `RELEASE_DB_PER_SEC`, which is how a meter reads as both quick
 * and calm. Each band also keeps a PEAK, the highest point the bar has
 * reached recently, which hangs for `PEAK_HOLD_SEC` and then falls with
 * gravity until the bar catches it. Every step takes the real time since the
 * last one, so the motion is the same at any frame rate.
 */
export class SpectrumBallistics {
  readonly levels: Float32Array
  readonly peaks: Float32Array
  private readonly holds: Float32Array
  private readonly speeds: Float32Array

  constructor(readonly bands: number) {
    this.levels = new Float32Array(bands).fill(-Infinity)
    this.peaks = new Float32Array(bands).fill(-Infinity)
    this.holds = new Float32Array(bands)
    this.speeds = new Float32Array(bands)
  }

  /** Moves every bar toward `targets` (dB per band) over `dtSec`. */
  step(targets: Float32Array, dtSec: number): void {
    const dt = Math.max(0, dtSec)
    for (let band = 0; band < this.bands; band += 1) {
      const target = targets[band]
      const fallen = this.levels[band] - RELEASE_DB_PER_SEC * dt
      const level = target > fallen ? target : fallen
      this.levels[band] = level
      if (level >= this.peaks[band]) {
        this.peaks[band] = level
        this.holds[band] = PEAK_HOLD_SEC
        this.speeds[band] = 0
      } else if (this.holds[band] > 0) {
        this.holds[band] = Math.max(0, this.holds[band] - dt)
      } else {
        this.speeds[band] += PEAK_GRAVITY_DB_PER_SEC2 * dt
        this.peaks[band] = Math.max(level, this.peaks[band] - this.speeds[band] * dt)
      }
    }
  }

  /** Whether every bar and every peak is below the floor, so nothing is drawn and nothing will move. */
  isAtRest(): boolean {
    for (let band = 0; band < this.bands; band += 1) {
      if (this.levels[band] > SPECTRUM_FLOOR_DB || this.peaks[band] > SPECTRUM_FLOOR_DB) return false
    }
    return true
  }
}
