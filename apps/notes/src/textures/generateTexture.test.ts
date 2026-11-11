import { describe, expect, it } from 'vitest';
import { applyTextureStrength, clampMaterialSettings, generateTextureRgba, quantizeValue } from './generateTexture';

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

  describe('texture strength', () => {
    const material = {
      enabled: true,
      seed: 137,
      textureStrength: 0,
      granularity: 9,
      vSteps: 8,
      color: { h: 0, s: 0, v: 1, a: 1 },
    };

    it('keeps the mask fully opaque at zero strength', () => {
      const rgba = generateTextureRgba({ width: 32, height: 32, material: clampMaterialSettings(material) });
      for (let index = 3; index < rgba.length; index += 4) expect(rgba[index]).toBe(255);
    });

    it('raises mask alpha from its transparent end', () => {
      const full = generateTextureRgba({
        width: 32,
        height: 32,
        material: clampMaterialSettings({ ...material, textureStrength: 1 }),
      });
      const rgba = generateTextureRgba({
        width: 32,
        height: 32,
        material: clampMaterialSettings({ ...material, textureStrength: 0.5 }),
      });
      for (let index = 3; index < rgba.length; index += 4) {
        expect(Math.abs(rgba[index] - Math.round(applyTextureStrength(full[index] / 255, 0.5) * 255))).toBeLessThanOrEqual(1);
      }
    });

    it.each([
      [0, 0, 1],
      [0, 0.5, 0.5],
      [1, 0.5, 1],
      [0.25, 0.5, 0.625],
      [0.4, 1, 0.4],
    ])('maps mask alpha %s at texture strength %s to %s', (maskAlpha, strength, expected) => {
      expect(applyTextureStrength(maskAlpha, strength)).toBeCloseTo(expected, 10);
    });
  });

  it('smoothness 1 is a hard mask at the midpoint', () => {
    expect(quantizeValue(127 / 255, 1)).toBe(0);
    expect(quantizeValue(128 / 255, 1)).toBe(1);
  });
});
