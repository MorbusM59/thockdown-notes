/**
 * Changes a stream of samples from one rate to another, chunk by chunk, with
 * the output continuous across chunks: cubic (Catmull-Rom) interpolation
 * between the input samples either side of each output sample. Output sample
 * k lies at input position k x `step` from the first input sample, so the
 * timing is exact; the price is a lag of two input samples, which the times
 * `process` reports account for.
 *
 * Built for the drum tracker, whose every constant was tuned on 48kHz audio
 * (`DrumTracker`): a cubic's slight treble roll-off below 10kHz is far
 * inside what its band filters already shape.
 */

export class StreamResampler {
  private readonly step: number
  /** The last four input samples of earlier chunks, oldest first, and how many of them are real. */
  private readonly held = new Float64Array(4)
  private heldCount = 0
  /** Input samples taken so far. */
  private taken = 0
  /** The input position of the next output sample, counted from the first input sample. */
  private next = 0
  private out = new Float32Array(0)

  constructor(readonly inRate: number, readonly outRate: number) {
    this.step = inRate / outRate
  }

  reset(): void {
    this.heldCount = 0
    this.taken = 0
    this.next = 0
  }

  /**
   * Takes `input` from index `from` and returns the output samples it
   * completes (a view reused by the next call), with the offset of the last
   * one's input position before the last input sample, in input samples
   * (0 or more: how far behind the end of `input` the output got).
   */
  process(input: Float32Array, from: number): { samples: Float32Array; behind: number } {
    const n = input.length - from
    const first = this.taken - this.heldCount
    const total = this.heldCount + n
    // Sample j (0-based from `first`), clamped at the stream's start; the
    // caller only ever asks within the held samples and `input`.
    const at = (j: number): number => {
      if (j < 0) j = 0
      return j < this.heldCount ? this.held[j] : input[from + j - this.heldCount]
    }
    const lastIndex = this.taken + n - 1
    // An output sample needs the input two past its position.
    const count = Math.max(0, Math.floor((lastIndex - 2 - this.next) / this.step) + 1)
    if (this.out.length < count) this.out = new Float32Array(Math.max(count, this.out.length * 2))
    let position = this.next
    for (let k = 0; k < count; k++) {
      const i = Math.floor(position)
      const f = position - i
      const j = i - first
      const p0 = at(j - 1)
      const p1 = at(j)
      const p2 = at(j + 1)
      const p3 = at(j + 2)
      this.out[k] = p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)))
      position += this.step
    }
    const lastPosition = this.next + (count - 1) * this.step
    this.next = position
    this.taken += n
    // The next output lies at index lastIndex - 2 or later and reads one sample before it: keep four.
    const keep = Math.min(4, total)
    const tail = new Float64Array(keep)
    for (let k = 0; k < keep; k++) tail[k] = at(total - keep + k)
    this.held.set(tail)
    this.heldCount = keep
    return { samples: this.out.subarray(0, count), behind: count > 0 ? lastIndex - lastPosition : 0 }
  }
}
