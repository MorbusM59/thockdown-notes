import { describe, expect, it } from 'vitest';
import { quantizeValue } from './generateTexture';

describe('quantizeValue', () => {
  it('splits 0..1 into smoothness + 1 equal bands mapped to alpha k / smoothness', () => {
    for (let n = 1; n <= 20; n += 1) {
      for (let k = 0; k <= n; k += 1) {
        const mid = (k + 0.5) / (n + 1);
        expect(quantizeValue(mid, n)).toBeCloseTo(k / n, 10);
      }
      expect(quantizeValue(0, n)).toBe(0);
      expect(quantizeValue(1, n)).toBe(1);
    }
  });

  it('smoothness 1 is a hard mask at the midpoint', () => {
    expect(quantizeValue(127 / 255, 1)).toBe(0);
    expect(quantizeValue(128 / 255, 1)).toBe(1);
  });
});
