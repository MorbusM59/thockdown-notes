import { pulseCurve } from '@thockdown/look/visualizer'

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
 * The semitone row estimates a polyphonic set of notes by fitting their
 * fundamentals and partials jointly in linear power. This attributes energy
 * already explained by a note's partials instead of adding it to every
 * possible lower-note candidate.
 *
 * The scale is FIXED, from `SPECTRUM_FLOOR_DB` to `SPECTRUM_CEILING_DB`, so
 * a quiet track draws low bars. An auto-ranging scale would make every track
 * look equally loud.
 */

export const SPECTRUM_MIN_HZ = 20
/** Most MP3 encoders low-pass at about 16 kHz, so columns above it would stay dark on ordinary files. */
export const SPECTRUM_MAX_HZ = 16000

/**
 * The drawn range, as band power in dB (the analyser's dBFS bin values
 * turned into power and summed). A full-scale sine fills about the top row,
 * and a loud modern master spread over ~100 bands sits in the upper half.
 */
export const SPECTRUM_CEILING_DB = -20
export const SPECTRUM_FLOOR_DB = -80
/** Semitone levels below this are hidden; raising it increases key contrast. */
export const SEMITONE_CONTRAST_DB = -60
/** Top of the semitone brightness range; note bins can be much stronger than spectrum columns. */
export const SEMITONE_BRIGHTNESS_CEILING_DB = -20
const SEMITONE_MAX_HARMONIC = 12
const SEMITONE_ATTRIBUTION_REFIT_PASSES = 3
/** Sparse penalty set below the visible contrast floor to discourage diffuse note fits. */
const SEMITONE_ATTRIBUTION_PENALTY = dbToPower(SEMITONE_CONTRAST_DB - 6)
// A note must add at least 1% of the strongest candidate's fit improvement to count as independently supported.
const SEMITONE_MIN_RELATIVE_FIT_SUPPORT = 0.01
/** Seconds for a lit key to fall to a quieter target. */
export const SEMITONE_FADE_SEC = 1.25
/** The neutral shared visualizer fall shape: a quadratic decay. */
export const SEMITONE_FADE_SHAPE = -0.2

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

/** Precomputed frequency-bin contributions for a fixed FFT shape and band range. */
export interface BandLevelPlan {
  fromBand: number
  bandCount: number
  narrow: Uint8Array
  below: Uint32Array
  above: Uint32Array
  share: Float64Array
  widthShare: Float64Array
  offsets: Uint32Array
  bins: Uint32Array
  weights: Float64Array
  tilt: Float64Array
}

/**
 * Builds the fixed bin geometry once, so sampling a spectrum does no
 * per-band frequency, overlap, or tilt calculations.
 */
export function createBandLevelPlan(
  binCount: number,
  binHz: number,
  edges: Float64Array,
  fromBand = 0,
  toBand = edges.length - 1,
): BandLevelPlan {
  const bandCount = Math.max(0, toBand - fromBand)
  const narrow = new Uint8Array(bandCount)
  const below = new Uint32Array(bandCount)
  const above = new Uint32Array(bandCount)
  const share = new Float64Array(bandCount)
  const widthShare = new Float64Array(bandCount)
  const offsets = new Uint32Array(bandCount + 1)
  const bins: number[] = []
  const weights: number[] = []
  const tilt = new Float64Array(bandCount)
  const lastBin = binCount - 1

  for (let localBand = 0; localBand < bandCount; localBand += 1) {
    const band = fromBand + localBand
    const lo = edges[band]
    const hi = edges[band + 1]
    const centre = bandCentreHz(edges, band)
    tilt[localBand] = TILT_DB_PER_OCTAVE * Math.log2(centre / TILT_PIVOT_HZ)

    if (hi - lo < binHz) {
      narrow[localBand] = 1
      const at = Math.min(lastBin, Math.max(0, centre / binHz))
      const lower = Math.floor(at)
      below[localBand] = lower
      above[localBand] = Math.min(lastBin, lower + 1)
      share[localBand] = at - lower
      widthShare[localBand] = (hi - lo) / binHz
    } else {
      const first = Math.max(0, Math.floor(lo / binHz + 0.5))
      const last = Math.min(lastBin, Math.floor(hi / binHz + 0.5))
      for (let bin = first; bin <= last; bin += 1) {
        const binLo = (bin - 0.5) * binHz
        const binHi = (bin + 0.5) * binHz
        const overlap = Math.min(hi, binHi) - Math.max(lo, binLo)
        if (overlap > 0) {
          bins.push(bin)
          weights.push(overlap / binHz)
        }
      }
    }
    offsets[localBand + 1] = bins.length
  }

  return {
    fromBand,
    bandCount,
    narrow,
    below,
    above,
    share,
    widthShare,
    offsets,
    bins: Uint32Array.from(bins),
    weights: Float64Array.from(weights),
    tilt,
  }
}

