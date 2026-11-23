import { describe, expect, it } from 'vitest';
import { StreamResampler } from './resampler';

function sine(frequency: number, rate: number, frames: number, phase = 0): Float32Array {
  return Float32Array.from({ length: frames }, (_, n) => Math.sin(phase + ((2 * Math.PI * frequency * n) / rate)));
}

/** Resample in uneven blocks, as a decoder hands them over. */
function resampleInBlocks(input: Float32Array, inRate: number, outRate: number): Float32Array {
  const resampler = new StreamResampler(inRate, outRate);
  const parts: Float32Array[] = [];
  const sizes = [1, 1000, 7, 4096, 333];
  for (let at = 0, k = 0; at < input.length; k += 1) {
    const block = input.subarray(at, Math.min(input.length, at + sizes[k % sizes.length]));
    parts.push(resampler.push(block, block)[0]);
    at += block.length;
  }
  parts.push(resampler.finish()[0]);
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

describe('StreamResampler', () => {
  it('passes equal rates through untouched', () => {
    const input = sine(440, 48000, 1000);
    expect(resampleInBlocks(input, 48000, 48000)).toEqual(input);
  });

  it.each([[44100, 48000], [48000, 44100], [22050, 48000], [96000, 48000]])('converts %i to %i exactly, with no seam between blocks', (inRate, outRate) => {
    const seconds = 1;
    const input = sine(1000, inRate, inRate * seconds);
    const out = resampleInBlocks(input, inRate, outRate);
    expect(out.length).toBe(outRate * seconds);
    // Away from the ends, the output is the same sine at the output rate.
    const expected = sine(1000, outRate, out.length);
    let worst = 0;
    for (let n = 200; n < out.length - 200; n += 1) worst = Math.max(worst, Math.abs(out[n] - expected[n]));
    expect(worst).toBeLessThan(2e-3);
  });

  it('removes what the output rate cannot hold rather than folding it back', () => {
    // 21 kHz at 48 kHz in, 22.05 kHz out: above the output's Nyquist.
    const out = resampleInBlocks(sine(21000, 48000, 48000), 48000, 22050);
    let peak = 0;
    for (let n = 200; n < out.length - 200; n += 1) peak = Math.max(peak, Math.abs(out[n]));
    expect(peak).toBeLessThan(0.01);
  });
});
