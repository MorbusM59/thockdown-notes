/**
 * The largest sample magnitude in a sliding window of decoded audio: what the
 * beat pulse scales its responses by (`musicBeat.ts`'s `loudnessGain`), so a
 * track mixed below full scale, or a quiet passage between loud ones, is
 * drawn less punchy than one that reaches full scale.
 *
 * Samples arrive in time order in BLOCKS (`BLOCK_SEC` each), and the window's
 * maximum is kept by a MONOTONIC DEQUE of blocks, each larger than every one
 * after it: a new block drops those it outshines from the back, and a block
 * that has left the window is dropped from the front. So adding a sample and
 * reading the window's peak are both constant time on average, with no scan
 * of the window on any frame.
 */

/** The length of one block of samples, in seconds: the window's resolution. */
const BLOCK_SEC = 0.01
/** Blocks the deque can hold: more than a window of twice the beat's look-ahead plus its margin at BLOCK_SEC. */
const CAPACITY = 2048

export class PeakWindow {
  private readonly times = new Float64Array(CAPACITY)
  private readonly peaks = new Float32Array(CAPACITY)
  private head = 0
  private count = 0
  private blockPeak = 0
  private blockStart = NaN

  /** Forgets everything: a new run of decoding. */
  reset(): void {
    this.head = 0
    this.count = 0
    this.blockPeak = 0
    this.blockStart = NaN
  }

  /** Adds a decoded chunk whose first sample is at media time `startTime`. */
  add(samples: Float32Array, startTime: number, sampleRate: number): void {
    const perBlock = Math.max(1, Math.round(BLOCK_SEC * sampleRate))
    for (let i = 0; i < samples.length; i++) {
      if (Number.isNaN(this.blockStart)) this.blockStart = startTime + i / sampleRate
      const magnitude = Math.abs(samples[i])
      if (magnitude > this.blockPeak) this.blockPeak = magnitude
      if (startTime + (i + 1) / sampleRate - this.blockStart >= perBlock / sampleRate - 1e-9) this.closeBlock()
    }
  }

  /** The largest magnitude among blocks starting at or after `from`, 0 when there are none. */
  peakSince(from: number): number {
    while (this.count > 0 && this.times[this.head] < from) {
      this.head = (this.head + 1) % CAPACITY
      this.count--
    }
    return this.count > 0 ? this.peaks[this.head] : 0
  }

  private closeBlock(): void {
    const peak = this.blockPeak
    // Drop from the back every block this one outshines: none of them can be
    // the window's peak again while this one is in it.
    while (this.count > 0 && this.peaks[(this.head + this.count - 1) % CAPACITY] <= peak) this.count--
    if (this.count === CAPACITY) {
      this.head = (this.head + 1) % CAPACITY
      this.count--
    }
    const at = (this.head + this.count) % CAPACITY
    this.times[at] = this.blockStart
    this.peaks[at] = peak
    this.count++
    this.blockPeak = 0
    this.blockStart = NaN
  }
}

/**
 * The share of its full response a pulse is drawn at, from the window's
 * `peak` sample magnitude: 1 where the peak comes within `headroomDb` of full
 * scale (the grace a track mastered near full scale gets), and below that in
 * proportion to the peak's amplitude, so 6dB further down is half.
 */
export function loudnessGain(peak: number, headroomDb: number): number {
  return Math.min(1, peak * 10 ** (headroomDb / 20))
}