/** Applies a precomputed frequency-bin plan to one analyser frame. */
export function writeBandLevelsWithPlan(spectrumDb: Float32Array, plan: BandLevelPlan, out: Float32Array): void {
  for (let localBand = 0; localBand < plan.bandCount; localBand += 1) {
    let power = 0
    if (plan.narrow[localBand]) {
      const a = spectrumDb[plan.below[localBand]]
      const b = spectrumDb[plan.above[localBand]]
      const share = plan.share[localBand]
      const db = Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * share : Math.max(a, b)
      power = dbToPower(db) * plan.widthShare[localBand]
    } else {
      for (let i = plan.offsets[localBand]; i < plan.offsets[localBand + 1]; i += 1) {
        power += dbToPower(spectrumDb[plan.bins[i]]) * plan.weights[i]
      }
    }
    const band = plan.fromBand + localBand
    out[band] = power > 0 ? 10 * Math.log10(power) + plan.tilt[localBand] : -Infinity
  }
}

const SEMITONE_WINDOW_LOBE_RADIUS = 4
const WINDOW_A0 = 0.42
const WINDOW_A1 = 0.5
const WINDOW_A2 = 0.08

/** Sparse spectral templates for notes and their Blackman-windowed partials. */
export interface SemitoneAttributionPlan {
  boxCount: number
  binCount: number
  offsets: Uint32Array
  bins: Uint32Array
  weights: Float64Array
  squaredNorms: Float64Array
}

export interface SemitoneAttributionWorkspace {
  residual: Float64Array
  notePowers: Float64Array
  selected: Uint8Array
  support: Float64Array
}

type Complex = readonly [real: number, imaginary: number]

function dirichlet(fftSize: number, delta: number): Complex {
  const reduced = delta - Math.round(delta / fftSize) * fftSize
  if (Math.abs(reduced) < 1e-12) return [fftSize, 0]
  const ratio = Math.sin(Math.PI * reduced) / Math.sin((Math.PI * reduced) / fftSize)
  const phase = (Math.PI * reduced * (fftSize - 1)) / fftSize
  return [ratio * Math.cos(phase), -ratio * Math.sin(phase)]
}

function addScaled(target: [number, number], value: Complex, scale: number): void {
  target[0] += value[0] * scale
  target[1] += value[1] * scale
}

function blackmanResponse(fftSize: number, delta: number): Complex {
  const response: [number, number] = [0, 0]
  addScaled(response, dirichlet(fftSize, delta), WINDOW_A0)
  addScaled(response, dirichlet(fftSize, delta - 1), -WINDOW_A1 / 2)
  addScaled(response, dirichlet(fftSize, delta + 1), -WINDOW_A1 / 2)
  addScaled(response, dirichlet(fftSize, delta - 2), WINDOW_A2 / 2)
  addScaled(response, dirichlet(fftSize, delta + 2), WINDOW_A2 / 2)
  return response
}

function sinusoidBinPower(fftSize: number, frequencyBin: number, bin: number): number {
  const positive = blackmanResponse(fftSize, bin - frequencyBin)
  const negative = blackmanResponse(fftSize, bin + frequencyBin)
  const real = (positive[0] + negative[0]) / 2
  const imaginary = (positive[1] + negative[1]) / 2
  return real * real + imaginary * imaginary
}

