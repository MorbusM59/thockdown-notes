/**
 * The visualizer mode's ears: the processed music read by two analysers and
 * delayed until the listener hears it. The arithmetic is `spectrumBands.ts`;
 * this is the Web Audio half and the timing. The semitone score is prepared
 * from decoded track audio in `musicSemitoneScore.ts`.
 *
 * TWO RESOLUTIONS, split at `CROSSOVER_HZ`. One FFT cannot be both fine
 * enough for the bass (an 8192-point frame resolves 6 Hz at 48 kHz, and with
 * a hundred columns a band near 40 Hz is about 3 Hz wide) and quick enough for a hi-hat (that frame is
 * 170 ms long, so a transient would smear across a sixth of a second). The
 * bands below the crossover read the long frame, the bands above it a
 * 2048-point one.
 *
 * DRAWN WHEN HEARD. An analyser reads what the graph is handling NOW, which
 * the listener hears `heardLagSec()` later (the audio stack's latency plus
 * the reader's per-device delay, the same number the beat pulse uses). Each
 * frame's levels are kept in a short history and the frame drawn is the one
 * that has become audible. A frame describes its window's centre, half a
 * frame in the past already, so each resolution waits that much less.
 */

import { musicPlayerService } from '../sound/MusicPlayerService'
import { heardLagSec } from '../sound/musicBeat'
import { outputContext } from '@thockdown/soundscape/audioOutputBus'
import {
  createBandLevelPlan,
  bandCentreHz,
  logBandEdges,
  writeBandLevelsWithPlan,
  type BandLevelPlan,
} from './spectrumBands'

export const CROSSOVER_HZ = 640
const LONG_FFT = 8192
const SHORT_FFT = 2048
/** Frames of history: about two seconds at 60 Hz, more than any device's lag. */
const HISTORY = 128
/**
 * How often the long frame is re-read, as a share of its own length. Its
 * window is 170 ms at 48 kHz, so reading it every 16 ms drawn frame re-ran an
 * 8192-point FFT (Chromium computes it on the calling thread) over audio
 * nine-tenths the same as last time. A quarter of the window is 75% overlap,
 * finer than the bass bands it feeds can change.
 */
const LONG_READ_SHARE = 0.25
/** The bands the sway's music response listens to. */
const BASS_MAX_HZ = 150

type Frame = { timeSec: number; levels: Float32Array }

export class SpectrumTap {
  readonly edges: Float64Array
  /** The first band read from the short frame; every band below it reads the long one. */
  private readonly split: number
  private readonly bassBands: number
  private long: AnalyserNode | null = null
  private short: AnalyserNode | null = null
  private longBins: Float32Array<ArrayBuffer> | null = null
  private shortBins: Float32Array<ArrayBuffer> | null = null
  private longPlan: BandLevelPlan | null = null
  private shortPlan: BandLevelPlan | null = null
  private disconnect: (() => void) | null = null
  private readonly history: Frame[]
  /** The long bands as last read, carried into frames that do not re-read it. */
  private longLevels: Float32Array
  private longReadSec = -Infinity
  private newest = -1
  private count = 0

  constructor(readonly bands: number) {
    this.edges = logBandEdges(bands)
    let split = 0
    while (split < bands && bandCentreHz(this.edges, split) < CROSSOVER_HZ) split += 1
    this.split = split
    let bass = 0
    while (bass < bands && bandCentreHz(this.edges, bass) < BASS_MAX_HZ) bass += 1
    this.bassBands = bass
    this.longLevels = new Float32Array(bands).fill(-Infinity)
    this.history = Array.from({ length: HISTORY }, () => ({
      timeSec: -Infinity,
      levels: new Float32Array(bands).fill(-Infinity),
    }))
  }

