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
 *
 * The state can be taken at any block and returned to (snapshot/restore),
 * for the render-ahead's rewind (soundscapeRenderAhead.ts), and costs
 * almost nothing to take: nothing a snapshot refers to is written after it.
 * A window's spectrum and a response's tail output are each a NEW array
 * rather than a recycled one, and the tail history is replaced rather than
 * shifted, so a snapshot holds references, not copies. The one array
 * written in place is the window being filled, and only past the blocks
 * already in it: a restored state writes those same positions itself before
 * anything reads them. The head history is not kept at all: its spectra are
 * of the last BLOCKS_PER_WINDOW + 1 blocks of input, which the two windows
 * hold, so a restore transforms them again -- the same arithmetic on the
 * same samples, so the same spectra -- rather than every snapshot holding
 * a block's worth of spectra.
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
}

/** A response being heard, with its tail output for the window under way (recomputed at each window start). */
interface ActiveFilter {
  filter: Filter;
  tailOut: Float64Array;
}

/** The convolver's state at one block; opaque outside this module. */
export interface ConvolverSnapshot {
  readonly window: Float32Array<ArrayBuffer>;
  readonly previousWindow: Float32Array<ArrayBuffer>;
  readonly blockInWindow: number;
  readonly windowsComplete: number;
  readonly tailHistory: readonly Spectrum[];
  readonly current: ActiveFilter | null;
  readonly fading: { active: ActiveFilter; total: number; elapsed: number } | null;
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

  // Input history: the window being filled and the one before (the input
  // is single precision, so is this). The previous block is in one of them.
  private window = new Float32Array(TAIL_BLOCK);
  private previousWindow = new Float32Array(TAIL_BLOCK);
  private blockInWindow = 0;
  private windowsComplete = 0;

  // Spectra of past input frames, newest first. The tail's are replaced, never written (see the header).
  private readonly headHistory: Spectrum[];
  private tailHistory: readonly Spectrum[];

  private readonly maxImpulseFrames: number;
  private current: ActiveFilter | null = null;
  private fading: { active: ActiveFilter; total: number; elapsed: number } | null = null;

  /**
   * @param maxImpulseFrames the longest response this convolver will be
   *   given. The input history it keeps for the tail is sized for it from
   *   the start, so a switch to a longer response finds the history it needs.
   */
  constructor(maxImpulseFrames: number) {
    this.maxImpulseFrames = maxImpulseFrames;
    const tailPartitions = Math.max(0, Math.ceil((maxImpulseFrames - TAIL_BLOCK) / TAIL_BLOCK));
    // Silence before the first input: one spectrum of zeros, shared.
    const silentTail = emptySpectrum(2 * TAIL_BLOCK);
    this.headHistory = Array.from({ length: BLOCKS_PER_WINDOW }, () => emptySpectrum(2 * BLOCK));
    this.tailHistory = Array.from({ length: tailPartitions }, () => silentTail);
  }

  /** The state at this block, to `restore` later (see the header). */
  snapshot(): ConvolverSnapshot {
    return {
      window: this.window,
      previousWindow: this.previousWindow,
      blockInWindow: this.blockInWindow,
      windowsComplete: this.windowsComplete,
      tailHistory: this.tailHistory,
      current: this.current,
      fading: this.fading ? { ...this.fading } : null,
    };
  }

  /** Return to a `snapshot`: process on from its block exactly as the convolver did from there. */
  restore(snapshot: ConvolverSnapshot): void {
    this.window = snapshot.window;
    this.previousWindow = snapshot.previousWindow;
    this.blockInWindow = snapshot.blockInWindow;
    this.windowsComplete = snapshot.windowsComplete;
    this.tailHistory = snapshot.tailHistory;
    this.current = snapshot.current;
    this.fading = snapshot.fading ? { ...snapshot.fading } : null;
    // The head history again, from the input the windows hold (see the header).
    const blocks = this.lastBlocks(BLOCKS_PER_WINDOW + 1);
    for (let age = 0; age < BLOCKS_PER_WINDOW; age += 1) {
      this.headRe.set(blocks[age + 1], 0);
      this.headRe.set(blocks[age], BLOCK);
      this.headIm.fill(0);
      this.headPlan.forward(this.headRe, this.headIm);
      this.storeHalf(this.headRe, this.headIm, this.headHistory[age]);
    }
  }

