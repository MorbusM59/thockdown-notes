/**
 * The level of one band of a signal, read from decoded samples: a bandpass
 * (the Web Audio `BiquadFilterNode`'s, RBJ's constant-0dB-peak form, so a
 * band set here answers as it did when the graph filtered it) and the RMS of
 * the last `windowSize` filtered samples, in dB, read every `readHop`
 * samples. Each reading is stamped with the media time of the newest sample
 * it covers. Pure: no Web Audio, so a band is measured at whatever pace its
 * samples are decoded.
 */

/** A level this far below full scale counts as silence. */
export const LEVEL_FLOOR_DB = -100
/** The bounds of the RMS window, in samples. */
const MIN_WINDOW = 256
const MAX_WINDOW = 8192
/** Readings per second: plenty for a window a few seconds wide, and one per frame at most. */
const READINGS_PER_SEC = 100

/** A bandpass's Q for a bell `octaves` wide between its half-power points. */
export function bandQ(octaves: number): number {
  const ratio = 2 ** Math.max(0.05, octaves)
  return Math.sqrt(ratio) / (ratio - 1)
}

export type LevelReading = (time: number, db: number) => void

export class BandLevelMeter {
  readonly sampleRate: number
  private readonly readHop: number
  private b0 = 0
  private b2 = 0
  private a1 = 0
  private a2 = 0
  // Direct form I history, in double precision so a low band's narrow filter stays stable.
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0
  private squares = new Float64Array(MIN_WINDOW)
  private at = 0
  private filled = 0
  private sum = 0
  private sinceReading = 0

  constructor(sampleRate: number, frequencyHz: number, octaves: number) {
    this.sampleRate = sampleRate
    this.readHop = Math.max(1, Math.round(sampleRate / READINGS_PER_SEC))
    this.tune(frequencyHz, octaves)
  }

  /**
   * Points the filter at a band. The RMS window is about three periods of
   * the band's centre, so a low band is not read from a window shorter than
   * one of its own cycles. Clears the filter's history and the window.
   */
  tune(frequencyHz: number, octaves: number): void {
    const nyquist = this.sampleRate / 2
    const w0 = (2 * Math.PI * Math.min(frequencyHz, nyquist * 0.999)) / this.sampleRate
    const alpha = Math.sin(w0) / (2 * bandQ(octaves))
    const a0 = 1 + alpha
    this.b0 = alpha / a0
    this.b2 = -alpha / a0
    this.a1 = (-2 * Math.cos(w0)) / a0
    this.a2 = (1 - alpha) / a0
    const wanted = (3 * this.sampleRate) / frequencyHz
    const size = Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, 2 ** Math.ceil(Math.log2(wanted))))
    if (this.squares.length !== size) this.squares = new Float64Array(size)
    this.reset()
  }

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0
    this.squares.fill(0)
    this.at = 0
    this.filled = 0
    this.sum = 0
    this.sinceReading = 0
  }

  /** Measures `samples`, the first of which plays at media time `startTime`. */
  process(samples: Float32Array, startTime: number, onReading: LevelReading): void {
    const { b0, b2, a1, a2, squares, readHop } = this
    const size = squares.length
    let { x1, x2, y1, y2, at, filled, sum, sinceReading } = this
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i]
      const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2
      x2 = x1
      x1 = x
      y2 = y1
      y1 = y
      const square = y * y
      sum += square - squares[at]
      squares[at] = square
      at++
      if (at === size) {
        at = 0
        // Re-summed once a window, so rounding in the running sum cannot accumulate.
        sum = 0
        for (let k = 0; k < size; k++) sum += squares[k]
      }
      if (filled < size) filled++
      if (++sinceReading >= readHop) {
        sinceReading = 0
        const rms = Math.sqrt(Math.max(0, sum) / filled)
        onReading(startTime + i / this.sampleRate, rms > 0 ? Math.max(LEVEL_FLOOR_DB, 20 * Math.log10(rms)) : LEVEL_FLOOR_DB)
      }
    }
    this.x1 = x1
    this.x2 = x2
    this.y1 = y1
    this.y2 = y2
    this.at = at
    this.filled = filled
    this.sum = sum
    this.sinceReading = sinceReading
  }
}
