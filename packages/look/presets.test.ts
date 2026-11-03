import { describe, expect, it } from 'vitest';
import { DARK_FACTORY_PRESETS, LIGHT_FACTORY_PRESETS } from './presets';
import { defaultVisualizer } from './visualizer';

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
      const colors = defaultVisualizer(preset.filterInvert > 0.5);
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
