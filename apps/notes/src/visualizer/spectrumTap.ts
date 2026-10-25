/**
 * The visualizer mode's ears: the processed music read by two analysers and
 * delayed until the listener hears it. The arithmetic is `spectrumBands.ts`;
 * this is the Web Audio half and the timing.
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
import { bandCentreHz, logBandEdges, writeBandLevels } from './spectrumBands'

export const CROSSOVER_HZ = 640
const LONG_FFT = 8192
const SHORT_FFT = 2048
/** Frames of history: about two seconds at 60 Hz, more than any device's lag. */
const HISTORY = 128
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
  private disconnect: (() => void) | null = null
  private readonly history: Frame[]
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
    this.history = Array.from({ length: HISTORY }, () => ({ timeSec: -Infinity, levels: new Float32Array(bands).fill(-Infinity) }))
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
    this.count = 0
  }

  /**
   * Reads the analysers as of `nowSec` (the frame's clock) into the history,
   * then writes into `out` the levels the listener is hearing at `nowSec`.
   * With the music stopped nothing is read and `out` is silence.
   */
  sample(nowSec: number, out: Float32Array): void {
    if (!this.long || !this.short || !this.longBins || !this.shortBins || !musicPlayerService.isPlaying) {
      out.fill(-Infinity)
      this.count = 0
      return
    }
    const sampleRate = this.long.context.sampleRate
    this.newest = (this.newest + 1) % HISTORY
    this.count = Math.min(HISTORY, this.count + 1)
    const frame = this.history[this.newest]
    frame.timeSec = nowSec
    this.long.getFloatFrequencyData(this.longBins)
    this.short.getFloatFrequencyData(this.shortBins)
    writeBandLevels(this.longBins, sampleRate / LONG_FFT, this.edges, 0, this.split, frame.levels)
    writeBandLevels(this.shortBins, sampleRate / SHORT_FFT, this.edges, this.split, this.bands, frame.levels)

    const lag = heardLagSec()
    this.copyHeard(nowSec - Math.max(0, lag - LONG_FFT / 2 / sampleRate), 0, this.split, out)
    this.copyHeard(nowSec - Math.max(0, lag - SHORT_FFT / 2 / sampleRate), this.split, this.bands, out)
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
    let chosen = this.history[this.newest]
    for (let back = 0; back < this.count; back += 1) {
      const frame = this.history[(this.newest - back + HISTORY) % HISTORY]
      chosen = frame
      if (frame.timeSec <= atSec) break
    }
    out.set(chosen.levels.subarray(from, to), from)
  }
}
