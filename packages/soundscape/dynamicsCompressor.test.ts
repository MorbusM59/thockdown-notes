import { describe, expect, it } from 'vitest';
import { DynamicsCompressor } from './dynamicsCompressor';
import { BUS_COMPRESSOR } from './soundscapeMix';

const SAMPLE_RATE = 8000;

/** The steady output level, in dB, of a sine at `levelDb` peak. */
function steadyOutputDb(levelDb: number): number {
  const compressor = new DynamicsCompressor(BUS_COMPRESSOR, SAMPLE_RATE);
  const amplitude = Math.pow(10, levelDb / 20);
  const seconds = 8;
  const left = Float32Array.from({ length: seconds * SAMPLE_RATE }, (_, index) => amplitude * Math.sin((2 * Math.PI * 200 * index) / SAMPLE_RATE));
  const right = left.slice();
  compressor.process(left, right);
  let peak = 0;
  for (let index = left.length - SAMPLE_RATE; index < left.length; index += 1) peak = Math.max(peak, Math.abs(left[index]));
  return 20 * Math.log10(peak);
}

describe('bus compressor', () => {
  const compressor = new DynamicsCompressor(BUS_COMPRESSOR, SAMPLE_RATE);
  const makeupDb = 0.6 * -compressor.curveDb(0);

  it('has a continuous, non-decreasing curve that leaves quiet sound alone and compresses loud sound by the ratio', () => {
    let previous = -Infinity;
    for (let input = -60; input <= 12; input += 0.25) {
      const output = compressor.curveDb(input);
      expect(output).toBeGreaterThanOrEqual(previous - 1e-9);
      expect(output).toBeLessThanOrEqual(input + 1e-9);
      previous = output;
    }
    expect(compressor.curveDb(-30)).toBeCloseTo(-30, 9);
    expect(compressor.curveDb(16) - compressor.curveDb(10)).toBeCloseTo(6 / BUS_COMPRESSOR.ratio, 9);
    // Continuous at both knee edges.
    for (const edge of [BUS_COMPRESSOR.thresholdDb, BUS_COMPRESSOR.thresholdDb + BUS_COMPRESSOR.kneeDb]) {
      expect(compressor.curveDb(edge + 1e-6)).toBeCloseTo(compressor.curveDb(edge - 1e-6), 4);
    }
  });

  it('settles a steady tone onto the curve plus the makeup gain', () => {
    for (const level of [-30, -12, -4, 3]) {
      expect(steadyOutputDb(level)).toBeCloseTo(compressor.curveDb(level) + makeupDb, 0);
    }
  });
});
