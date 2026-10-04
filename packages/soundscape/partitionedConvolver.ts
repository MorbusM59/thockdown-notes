/**
 * Convolution of one channel with an impulse response, a block at a time,
 * with no added latency: the soundscape's space (reverb), applied in the
 * render worker (soundscapeMix.ts) instead of by a ConvolverNode, because
 * the whole mix is rendered ahead of playback.
 *
 * Uniformly partitioned overlap-save in TWO stages:
 * - the first TAIL_BLOCK frames of the response in partitions of BLOCK
 *   frames, computed from the block just received, so the output of a block
 *   is ready as soon as the block is;
 * - the rest in partitions of TAIL_BLOCK frames, computed once per window of
 *   TAIL_BLOCK frames from windows already complete. A tail partition only
 *   ever needs input at least TAIL_BLOCK frames old, which is exactly what
 *   lets it use the long, cheap block without delaying anything.
 * An 8-second response at 48 kHz is then 8 short and 23 long partitions
 * instead of 188 short ones.
 *
 * Spectra are stored as their first N/2+1 bins (the input is real, so the
 * rest is the mirror) in Float32Arrays.
 *
 * A new response (setImpulse) is crossfaded in over the frames given,
 * computing both responses meanwhile from the SAME input history: what has
 * already been heard rings on in the new space rather than being cut off.
 */
import { FftPlan } from './fft';

export const BLOCK = 2048;
export const TAIL_BLOCK = 16384;
const BLOCKS_PER_WINDOW = TAIL_BLOCK / BLOCK;

interface Spectrum {
  re: Float32Array;
  im: Float32Array;
}

interface Filter {
  head: Spectrum[];
  tail: Spectrum[];
  /** This window's tail output, recomputed at each window start. */
  tailOut: Float64Array;
}

function emptySpectrum(fftSize: number): Spectrum {
  return { re: new Float32Array((fftSize / 2) + 1), im: new Float32Array((fftSize / 2) + 1) };
}

export class PartitionedConvolver {
  private readonly headPlan = new FftPlan(2 * BLOCK);
  private readonly tailPlan = new FftPlan(2 * TAIL_BLOCK);
  // Scratch for transforms.
  private readonly headRe = new Float64Array(2 * BLOCK);
  private readonly headIm = new Float64Array(2 * BLOCK);
  private readonly tailRe = new Float64Array(2 * TAIL_BLOCK);
  private readonly tailIm = new Float64Array(2 * TAIL_BLOCK);
  private readonly headOut = new Float64Array(BLOCK);

  // Input history: the previous block, and the window being filled and the one before.
  private readonly previousBlock = new Float64Array(BLOCK);
  private readonly window = new Float64Array(TAIL_BLOCK);
  private readonly previousWindow = new Float64Array(TAIL_BLOCK);
  private blockInWindow = 0;
  private windowsComplete = 0;

  // Spectra of past input frames, newest first.
  private readonly headHistory: Spectrum[] = Array.from({ length: BLOCKS_PER_WINDOW }, () => emptySpectrum(2 * BLOCK));
  private readonly tailHistory: Spectrum[];

  private readonly maxImpulseFrames: number;
  private current: Filter | null = null;
  private fading: { filter: Filter; total: number; elapsed: number } | null = null;

  /**
   * @param maxImpulseFrames the longest response this convolver will be
   *   given. The input history it keeps for the tail is sized for it from
   *   the start, so a switch to a longer response finds the history it needs.
   */
  constructor(maxImpulseFrames: number) {
    this.maxImpulseFrames = maxImpulseFrames;
    const tailPartitions = Math.max(0, Math.ceil((maxImpulseFrames - TAIL_BLOCK) / TAIL_BLOCK));
    this.tailHistory = Array.from({ length: tailPartitions }, () => emptySpectrum(2 * TAIL_BLOCK));
  }

  /**
   * Use `impulse` from the next block on, crossfading from the previous
   * response over `crossfadeFrames` (ignored for the first response).
   */
  setImpulse(impulse: Float32Array, crossfadeFrames: number): void {
    if (impulse.length > this.maxImpulseFrames) {
      throw new Error(`Impulse of ${impulse.length} frames exceeds the ${this.maxImpulseFrames} this convolver was sized for`);
    }
    const filter = this.buildFilter(impulse);
    if (this.current && crossfadeFrames > 0) {
      // Its tail output for the window under way, so it joins mid-window.
      if (this.windowsComplete > 0) this.computeTail(filter);
      this.fading = { filter: this.current, total: crossfadeFrames, elapsed: 0 };
      // A fade still running is cut short: the newest response fades in
      // from the one fully heard before it.
    } else if (this.current === null && this.windowsComplete > 0) {
      this.computeTail(filter);
    }
    this.current = filter;
  }

