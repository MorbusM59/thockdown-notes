/**
 * THE SPECTRUM COMPUTED AHEAD, for a player that renders its audio before it
 * is heard (the Android app's native music, `apps/soundscapes/src/musicSandbox.ts`):
 * the same two resolutions and the same arithmetic as the desktop's analysers
 * (`spectrumTap.ts`, Chromium's `AnalyserNode` with no smoothing: a Blackman
 * window, an FFT, each magnitude over the size, in dB, the stereo mixed down
 * as (L + R) / 2), computed from the rendered stream instead of read live.
 *
 * A FRAME is stamped with a stream position `f` and describes the audio heard
 * at `f`: its short bands read the `SHORT_FFT` frames centred on `f`, its long
 * bands the `LONG_FFT` frames centred on `f`. The desktop draws a frame half a
 * window after reading it for the same reason (a window describes its
 * centre); having the audio ahead, this centres the windows instead. Frames
 * fall every `hop` positions (a sixtieth of a second); the long bands are
 * recomputed once a quarter of their window has passed, as the desktop's are
 * (`LONG_READ_SHARE`), and carried between.
 *
 * The stream can REWIND: a chunk that starts before the end of what was
 * written replaces everything from its start (a splice). The frames from
 * that position on are computed again, and a reader drops the frames it held
 * from there (`SpectrumFrameBatch.from`).
 */
import { FftPlan } from '@thockdown/audio/fft'
import { RENDER_LEAD_SEC } from '@thockdown/audio/renderAhead'
import {
  CROSSOVER_HZ,
  LONG_FFT,
  LONG_READ_SHARE,
  SHORT_FFT,
  bandCentreHz, createBandLevelPlan, writeBandLevelsWithPlan, type BandLevelPlan } from './spectrumBands'

/** Frames a second. */
const FRAMES_PER_SEC = 60

/** Levels quantized for the crossing to the page: half-dB steps below 0 dBFS, `SILENT` for nothing. */
/** Levels above 0 dBFS (only the tilt reaches there) clamp to it, far above the scale's ceiling (`SPECTRUM_CEILING_DB`); the floor is far below its. */
export const LEVEL_STEPS_PER_DB = 2
export const SILENT = 255

export interface SpectrumFrameBatch {
  /** Every frame the reader holds at or after this position is replaced by these. */
  from: number
  /** Stream position of the first frame; each next one is `hop` later. */
  first: number
  hop: number
  /** `bands` quantized levels per frame, frame after frame. */
  levels: Uint8Array
}

class Resolution {
  readonly plan: BandLevelPlan
  private readonly fft: FftPlan
  private readonly window: Float64Array
  private readonly re: Float64Array
  private readonly im: Float64Array
  private readonly bins: Float32Array

  constructor(readonly size: number, sampleRate: number, edges: Float64Array, fromBand: number, toBand: number) {
    this.fft = new FftPlan(size)
    this.window = new Float64Array(size)
    for (let i = 0; i < size; i += 1) {
      this.window[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / size) + 0.08 * Math.cos((4 * Math.PI * i) / size)
    }
    this.re = new Float64Array(size)
    this.im = new Float64Array(size)
    this.bins = new Float32Array(size / 2)
    this.plan = createBandLevelPlan(size / 2, sampleRate / size, edges, fromBand, toBand)
  }

  /** The bands over the `size` frames of `history` ending at ring index `end` (exclusive), into `out`. */
  read(history: Float32Array, end: number, out: Float32Array): void {
    const { size, re, im, window, bins } = this
    const mask = history.length - 1
    for (let i = 0; i < size; i += 1) {
      re[i] = history[(end - size + i) & mask] * window[i]
      im[i] = 0
    }
    this.fft.forward(re, im)
    for (let k = 0; k < size / 2; k += 1) bins[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) / size)
    writeBandLevelsWithPlan(bins, this.plan, out)
  }
}