export function createSemitoneAttributionPlan(
  sampleRate: number,
  fftSize: number,
  boxCount: number,
  tuningOffsetCents = 0,
  maxHarmonic = SEMITONE_MAX_HARMONIC,
): SemitoneAttributionPlan {
  if (!Number.isInteger(boxCount) || boxCount < 0) throw new RangeError('Semitone band count must be a non-negative integer')
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('Semitone sample rate must be positive')
  if (!Number.isInteger(fftSize) || fftSize < 2 || fftSize % 2 !== 0) throw new RangeError('Semitone FFT size must be a positive even integer')
  if (!Number.isFinite(tuningOffsetCents)) throw new RangeError('Semitone tuning offset must be finite')
  if (!Number.isInteger(maxHarmonic) || maxHarmonic < 1) throw new RangeError('At least one harmonic is required')

  const binCount = fftSize / 2
  const binHz = sampleRate / fftSize
  const tunedA3Hz = 220 * 2 ** (tuningOffsetCents / 1200)
  const centreBox = Math.floor(boxCount / 2)
  const noteTemplates: Map<number, number>[] = Array.from({ length: boxCount }, () => new Map())
  const squaredNorms = new Float64Array(boxCount)
  for (let note = 0; note < boxCount; note += 1) {
    const noteHz = tunedA3Hz * 2 ** ((note - centreBox) / 12)
    if (noteHz < SPECTRUM_MIN_HZ || noteHz >= SPECTRUM_MAX_HZ) continue
    const template = noteTemplates[note]
    for (let harmonic = 1; harmonic <= maxHarmonic; harmonic += 1) {
      const partialHz = noteHz * harmonic
      if (partialHz > SPECTRUM_MAX_HZ || partialHz >= sampleRate / 2) break
      const frequencyBin = partialHz / binHz
      const firstBin = Math.max(1, Math.ceil(frequencyBin - SEMITONE_WINDOW_LOBE_RADIUS))
      const lastBin = Math.min(binCount - 1, Math.floor(frequencyBin + SEMITONE_WINDOW_LOBE_RADIUS))
      let peakPower = 0
      for (let bin = firstBin; bin <= lastBin; bin += 1) {
        peakPower = Math.max(peakPower, sinusoidBinPower(fftSize, frequencyBin, bin))
      }
      if (peakPower === 0) continue

      const partialWeight = 1 / harmonic ** 1.5
      for (let bin = firstBin; bin <= lastBin; bin += 1) {
        const weight = partialWeight * sinusoidBinPower(fftSize, frequencyBin, bin) / peakPower
        template.set(bin, (template.get(bin) ?? 0) + weight)
      }
    }
    for (const weight of template.values()) squaredNorms[note] += weight * weight
  }

  const offsets = new Uint32Array(boxCount + 1)
  const sparseBins: number[] = []
  const sparseWeights: number[] = []
  for (let note = 0; note < boxCount; note += 1) {
    offsets[note] = sparseBins.length
    const entries = [...noteTemplates[note]].sort(([left], [right]) => left - right)
    for (const [bin, weight] of entries) {
      sparseBins.push(bin)
      sparseWeights.push(weight)
    }
  }
  offsets[boxCount] = sparseBins.length
  return {
    boxCount,
    binCount,
    offsets,
    bins: Uint32Array.from(sparseBins),
    weights: Float64Array.from(sparseWeights),
    squaredNorms,
  }
}

export function createSemitoneAttributionWorkspace(binCount: number, boxCount: number): SemitoneAttributionWorkspace {
  if (!Number.isInteger(binCount) || binCount < 0) throw new RangeError('Semitone FFT bin count must be a non-negative integer')
  if (!Number.isInteger(boxCount) || boxCount < 0) throw new RangeError('Semitone band count must be a non-negative integer')
  return {
    residual: new Float64Array(binCount),
    notePowers: new Float64Array(boxCount),
    selected: new Uint8Array(boxCount),
    support: new Float64Array(boxCount),
  }
}

/**
 * Fits the FFT's linear bin power (what the FFT yields, so no dB round trip)
 * as a non-negative mixture of window-aware note templates. The sparse fit
 * keeps a Blackman lobe's neighbouring bins attached to its source partial
 * rather than splitting them into separate notes first. `power` is only read.
 */
