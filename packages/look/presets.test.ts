import { describe, expect, it } from 'vitest';
import { DARK_FACTORY_PRESETS, LIGHT_FACTORY_PRESETS } from './presets';

describe('dark default cursor settings', () => {
  it('uses the saved custom layout cursor', () => {
    expect(DARK_FACTORY_PRESETS[0]).toMatchObject({
      cursorDotColor: 'rgba(85, 85, 85, 0.713)',
      cursorCenterColor: 'rgba(20, 20, 20, 0.713)',
      cursorTrailColor: 'rgba(85, 85, 85, 0.423)',
      cursorDotCount: 1,
      cursorRadiusPx: 12,
      cursorSpinHz: 2,
      cursorTrailThicknessPx: 3,
      cursorTrailFadeMs: 1500,
      cursorDotSizePx: 0,
      cursorCenterSizePx: 3,
      cursorHaloColor: 'rgba(38, 74, 128, 0.588)',
      cursorHaloRadiusPx: 10,
      cursorHaloFalloff: 10,
      cursorPulseMagnitude: 0.3,
      cursorClickSkew: 0.3,
    });
  });

  describe('factory texture settings', () => {
    it('represents the former disabled Paper sidebar texture with zero strength', () => {
      expect(LIGHT_FACTORY_PRESETS[3].textureMaterials.sidebarContent.textureStrength).toBe(0);
    });

    it('matches the exported texture settings for Sand', () => {
      expect(LIGHT_FACTORY_PRESETS[1].textureMaterials).toMatchObject({
        appGrid: {
          color: { a: 1, h: 18, s: 0.0435, v: 0.902 },
          granularity: 2,
          seed: 895378,
          textureStrength: 1,
          vSteps: 3,
        },
        editorEditText: {
          color: { a: 1, h: 13, s: 0.0419, v: 0.8431 },
          granularity: 2,
          seed: 895378,
          textureStrength: 1,
          vSteps: 3,
        },
        editorRenderText: {
          color: { a: 1, h: 13, s: 0.0419, v: 0.8431 },
          granularity: 2,
          seed: 895378,
          textureStrength: 1,
          vSteps: 3,
        },
        sidebarContent: {
          color: { a: 1, h: 13, s: 0.0419, v: 0.8431 },
          granularity: 2,
          seed: 895378,
          textureStrength: 1,
          vSteps: 3,
        },
      });
    });
  });
});