export class SpectrumFrames {
  readonly bands: number
  readonly hop: number
  private readonly long: Resolution
  private readonly short: Resolution
  private readonly longEvery: number
  /**
   * The mono stream, a ring indexed by stream position (a power of two in
   * length), reaching back the whole render lead and a long window: a splice
   * rewinds the stream to near the playhead, up to the lead behind its end,
   * and the frames from there are computed again from what the ring holds.
   */
  private readonly history: Float32Array
  /** The stream is written up to here (exclusive); nowhere before the first chunk, which starts it. */
  private written = -Infinity
  /** How far back the history still reaches. */
  private start = 0
  /** The next frame to compute. */
  private next = 0
  private readonly levels: Float32Array
  /** Where the long bands in `levels` were computed, so they are carried until a quarter window has passed. */
  private longAt = -Infinity

  constructor(sampleRate: number, readonly edges: Float64Array) {
    this.bands = edges.length - 1
    let split = 0
    while (split < this.bands && bandCentreHz(edges, split) < CROSSOVER_HZ) split += 1
    this.long = new Resolution(LONG_FFT, sampleRate, edges, 0, split)
    this.short = new Resolution(SHORT_FFT, sampleRate, edges, split, this.bands)
    this.hop = Math.round(sampleRate / FRAMES_PER_SEC)
    this.longEvery = LONG_FFT * LONG_READ_SHARE
    this.levels = new Float32Array(this.bands)
    this.history = new Float32Array(2 ** Math.ceil(Math.log2(RENDER_LEAD_SEC * sampleRate + 2 * LONG_FFT)))
  }

  /**
   * Takes rendered stereo starting at stream position `at` and returns the
   * frames it completes (null when none). A chunk starting before the end of
   * what was written is a rewind: the stream is replaced from `at`.
   */
  push(at: number, left: Float32Array, right: Float32Array): SpectrumFrameBatch | null {
    const half = LONG_FFT / 2
    if (at !== this.written) {
      if (at < this.start || at > this.written) {
        // A gap, or a rewind past what the ring holds: the stream starts over at `at`.
        this.start = at
        this.next = Math.ceil((at + half) / this.hop) * this.hop
      } else {
        // A rewind: the frames whose long window reaches `at` are computed again.
        this.next = Math.min(this.next, (Math.floor((at - half) / this.hop) + 1) * this.hop)
      }
      this.longAt = -Infinity
    }
    const from = this.next
    const mask = this.history.length - 1
    for (let i = 0; i < left.length; i += 1) this.history[(at + i) & mask] = (left[i] + right[i]) * 0.5
    this.written = at + left.length
    if (this.written - this.start > this.history.length) this.start = this.written - this.history.length

    const count = Math.max(0, Math.floor((this.written - half - this.next) / this.hop) + 1)
    if (count === 0) return null
    const out = new Uint8Array(count * this.bands)
    const first = this.next
    for (let frame = 0; frame < count; frame += 1) {
      const f = this.next
      if (f - half < this.start) {
        // Not enough audio behind it yet (the stream's first moments): silence.
        out.fill(SILENT, frame * this.bands, (frame + 1) * this.bands)
      } else {
        if (!(f - this.longAt < this.longEvery) || f < this.longAt) {
          this.long.read(this.history, f + half, this.levels)
          this.longAt = f
        }
        this.short.read(this.history, f + SHORT_FFT / 2, this.levels)
        quantize(this.levels, out, frame * this.bands)
      }
      this.next += this.hop
    }
    return { from, first, hop: this.hop, levels: out }
  }
}

function quantize(levels: Float32Array, out: Uint8Array, offset: number): void {
  for (let band = 0; band < levels.length; band += 1) {
    const db = levels[band]
    out[offset + band] = db > -(SILENT - 1) / LEVEL_STEPS_PER_DB ? Math.min(SILENT - 1, Math.max(0, Math.round(-db * LEVEL_STEPS_PER_DB))) : SILENT
  }
}

/** A quantized level back in dB. */
export function levelDb(step: number): number {
  return step === SILENT ? -Infinity : -step / LEVEL_STEPS_PER_DB
}