export function writeAttributedSemitoneLevels(
  power: Float64Array,
  plan: SemitoneAttributionPlan,
  out: Float32Array,
  workspace: SemitoneAttributionWorkspace,
): void {
  const { boxCount, binCount } = plan
  if (
    power.length !== binCount ||
    out.length !== boxCount ||
    workspace.residual.length !== binCount ||
    workspace.notePowers.length !== boxCount ||
    workspace.selected.length !== boxCount ||
    workspace.support.length !== boxCount
  ) {
    throw new RangeError('Semitone attribution buffers must match the plan dimensions')
  }
  let anyPower = false
  for (let bin = 0; bin < binCount; bin += 1) {
    const binPower = power[bin] > 0 ? power[bin] : 0
    workspace.residual[bin] = binPower
    anyPower ||= binPower > 0
  }
  workspace.notePowers.fill(0)
  workspace.selected.fill(0)
  workspace.support.fill(0)
  if (!anyPower) {
    out.fill(-Infinity)
    return
  }

  let strongestImprovement = 0
  for (let selection = 0; selection < boxCount; selection += 1) {
    let bestNote = -1
    let bestPower = 0
    let bestImprovement = 0
    for (let note = 0; note < boxCount; note += 1) {
      if (workspace.selected[note]) continue
      const norm = plan.squaredNorms[note]
      if (norm === 0) continue
      const start = plan.offsets[note]
      const end = plan.offsets[note + 1]
      let correlation = 0
      for (let index = start; index < end; index += 1) {
        correlation += plan.weights[index] * workspace.residual[plan.bins[index]]
      }
      const excess = correlation - SEMITONE_ATTRIBUTION_PENALTY
      if (excess <= 0) continue
      const power = excess / norm
      const improvement = excess * power
      if (improvement > bestImprovement) {
        bestNote = note
        bestPower = power
        bestImprovement = improvement
      }
    }
    if (bestNote < 0) break
    if (selection === 0) strongestImprovement = bestImprovement
    else if (bestImprovement < strongestImprovement * SEMITONE_MIN_RELATIVE_FIT_SUPPORT) break

    workspace.selected[bestNote] = 1
    workspace.notePowers[bestNote] = bestPower
    const bestStart = plan.offsets[bestNote]
    const bestEnd = plan.offsets[bestNote + 1]
    for (let index = bestStart; index < bestEnd; index += 1) {
      workspace.residual[plan.bins[index]] -= bestPower * plan.weights[index]
    }

    for (let pass = 0; pass < SEMITONE_ATTRIBUTION_REFIT_PASSES; pass += 1) {
      for (let note = 0; note < boxCount; note += 1) {
        if (!workspace.selected[note]) continue
        const norm = plan.squaredNorms[note]
        const start = plan.offsets[note]
        const end = plan.offsets[note + 1]
        let correlation = 0
        for (let index = start; index < end; index += 1) {
          correlation += plan.weights[index] * workspace.residual[plan.bins[index]]
        }
        const previous = workspace.notePowers[note]
        const next = Math.max(0, (correlation + norm * previous - SEMITONE_ATTRIBUTION_PENALTY) / norm)
        const change = next - previous
        if (change === 0) continue
        workspace.notePowers[note] = next
        for (let index = start; index < end; index += 1) {
          workspace.residual[plan.bins[index]] -= change * plan.weights[index]
        }
      }
    }
  }

  let strongestSupport = 0
  for (let note = 0; note < boxCount; note += 1) {
    if (!workspace.selected[note]) continue
    const norm = plan.squaredNorms[note]
    const start = plan.offsets[note]
    const end = plan.offsets[note + 1]
    let correlation = norm * workspace.notePowers[note]
    for (let index = start; index < end; index += 1) {
      correlation += plan.weights[index] * workspace.residual[plan.bins[index]]
    }
    const excess = Math.max(0, correlation - SEMITONE_ATTRIBUTION_PENALTY)
    const support = (excess * excess) / norm
    workspace.support[note] = support
    strongestSupport = Math.max(strongestSupport, support)
  }
  for (let note = 0; note < boxCount; note += 1) {
    const power = workspace.notePowers[note]
    const supported = workspace.support[note] >= strongestSupport * SEMITONE_MIN_RELATIVE_FIT_SUPPORT
    out[note] = power > 0 && supported ? 10 * Math.log10(power) : -Infinity
  }
}

