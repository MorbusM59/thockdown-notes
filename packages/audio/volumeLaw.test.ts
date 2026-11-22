import { describe, expect, it } from 'vitest';
import { volumeGain } from './volumeLaw';

const db = (gain: number) => 20 * Math.log10(gain);

describe('volumeGain', () => {
  it('is 10 dB quieter for every halving of the slider', () => {
    for (let position = 1; position > 1e-4; position /= 2) {
      expect(db(volumeGain(position / 2)) - db(volumeGain(position))).toBeCloseTo(-10, 9);
    }
    expect(db(volumeGain(0.5))).toBeCloseTo(-10, 9);
    expect(db(volumeGain(0.25))).toBeCloseTo(-20, 9);
  });
  it('runs from true silence to unity, monotone', () => {
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(1)).toBe(1);
    expect(volumeGain(2)).toBe(1);
    expect(volumeGain(-1)).toBe(0);
    for (let i = 1; i <= 100; i++) expect(volumeGain(i / 100)).toBeGreaterThan(volumeGain((i - 1) / 100));
  });
});
