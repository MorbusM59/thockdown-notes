/**
 * In-place iterative radix-2 FFT on separate real and imaginary arrays, for
 * the soundscape's convolution reverb (partitionedConvolver.ts). One plan
 * per size holds the bit-reversal permutation and the twiddle factors.
 */
export class FftPlan {
  readonly size: number;
  private readonly reverse: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${size}`);
    this.size = size;
    const bits = Math.log2(size);
    this.reverse = new Uint32Array(size);
    for (let index = 0; index < size; index += 1) {
      let reversed = 0;
      for (let bit = 0; bit < bits; bit += 1) reversed |= ((index >> bit) & 1) << (bits - 1 - bit);
      this.reverse[index] = reversed;
    }
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let index = 0; index < size / 2; index += 1) {
      this.cos[index] = Math.cos((2 * Math.PI * index) / size);
      this.sin[index] = Math.sin((2 * Math.PI * index) / size);
    }
  }

  /** Forward transform (e^-i), in place. */
  forward(re: Float64Array, im: Float64Array): void {
    this.transform(re, im, -1);
  }

  /** Inverse transform (e^+i), in place, scaled by 1/size. */
  inverse(re: Float64Array, im: Float64Array): void {
    this.transform(re, im, 1);
    const scale = 1 / this.size;
    for (let index = 0; index < this.size; index += 1) {
      re[index] *= scale;
      im[index] *= scale;
    }
  }

  private transform(re: Float64Array, im: Float64Array, sign: number): void {
    const size = this.size;
    const reverse = this.reverse;
    for (let index = 0; index < size; index += 1) {
      const target = reverse[index];
      if (target > index) {
        let swap = re[index]; re[index] = re[target]; re[target] = swap;
        swap = im[index]; im[index] = im[target]; im[target] = swap;
      }
    }
    for (let span = 2; span <= size; span <<= 1) {
      const half = span >> 1;
      const step = size / span;
      for (let start = 0; start < size; start += span) {
        for (let offset = 0; offset < half; offset += 1) {
          const wr = this.cos[offset * step];
          const wi = sign * this.sin[offset * step];
          const a = start + offset;
          const b = a + half;
          const tr = (re[b] * wr) - (im[b] * wi);
          const ti = (re[b] * wi) + (im[b] * wr);
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}
