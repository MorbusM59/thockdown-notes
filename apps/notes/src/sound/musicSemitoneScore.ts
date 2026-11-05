import { FftPlan } from '@thockdown/soundscape/fft'
import {
  TrackTuningEstimator,
  createSemitoneAttributionPlan,
  createSemitoneAttributionWorkspace,
  writeAttributedSemitoneLevels,
  type SemitoneAttributionPlan,
  type SemitoneAttributionWorkspace,
} from '../visualizer/spectrumBands'

export const MUSIC_SEMITONE_FFT_SIZE = 8192
export const MUSIC_SEMITONE_FRAME_RATE = 40
export const MUSIC_SEMITONE_CONFIRM_SEC = 0.2

/** A bounded timeline of pitch energy, computed from decoded audio ahead of its heard time. */
export class MusicSemitoneScore {
  readonly frameSec: number
  private readonly hop: number
  private readonly fft: FftPlan
  private readonly window: Float64Array
  private readonly samples: Float32Array
  private readonly re: Float64Array
  private readonly im: Float64Array
  private readonly power: Float64Array
  /** dB of the same bins, written only while the tuning estimate is still listening. */
  private readonly spectrumDb: Float32Array
  private readonly levels: Float32Array
  private readonly attributionWorkspace: SemitoneAttributionWorkspace
  private readonly history: Float32Array
  private readonly historyStart: Float64Array
  private readonly tuning = new TrackTuningEstimator()
  private plan: SemitoneAttributionPlan
  private origin = NaN
  private fed = 0
  private frames = 0

  constructor(readonly sampleRate: number, readonly bands: number, historySec = 4) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('Semitone score sample rate must be positive')
    if (!Number.isInteger(bands) || bands < 0) throw new RangeError('Semitone score band count must be non-negative')
    this.hop = Math.max(1, Math.round(sampleRate / MUSIC_SEMITONE_FRAME_RATE))
    this.frameSec = this.hop / sampleRate
    this.fft = new FftPlan(MUSIC_SEMITONE_FFT_SIZE)
    this.window = new Float64Array(MUSIC_SEMITONE_FFT_SIZE)
    for (let i = 0; i < this.window.length; i += 1) {
      this.window[i] =
        0.42 -
        0.5 * Math.cos((2 * Math.PI * i) / MUSIC_SEMITONE_FFT_SIZE) +
        0.08 * Math.cos((4 * Math.PI * i) / MUSIC_SEMITONE_FFT_SIZE)
    }
    this.samples = new Float32Array(MUSIC_SEMITONE_FFT_SIZE)
    this.re = new Float64Array(MUSIC_SEMITONE_FFT_SIZE)
    this.im = new Float64Array(MUSIC_SEMITONE_FFT_SIZE)
    this.power = new Float64Array(MUSIC_SEMITONE_FFT_SIZE / 2)
    this.spectrumDb = new Float32Array(MUSIC_SEMITONE_FFT_SIZE / 2)
    this.levels = new Float32Array(bands)
    this.attributionWorkspace = createSemitoneAttributionWorkspace(this.spectrumDb.length, bands)
    const historyFrames = Math.ceil(historySec / this.frameSec)
    this.history = new Float32Array(historyFrames * bands)
    this.historyStart = new Float64Array(historyFrames).fill(NaN)
    this.plan = createSemitoneAttributionPlan(sampleRate, MUSIC_SEMITONE_FFT_SIZE, bands)
  }

  /** Adds contiguous mono samples whose first sample plays at `startTime`. */
  feed(samples: Float32Array, startTime: number): void {
    if (!Number.isFinite(startTime)) throw new RangeError('Semitone score chunk time must be finite')
    if (Number.isNaN(this.origin)) this.origin = startTime
    for (let i = 0; i < samples.length; i += 1) {
      this.samples[this.fed % MUSIC_SEMITONE_FFT_SIZE] = samples[i]
      this.fed += 1
      if (this.fed >= MUSIC_SEMITONE_FFT_SIZE && (this.fed - MUSIC_SEMITONE_FFT_SIZE) % this.hop === 0) {
        this.addFrame()
      }
    }
  }

  /** The frame nearest `timeSec`, or null when it is unavailable or expired. */
  frameIndexAt(timeSec: number): number | null {
    if (!Number.isFinite(timeSec) || Number.isNaN(this.origin)) return null
    const frame = Math.round(((timeSec - this.origin) * this.sampleRate - MUSIC_SEMITONE_FFT_SIZE / 2) / this.hop)
    const historyFrames = this.historyStart.length
    if (frame < 0 || frame >= this.frames || frame < this.frames - historyFrames) return null
    const slot = frame % historyFrames
    return this.historyStart[slot] === frame ? frame : null
  }

  /** Writes the score nearest `timeSec`; unavailable or expired frames read as silence. */
  levelsAt(timeSec: number, out: Float32Array): void {
    if (out.length !== this.bands) throw new RangeError('Semitone score output must match its band count')
    const frame = this.frameIndexAt(timeSec)
    if (frame === null) {
      out.fill(-Infinity)
      return
    }
    const slot = frame % this.historyStart.length
    out.set(this.history.subarray(slot * this.bands, (slot + 1) * this.bands))
  }

  private addFrame(): void {
    const start = this.fed - MUSIC_SEMITONE_FFT_SIZE
    for (let i = 0; i < MUSIC_SEMITONE_FFT_SIZE; i += 1) {
      this.re[i] = this.samples[(start + i) % MUSIC_SEMITONE_FFT_SIZE] * this.window[i]
      this.im[i] = 0
    }
    this.fft.forward(this.re, this.im)
    const scale = 1 / (MUSIC_SEMITONE_FFT_SIZE * MUSIC_SEMITONE_FFT_SIZE)
    for (let bin = 0; bin < this.power.length; bin += 1) {
      this.power[bin] = (this.re[bin] * this.re[bin] + this.im[bin] * this.im[bin]) * scale
    }
    if (!this.tuning.isLocked && this.frames % Math.max(1, Math.round(0.25 / this.frameSec)) === 0) {
      for (let bin = 0; bin < this.power.length; bin += 1) this.spectrumDb[bin] = 10 * Math.log10(this.power[bin])
      const offset = this.tuning.addFrame(this.spectrumDb, this.sampleRate / MUSIC_SEMITONE_FFT_SIZE)
      if (offset !== null) {
        this.plan = createSemitoneAttributionPlan(this.sampleRate, MUSIC_SEMITONE_FFT_SIZE, this.bands, offset)
      }
    }
    writeAttributedSemitoneLevels(this.power, this.plan, this.levels, this.attributionWorkspace)

    const historyFrames = this.historyStart.length
    const slot = this.frames % historyFrames
    this.historyStart[slot] = this.frames
    this.history.set(this.levels, slot * this.bands)
    this.frames += 1
  }
}