  /** Starts listening to the music. Idempotent. */
  start(): void {
    if (this.disconnect) return
    const context = outputContext()
    const long = context.createAnalyser()
    long.fftSize = LONG_FFT
    long.smoothingTimeConstant = 0
    const short = context.createAnalyser()
    short.fftSize = SHORT_FFT
    short.smoothingTimeConstant = 0
    const input = context.createGain()
    input.connect(long)
    input.connect(short)
    const untap = musicPlayerService.tapProcessed(input)
    this.long = long
    this.short = short
    this.longBins = new Float32Array(long.frequencyBinCount)
    this.shortBins = new Float32Array(short.frequencyBinCount)
    this.longPlan = createBandLevelPlan(
      long.frequencyBinCount,
      context.sampleRate / LONG_FFT,
      this.edges,
      0,
      this.split,
    )
    this.shortPlan = createBandLevelPlan(
      short.frequencyBinCount,
      context.sampleRate / SHORT_FFT,
      this.edges,
      this.split,
      this.bands,
    )
    this.disconnect = () => {
      untap()
      input.disconnect()
    }
  }

  stop(): void {
    this.disconnect?.()
    this.disconnect = null
    this.long = null
    this.short = null
    this.longPlan = null
    this.shortPlan = null
    this.count = 0
    this.longReadSec = -Infinity
  }

  /**
   * Reads the analysers as of `nowSec` (the frame's clock) into the history,
   * then writes into `out` the levels the listener is hearing at `nowSec`.
   * With the music stopped nothing is read and `out` is silence.
   */
  sample(nowSec: number, out: Float32Array): void {
    if (!this.long || !this.short || !this.longBins || !this.shortBins || !this.longPlan || !this.shortPlan || !musicPlayerService.isPlaying) {
      out.fill(-Infinity)
      this.count = 0
      this.longReadSec = -Infinity
      return
    }
    this.newest = (this.newest + 1) % HISTORY
    this.count = Math.min(HISTORY, this.count + 1)
    const frame = this.history[this.newest]
    frame.timeSec = nowSec
    const longFrameSec = LONG_FFT / this.long.context.sampleRate
    if (!(nowSec - this.longReadSec < longFrameSec * LONG_READ_SHARE) || nowSec < this.longReadSec) {
      this.long.getFloatFrequencyData(this.longBins)
      writeBandLevelsWithPlan(this.longBins, this.longPlan, this.longLevels)
      this.longReadSec = nowSec
    }
    frame.levels.set(this.longLevels.subarray(0, this.split))
    this.short.getFloatFrequencyData(this.shortBins)
    writeBandLevelsWithPlan(this.shortBins, this.shortPlan, frame.levels)

    const lag = heardLagSec()
    const longAt = nowSec - Math.max(0, lag - LONG_FFT / 2 / this.long.context.sampleRate)
    this.copyHeard(longAt, 0, this.split, out)
    this.copyHeard(nowSec - Math.max(0, lag - SHORT_FFT / 2 / this.short.context.sampleRate), this.split, this.bands, out)
  }

  /** The power (linear) of the bass bands in `levels`, for the sway's music response. */
  bassPower(levels: Float32Array): number {
    let power = 0
    for (let band = 0; band < this.bassBands; band += 1) {
      if (levels[band] > -400) power += 10 ** (levels[band] / 10)
    }
    return power
  }

  /** Copies bands `[from, to)` of the newest frame taken at or before `atSec`, or of the oldest kept if none is that old yet. */
  private copyHeard(atSec: number, from: number, to: number, out: Float32Array): void {
    const chosen = this.frameAtOrBefore(atSec)
    out.set(chosen.levels.subarray(from, to), from)
  }

  private frameAtOrBefore(atSec: number): Frame {
    const oldest = (this.newest - this.count + 1 + HISTORY) % HISTORY
    let low = 0
    let high = this.count - 1
    let chosen = 0
    while (low <= high) {
      const middle = (low + high) >>> 1
      const frame = this.history[(oldest + middle) % HISTORY]
      if (frame.timeSec <= atSec) {
        chosen = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    return this.history[(oldest + chosen) % HISTORY]
  }
}
