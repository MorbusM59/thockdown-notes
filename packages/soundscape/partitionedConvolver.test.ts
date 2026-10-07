import { describe, expect, it } from 'vitest';
import { FftPlan } from './fft';
import { BLOCK, PartitionedConvolver, TAIL_BLOCK } from './partitionedConvolver';

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return (state / 0x100000000) * 2 - 1;
  };
}

/** Direct linear convolution, the ground truth. */
function convolve(input: Float32Array, impulse: Float32Array): Float64Array {
  const out = new Float64Array(input.length);
  for (let t = 0; t < input.length; t += 1) {
    let sum = 0;
    const lowest = Math.max(0, t - impulse.length + 1);
    for (let k = lowest; k <= t; k += 1) sum += input[k] * impulse[t - k];
    out[t] = sum;
  }
  return out;
}

function run(convolver: PartitionedConvolver, input: Float32Array): Float32Array {
  const out = new Float32Array(input.length);
  const block = new Float32Array(BLOCK);
  for (let start = 0; start < input.length; start += BLOCK) {
    convolver.process(input.subarray(start, start + BLOCK), block);
    out.set(block, start);
  }
  return out;
}

const worst = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let max = 0;
  for (let i = 0; i < a.length; i += 1) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
};

describe('FFT', () => {
  it('inverts its own forward transform and matches a direct DFT', () => {
    const size = 64;
    const random = seeded(3);
    const re = Float64Array.from({ length: size }, random);
    const im = Float64Array.from({ length: size }, random);
    const plan = new FftPlan(size);
    const fr = re.slice();
    const fi = im.slice();
    plan.forward(fr, fi);
    for (const k of [0, 1, 5, 31, 63]) {
      let sr = 0;
      let si = 0;
      for (let n = 0; n < size; n += 1) {
        const angle = (-2 * Math.PI * k * n) / size;
        sr += (re[n] * Math.cos(angle)) - (im[n] * Math.sin(angle));
        si += (re[n] * Math.sin(angle)) + (im[n] * Math.cos(angle));
      }
      expect(fr[k]).toBeCloseTo(sr, 9);
      expect(fi[k]).toBeCloseTo(si, 9);
    }
    plan.inverse(fr, fi);
    expect(worst(fr, re)).toBeLessThan(1e-12);
    expect(worst(fi, im)).toBeLessThan(1e-12);
  });
});

// Whole-signal convolutions over responses tens of thousands of frames long:
// several of these run for seconds by design, past Vitest's 5s default, which
// Vitest enforces on synchronous tests since 3.x.
describe('partitioned convolver', { timeout: 30_000 }, () => {
  // Responses shorter than one block, within the head, and reaching into
  // the tail by a fraction of a window and by several.
  for (const length of [100, BLOCK + 7, TAIL_BLOCK - 1, TAIL_BLOCK + 1, (3 * TAIL_BLOCK) + 1234]) {
    it(`equals direct convolution with a ${length}-frame response, block after block`, () => {
      const random = seeded(length);
      const impulse = Float32Array.from({ length }, () => random() * Math.exp(-3 * Math.random()));
      const input = Float32Array.from({ length: (length + (2 * TAIL_BLOCK)) - ((length + (2 * TAIL_BLOCK)) % BLOCK) }, random);
      const convolver = new PartitionedConvolver(4 * TAIL_BLOCK);
      convolver.setImpulse(impulse, 0);
      const got = run(convolver, input);
      const expected = convolve(input, impulse);
      // Float32 spectra: error relative to the signal's scale.
      const scale = Math.max(...Array.from(expected, Math.abs));
      expect(worst(got, expected) / scale).toBeLessThan(1e-5);
    });
  }

  it('after a crossfade to a new response, equals convolution of the whole history with it', () => {
    const random = seeded(11);
    const first = Float32Array.from({ length: TAIL_BLOCK + 3000 }, () => random() * 0.1);
    const second = Float32Array.from({ length: (2 * TAIL_BLOCK) + 500 }, () => random() * 0.1);
    const input = Float32Array.from({ length: 6 * TAIL_BLOCK }, random);
    const convolver = new PartitionedConvolver(4 * TAIL_BLOCK);
    convolver.setImpulse(first, 0);
    const out = new Float32Array(input.length);
    const block = new Float32Array(BLOCK);
    const switchAt = (2 * TAIL_BLOCK) + (3 * BLOCK);
    const fade = 10 * BLOCK;
    for (let start = 0; start < input.length; start += BLOCK) {
      if (start === switchAt) convolver.setImpulse(second, fade);
      convolver.process(input.subarray(start, start + BLOCK), block);
      out.set(block, start);
    }
    const before = convolve(input, first);
    const after = convolve(input, second);
    const scale = Math.max(...Array.from(after, Math.abs));
    // Before the switch: the first response.
    expect(worst(out.subarray(0, switchAt), before.subarray(0, switchAt)) / scale).toBeLessThan(1e-5);
    // During the fade: the linear mix of both, both from the full history.
    for (let index = 0; index < fade; index += 97) {
      const weight = (index + 1) / fade;
      const expected = (weight * after[switchAt + index]) + ((1 - weight) * before[switchAt + index]);
      expect(Math.abs(out[switchAt + index] - expected) / scale).toBeLessThan(1e-5);
    }
    // After it: the second, as if it had always been there.
    expect(worst(out.subarray(switchAt + fade), after.subarray(switchAt + fade)) / scale).toBeLessThan(1e-5);
  });
});
