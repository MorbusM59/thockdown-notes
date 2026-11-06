import { describe, expect, it } from 'vitest';
import { DARK_FACTORY_PRESETS, LIGHT_FACTORY_PRESETS } from './presets';
import { defaultVisualizer } from './visualizer';

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

describe('factory preset visualizer defaults', () => {
  it('uses the saved layout tuning while preserving each preset’s element colours', () => {
    const base = defaultVisualizer(false);
    const expectedTuning = {
      ...base,
      caret: { ...base.caret, fallSec: 1.5 },
      edge: { ...base.edge, fallSec: 0.5 },
      pane: { ...base.pane, effect: 0.7, fallSec: 0.3, shape: -0.2 },
      immersive: {
        ...base.immersive,
        glazeStrength: 0.06,
        glazeSpread: -1,
        swayDrift: 10,
        waveFallSec: 1.5,
        waveMix: { ...base.immersive.waveMix, pierce: 1 },
        pulseSpeed: 35,
        pulseHalfLifeSec: 0.75,
        pulseFadeSec: 1.5,
        pulseSoftness: 0.5,
        pulseBoost: 0.5,
      },
    };

    for (const preset of [...LIGHT_FACTORY_PRESETS, ...DARK_FACTORY_PRESETS]) {
      // A preset may name its own element colours (Gold names its letterbox);
      // the tuning is what every preset shares.
      const colors = preset.visualizer;
      expect(preset.visualizer).toEqual({
        ...expectedTuning,
        edge: { ...expectedTuning.edge, color: colors.edge.color },
        pane: { ...expectedTuning.pane, color: colors.pane.color },
        immersive: {
          ...expectedTuning.immersive,
          accentColor: colors.immersive.accentColor,
          waveColor: colors.immersive.waveColor,
          pulseColor: colors.immersive.pulseColor,
          letterboxColor: colors.immersive.letterboxColor,
        },
      });
    }
  });
});