/** Unquantized brightness above the contrast cutoff, capped at the semitone brightness ceiling. */
export function semitoneShare(levelDb: number): number {
  if (!(levelDb > SEMITONE_CONTRAST_DB)) return 0
  return Math.max(
    0,
    Math.min(1, (levelDb - SEMITONE_CONTRAST_DB) / (SEMITONE_BRIGHTNESS_CEILING_DB - SEMITONE_CONTRAST_DB)),
  )
}

/** dB offset that normalizes the mix peak to full scale, bounded by the visible note range. */
export function semitoneLoudnessOffsetDb(peak: number): number {
  if (!Number.isFinite(peak) || peak < 0) throw new RangeError('Peak amplitude must be finite and non-negative')
  if (peak === 0 || peak === 1) return 0
  const range = SEMITONE_BRIGHTNESS_CEILING_DB - SEMITONE_CONTRAST_DB
  return Math.max(-range, Math.min(range, -20 * Math.log10(peak)))
}

const TUNING_MIN_HZ = 80
const TUNING_MAX_HZ = 5000
const TUNING_MIN_PEAK_DB = -65
const TUNING_MIN_FRAMES = 8
const TUNING_MIN_PEAKS = 24
const TUNING_CENT_BINS = 100
const TUNING_CLUSTER_RADIUS_CENTS = 4
const TUNING_MIN_CLUSTER_SHARE = 0.3

/** Estimates one stable track-wide tuning offset from recurring spectral peaks. */
export class TrackTuningEstimator {
  private readonly histogram = new Float64Array(TUNING_CENT_BINS)
  private totalPeaks = 0
  private framesWithPeaks = 0
  private lockedOffsetCents: number | null = null

  /** Whether the offset has been decided; once it has, `addFrame` only repeats it and needs no spectrum. */
  get isLocked(): boolean {
    return this.lockedOffsetCents !== null
  }

  reset(): void {
    this.histogram.fill(0)
    this.totalPeaks = 0
    this.framesWithPeaks = 0
    this.lockedOffsetCents = null
  }

  /** Returns a cent offset once enough peaks agree; subsequent calls keep it fixed. */
  addFrame(spectrumDb: Float32Array, binHz: number): number | null {
    if (this.lockedOffsetCents !== null) return this.lockedOffsetCents

    let framePeaks = 0
    for (let bin = 2; bin < spectrumDb.length - 2; bin += 1) {
      const db = spectrumDb[bin]
      if (!Number.isFinite(db) || db < TUNING_MIN_PEAK_DB) continue
      const left = spectrumDb[bin - 1]
      const right = spectrumDb[bin + 1]
      if (!Number.isFinite(left) || !Number.isFinite(right)) continue
      if (db < left || db < right) continue
      const shoulder = Math.max(spectrumDb[bin - 2], spectrumDb[bin + 2])
      if (Number.isFinite(shoulder) && db - shoulder < 1.5) continue

      const denominator = left - 2 * db + right
      if (!(denominator < -0.01)) continue
      const binOffset = Math.max(-0.5, Math.min(0.5, (0.5 * (left - right)) / denominator))
      const hz = (bin + binOffset) * binHz
      if (hz < TUNING_MIN_HZ || hz > TUNING_MAX_HZ) continue

      const semitone = 69 + 12 * Math.log2(hz / 440)
      const cents = 100 * (semitone - Math.floor(semitone + 0.5))
      const centBin = ((Math.round(cents) % TUNING_CENT_BINS) + TUNING_CENT_BINS) % TUNING_CENT_BINS
      this.histogram[centBin] += 1
      this.totalPeaks += 1
      framePeaks += 1
    }

    if (framePeaks > 0) this.framesWithPeaks += 1
    if (this.framesWithPeaks < TUNING_MIN_FRAMES || this.totalPeaks < TUNING_MIN_PEAKS) return null

    let bestCenter = 0
    let bestVotes = 0
    for (let center = 0; center < TUNING_CENT_BINS; center += 1) {
      let votes = 0
      for (let delta = -TUNING_CLUSTER_RADIUS_CENTS; delta <= TUNING_CLUSTER_RADIUS_CENTS; delta += 1) {
        const index = (center + delta + TUNING_CENT_BINS) % TUNING_CENT_BINS
        votes += this.histogram[index]
      }
      if (votes > bestVotes) {
        bestCenter = center
        bestVotes = votes
      }
    }
    if (bestVotes / this.totalPeaks < TUNING_MIN_CLUSTER_SHARE) return null

    let weightedCents = 0
    for (let delta = -TUNING_CLUSTER_RADIUS_CENTS; delta <= TUNING_CLUSTER_RADIUS_CENTS; delta += 1) {
      const index = (bestCenter + delta + TUNING_CENT_BINS) % TUNING_CENT_BINS
      weightedCents += (bestCenter + delta) * this.histogram[index]
    }
    let offset = weightedCents / bestVotes
    if (offset >= 50) offset -= 100
    if (offset < -50) offset += 100
    this.lockedOffsetCents = offset
    return offset
  }
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
  writeBandLevelsWithPlan(
    spectrumDb,
    createBandLevelPlan(spectrumDb.length, binHz, edges, fromBand, toBand),
    out,
  )
}