  /** Convolve one BLOCK of input into `output` (overwritten). */
  process(input: Float32Array, output: Float32Array): void {
    if (this.blockInWindow === 0 && this.windowsComplete > 0) this.startWindow();

    // Head: the frame [previous block, this block], newest first in history.
    this.headRe.set(this.previousBlock, 0);
    for (let index = 0; index < BLOCK; index += 1) this.headRe[BLOCK + index] = input[index];
    this.headIm.fill(0);
    this.headPlan.forward(this.headRe, this.headIm);
    const recycled = this.headHistory.pop()!;
    this.storeHalf(this.headRe, this.headIm, recycled);
    this.headHistory.unshift(recycled);
    for (let index = 0; index < BLOCK; index += 1) this.previousBlock[index] = input[index];
    this.window.set(input.subarray(0, BLOCK), this.blockInWindow * BLOCK);

    output.fill(0);
    const offset = this.blockInWindow * BLOCK;
    if (this.current) {
      this.computeHead(this.current);
      const fade = this.fading;
      for (let index = 0; index < BLOCK; index += 1) {
        const weight = fade ? Math.min(1, (fade.elapsed + index + 1) / fade.total) : 1;
        output[index] = weight * (this.headOut[index] + this.current.tailOut[offset + index]);
      }
      if (fade) {
        this.computeHead(fade.filter);
        for (let index = 0; index < BLOCK; index += 1) {
          const weight = 1 - Math.min(1, (fade.elapsed + index + 1) / fade.total);
          output[index] += weight * (this.headOut[index] + fade.filter.tailOut[offset + index]);
        }
        fade.elapsed += BLOCK;
        if (fade.elapsed >= fade.total) this.fading = null;
      }
    }

    this.blockInWindow += 1;
    if (this.blockInWindow === BLOCKS_PER_WINDOW) {
      this.blockInWindow = 0;
      this.windowsComplete += 1;
    }
  }

  /** A window just completed: record its frame and compute every active response's tail for the next one. */
  private startWindow(): void {
    this.tailRe.set(this.previousWindow, 0);
    this.tailRe.set(this.window, TAIL_BLOCK);
    this.tailIm.fill(0);
    this.tailPlan.forward(this.tailRe, this.tailIm);
    if (this.tailHistory.length > 0) {
      const recycled = this.tailHistory.pop()!;
      this.storeHalf(this.tailRe, this.tailIm, recycled);
      this.tailHistory.unshift(recycled);
    }
    this.previousWindow.set(this.window);
    if (this.current) this.computeTail(this.current);
    if (this.fading) this.computeTail(this.fading.filter);
  }

  private computeHead(filter: Filter): void {
    this.multiplyAccumulate(this.headHistory, filter.head, this.headRe, this.headIm, 2 * BLOCK);
    this.headPlan.inverse(this.headRe, this.headIm);
    for (let index = 0; index < BLOCK; index += 1) this.headOut[index] = this.headRe[BLOCK + index];
  }

  private computeTail(filter: Filter): void {
    if (filter.tail.length === 0) {
      filter.tailOut.fill(0);
      return;
    }
    this.multiplyAccumulate(this.tailHistory, filter.tail, this.tailRe, this.tailIm, 2 * TAIL_BLOCK);
    this.tailPlan.inverse(this.tailRe, this.tailIm);
    for (let index = 0; index < TAIL_BLOCK; index += 1) filter.tailOut[index] = this.tailRe[TAIL_BLOCK + index];
  }

  /** Sum history[p] x partitions[p] over the half spectrum, mirrored into full re/im for the inverse. */
  private multiplyAccumulate(history: Spectrum[], partitions: Spectrum[], re: Float64Array, im: Float64Array, size: number): void {
    const half = size / 2;
    re.fill(0);
    im.fill(0);
    for (let p = 0; p < partitions.length; p += 1) {
      const x = history[p];
      const h = partitions[p];
      for (let bin = 0; bin <= half; bin += 1) {
        const xr = x.re[bin];
        const xi = x.im[bin];
        const hr = h.re[bin];
        const hi = h.im[bin];
        re[bin] += (xr * hr) - (xi * hi);
        im[bin] += (xr * hi) + (xi * hr);
      }
    }
    for (let bin = 1; bin < half; bin += 1) {
      re[size - bin] = re[bin];
      im[size - bin] = -im[bin];
    }
  }

  private storeHalf(re: Float64Array, im: Float64Array, into: Spectrum): void {
    for (let bin = 0; bin < into.re.length; bin += 1) {
      into.re[bin] = re[bin];
      into.im[bin] = im[bin];
    }
  }

  private buildFilter(impulse: Float32Array): Filter {
    const partition = (start: number, length: number, plan: FftPlan, re: Float64Array, im: Float64Array): Spectrum => {
      re.fill(0);
      im.fill(0);
      for (let index = 0; index < length && start + index < impulse.length; index += 1) re[index] = impulse[start + index];
      plan.forward(re, im);
      const spectrum = emptySpectrum(plan.size);
      this.storeHalf(re, im, spectrum);
      return spectrum;
    };
    const head: Spectrum[] = [];
    for (let start = 0; start < Math.min(impulse.length, TAIL_BLOCK); start += BLOCK) {
      head.push(partition(start, BLOCK, this.headPlan, this.headRe, this.headIm));
    }
    const tail: Spectrum[] = [];
    for (let start = TAIL_BLOCK; start < impulse.length; start += TAIL_BLOCK) {
      tail.push(partition(start, TAIL_BLOCK, this.tailPlan, this.tailRe, this.tailIm));
    }
    return { head, tail, tailOut: new Float64Array(TAIL_BLOCK) };
  }
}