  /** The last `count` blocks of input, newest first, from the two windows (silence before the first). */
  private lastBlocks(count: number): Float32Array[] {
    // The window under way holds blockInWindow blocks; a complete one, all
    // of them -- it is still `window` until the next block starts the next.
    const inWindow = this.blockInWindow > 0 || this.windowsComplete === 0 ? this.blockInWindow : BLOCKS_PER_WINDOW;
    const blocks: Float32Array[] = [];
    for (let age = 0; age < count; age += 1) {
      const index = inWindow - 1 - age;
      blocks.push(index >= 0
        ? this.window.subarray(index * BLOCK, (index + 1) * BLOCK)
        : this.previousWindow.subarray((BLOCKS_PER_WINDOW + index) * BLOCK, (BLOCKS_PER_WINDOW + index + 1) * BLOCK));
    }
    return blocks;
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
    // Its tail output for the window under way, so it joins mid-window.
    const active = { filter, tailOut: this.windowsComplete > 0 ? this.computeTail(filter) : new Float64Array(TAIL_BLOCK) };
    if (this.current && crossfadeFrames > 0) {
      this.fading = { active: this.current, total: crossfadeFrames, elapsed: 0 };
      // A fade still running is cut short: the newest response fades in
      // from the one fully heard before it.
    }
    this.current = active;
  }

  /** Convolve one BLOCK of input into `output` (overwritten). */
  process(input: Float32Array, output: Float32Array): void {
    if (this.blockInWindow === 0 && this.windowsComplete > 0) this.startWindow();

    // Head: the frame [previous block, this block], newest first in history.
    this.headRe.set(this.previousBlock(), 0);
    for (let index = 0; index < BLOCK; index += 1) this.headRe[BLOCK + index] = input[index];
    this.headIm.fill(0);
    this.headPlan.forward(this.headRe, this.headIm);
    const recycled = this.headHistory.pop()!;
    this.storeHalf(this.headRe, this.headIm, recycled);
    this.headHistory.unshift(recycled);
    this.window.set(input.subarray(0, BLOCK), this.blockInWindow * BLOCK);

    output.fill(0);
    const offset = this.blockInWindow * BLOCK;
    if (this.current) {
      this.computeHead(this.current.filter);
      const fade = this.fading;
      for (let index = 0; index < BLOCK; index += 1) {
        const weight = fade ? Math.min(1, (fade.elapsed + index + 1) / fade.total) : 1;
        output[index] = weight * (this.headOut[index] + this.current.tailOut[offset + index]);
      }
      if (fade) {
        this.computeHead(fade.active.filter);
        for (let index = 0; index < BLOCK; index += 1) {
          const weight = 1 - Math.min(1, (fade.elapsed + index + 1) / fade.total);
          output[index] += weight * (this.headOut[index] + fade.active.tailOut[offset + index]);
        }
        // Replaced, not advanced: a snapshot may hold this one.
        this.fading = fade.elapsed + BLOCK >= fade.total ? null : { ...fade, elapsed: fade.elapsed + BLOCK };
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
      const spectrum = emptySpectrum(2 * TAIL_BLOCK);
      this.storeHalf(this.tailRe, this.tailIm, spectrum);
      this.tailHistory = [spectrum, ...this.tailHistory.slice(0, -1)];
    }
    this.previousWindow = this.window;
    this.window = new Float32Array(TAIL_BLOCK);
    if (this.current) this.current = { filter: this.current.filter, tailOut: this.computeTail(this.current.filter) };
    if (this.fading) {
      this.fading = { ...this.fading, active: { filter: this.fading.active.filter, tailOut: this.computeTail(this.fading.active.filter) } };
    }
  }

  /** The block before the one being processed: the window's last, or the previous window's. */
  private previousBlock(): Float32Array {
    return this.blockInWindow > 0
      ? this.window.subarray((this.blockInWindow - 1) * BLOCK, this.blockInWindow * BLOCK)
      : this.previousWindow.subarray(TAIL_BLOCK - BLOCK);
  }

  private computeHead(filter: Filter): void {
    this.multiplyAccumulate(this.headHistory, filter.head, this.headRe, this.headIm, 2 * BLOCK);
    this.headPlan.inverse(this.headRe, this.headIm);
    for (let index = 0; index < BLOCK; index += 1) this.headOut[index] = this.headRe[BLOCK + index];
  }

  /** `filter`'s tail output for the window starting, from the windows complete. */
  private computeTail(filter: Filter): Float64Array {
    const tailOut = new Float64Array(TAIL_BLOCK);
    if (filter.tail.length === 0) return tailOut;
    this.multiplyAccumulate(this.tailHistory, filter.tail, this.tailRe, this.tailIm, 2 * TAIL_BLOCK);
    this.tailPlan.inverse(this.tailRe, this.tailIm);
    for (let index = 0; index < TAIL_BLOCK; index += 1) tailOut[index] = this.tailRe[TAIL_BLOCK + index];
    return tailOut;
  }

  /** Sum history[p] x partitions[p] over the half spectrum, mirrored into full re/im for the inverse. */
  private multiplyAccumulate(history: readonly Spectrum[], partitions: Spectrum[], re: Float64Array, im: Float64Array, size: number): void {
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
    return { head, tail };
  }
}