/** How many of `maxRows` boxes a level lights: none at or below the floor, all at the ceiling, linear in dB between. */
export function litRows(levelDb: number, maxRows: number): number {
  return Math.max(0, Math.min(maxRows, Math.round(levelShare(levelDb) * maxRows)))
}

/** A level's share of the fixed spectrum range, from invisible to full strength. */
export function levelShare(levelDb: number): number {
  if (!(levelDb > SPECTRUM_FLOOR_DB)) return 0
  return Math.max(0, Math.min(1, (levelDb - SPECTRUM_FLOOR_DB) / (SPECTRUM_CEILING_DB - SPECTRUM_FLOOR_DB)))
}

/** Shaped, time-based fading for the key row's normalized light levels. */
export class SemitoneFade {
  readonly levels: Float32Array
  private readonly from: Float32Array
  private readonly to: Float32Array
  private readonly elapsed: Float32Array
  private readonly fading: Uint8Array

  constructor(readonly bands: number) {
    if (!Number.isInteger(bands) || bands < 0) throw new RangeError('Semitone band count must be a non-negative integer')
    this.levels = new Float32Array(bands)
    this.from = new Float32Array(bands)
    this.to = new Float32Array(bands)
    this.elapsed = new Float32Array(bands)
    this.fading = new Uint8Array(bands)
  }

  /** Moves each light toward its target, rising immediately and falling on the configured curve. */
  step(targets: Float32Array, dtSec: number): void {
    if (targets.length !== this.bands) throw new RangeError('Semitone targets must match the fade band count')
    const dt = Math.max(0, dtSec)
    for (let band = 0; band < this.bands; band += 1) {
      const target = targets[band]
      const current = this.levels[band]
      if (target >= current) {
        this.levels[band] = target
        this.fading[band] = 0
        continue
      }

      if (!this.fading[band] || target !== this.to[band]) {
        this.from[band] = current
        this.to[band] = target
        this.elapsed[band] = 0
        this.fading[band] = 1
      } else {
        this.elapsed[band] += dt
      }

      if (SEMITONE_FADE_SEC <= 0 || this.elapsed[band] >= SEMITONE_FADE_SEC) {
        this.levels[band] = target
        this.fading[band] = 0
      } else {
        const progress = this.elapsed[band] / SEMITONE_FADE_SEC
        this.levels[band] = target + (this.from[band] - target) * pulseCurve(progress, SEMITONE_FADE_SHAPE)
      }
    }
  }

  reset(): void {
    this.levels.fill(0)
    this.from.fill(0)
    this.to.fill(0)
    this.elapsed.fill(0)
    this.fading.fill(0)
  }

