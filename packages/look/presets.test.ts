import { describe, expect, it } from 'vitest';
import { DARK_FACTORY_PRESETS } from './presets';

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
});