  isAtRest(): boolean {
    for (let band = 0; band < this.bands; band += 1) {
      if (this.levels[band] > 0) return false
    }
    return true
  }
}

const TRANSIENT_DB_PER_DOUBLING = 4
const TRANSIENT_MAX_GATE_DB = 16
const SEMITONE_RELEASE_HYSTERESIS_DB = 6

/** Keeps established keys through hits and validates new keys against the score's future window. */
export class SemitoneActivityFilter {
  readonly levels: Float32Array
  private readonly active: Uint8Array
  private readonly desired: Uint8Array
  private readonly confirmationSec: number
  private transientAt = -Infinity
  private transientStrength = 0
  private lastTime = NaN

  constructor(readonly bands: number, confirmationSec: number) {
    if (!Number.isInteger(bands) || bands < 0) throw new RangeError('Semitone band count must be a non-negative integer')
    if (!Number.isFinite(confirmationSec) || confirmationSec < 0) throw new RangeError('Semitone confirmation time must be non-negative')
    this.confirmationSec = confirmationSec
    this.levels = new Float32Array(bands).fill(-Infinity)
    this.active = new Uint8Array(bands)
    this.desired = new Uint8Array(bands)
  }

  reset(): void {
    this.levels.fill(-Infinity)
    this.active.fill(0)
    this.desired.fill(0)
    this.transientAt = -Infinity
    this.transientStrength = 0
    this.lastTime = NaN
  }

  /** Records a thump/pierce cue; its influence falls over one confirmation window. */
  recordTransient(nowSec: number, strength: number): void {
    if (!Number.isFinite(nowSec) || !Number.isFinite(strength)) throw new RangeError('Transient time and strength must be finite')
    const carried = this.transientStrengthAt(nowSec)
    this.transientAt = nowSec
    this.transientStrength = Math.max(carried, Math.max(0, Math.min(1, strength)))
  }

  /** Filters the current score using its already-computed future evidence. */
  step(rawLevels: Float32Array, futureLevels: Float32Array, nowSec: number): Float32Array {
    if (rawLevels.length !== this.bands || futureLevels.length !== this.bands) {
      throw new RangeError('Semitone score buffers must match the filter band count')
    }
    if (!Number.isFinite(nowSec)) throw new RangeError('Semitone sample time must be finite')
    if (Number.isFinite(this.lastTime) && nowSec < this.lastTime) this.reset()
    this.lastTime = nowSec

    let qualifyingCount = 0
    for (let band = 0; band < this.bands; band += 1) {
      if (rawLevels[band] > SEMITONE_CONTRAST_DB) qualifyingCount += 1
    }

    const transient = this.transientStrengthAt(nowSec)
    const extraDb =
      transient > 0 && qualifyingCount > 1
        ? transient * Math.min(TRANSIENT_MAX_GATE_DB, TRANSIENT_DB_PER_DOUBLING * Math.log2(qualifyingCount))
        : 0

    for (let band = 0; band < this.bands; band += 1) {
      const level = rawLevels[band]
      if (this.active[band]) {
        this.desired[band] = level > SEMITONE_CONTRAST_DB - SEMITONE_RELEASE_HYSTERESIS_DB ? 1 : 0
        continue
      }

      if (!(level > SEMITONE_CONTRAST_DB)) {
        this.desired[band] = 0
        continue
      }

      this.desired[band] =
        level > SEMITONE_CONTRAST_DB + extraDb &&
        (transient === 0 || futureLevels[band] > SEMITONE_CONTRAST_DB)
          ? 1
          : 0
    }

    this.active.set(this.desired)

    for (let band = 0; band < this.bands; band += 1) {
      this.levels[band] = this.active[band] ? rawLevels[band] : -Infinity
    }
    return this.levels
  }

  private transientStrengthAt(nowSec: number): number {
    if (!(this.confirmationSec > 0)) return 0
    const age = Math.max(0, nowSec - this.transientAt)
    if (age >= this.confirmationSec) return 0
    return this.transientStrength * (1 - age / this.confirmationSec)
  }

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
