import { describe, expect, it } from 'vitest';
import {
  AMBIENT_FACTORY_PRESETS,
  DEFAULT_AMBIENT_SETTINGS,
  MAX_AMBIENT_CUSTOM_PRESETS,
  ambientSettingsSignature,
  sanitizeAmbientPreferences,
  sanitizeAmbientSettings,
} from './ambientSound';
import { buildAmbientEnvelopeBank, resolveAmbientTextureProfile } from './ambientSoundDsp';

describe('ambient sound configuration', () => {
  it('defines six complete factory soundscapes with bounded layer values', () => {
    expect(AMBIENT_FACTORY_PRESETS).toHaveLength(6);
    for (const preset of AMBIENT_FACTORY_PRESETS) {
      expect(Object.keys(preset.settings).sort()).toEqual(['ocean', 'rain', 'wind']);
      for (const layer of Object.values(preset.settings)) {
        expect(layer.volume).toBeGreaterThanOrEqual(0);
        expect(layer.volume).toBeLessThanOrEqual(1);
        expect(layer.texture).toBeGreaterThanOrEqual(0);
        expect(layer.texture).toBeLessThanOrEqual(1);
      }
    }
  });

  it('clamps damaged layer values and supplies defaults for missing layers', () => {
    const settings = sanitizeAmbientSettings({
      wind: { volume: 3, texture: -1 },
      rain: { volume: Number.NaN, texture: 0.7 },
    });
    expect(settings.wind).toEqual({ volume: 1, texture: 0 });
    expect(settings.ocean).toEqual(DEFAULT_AMBIENT_SETTINGS.ocean);
    expect(settings.rain).toEqual({ volume: 0, texture: 0.7 });
  });

  it('uses all layer values to distinguish a saved soundscape from pending changes', () => {
    const preset = AMBIENT_FACTORY_PRESETS[0];
    const changed = {
      ...preset.settings,
      rain: { ...preset.settings.rain, volume: preset.settings.rain.volume + 0.01 },
    };
    expect(ambientSettingsSignature(preset.settings)).toBe(ambientSettingsSignature({
      wind: { ...preset.settings.wind },
      ocean: { ...preset.settings.ocean },
      rain: { ...preset.settings.rain },
    }));
    expect(ambientSettingsSignature(changed)).not.toBe(ambientSettingsSignature(preset.settings));
  });

  it('bounds and deduplicates saved presets, and drops an invalid active id', () => {
    const loaded = sanitizeAmbientPreferences({
      enabled: true,
      activePresetId: 'missing',
      customPresets: [
        { id: 'one', name: ' Saved ', settings: DEFAULT_AMBIENT_SETTINGS },
        { id: 'one', name: 'Duplicate', settings: DEFAULT_AMBIENT_SETTINGS },
        { id: 'bad', name: ' ', settings: DEFAULT_AMBIENT_SETTINGS },
      ],
    });
    expect(loaded.enabled).toBe(true);
    expect(loaded.activePresetId).toBeNull();
    expect(loaded.customPresets).toHaveLength(1);
    expect(loaded.customPresets[0].name).toBe('Saved');

    const tooMany = Array.from({ length: MAX_AMBIENT_CUSTOM_PRESETS + 2 }, (_, index) => ({
      id: `preset-${index}`,
      name: `Preset ${index}`,
      settings: DEFAULT_AMBIENT_SETTINGS,
    }));
    expect(sanitizeAmbientPreferences({ customPresets: tooMany }).customPresets)
      .toHaveLength(MAX_AMBIENT_CUSTOM_PRESETS);
  });
});

describe('ambient texture mapping', () => {
  it('moves from a steady slow bed to faster, deeper modulation and frequent events', () => {
    const quiet = resolveAmbientTextureProfile(0);
    const textured = resolveAmbientTextureProfile(1);
    expect(quiet.modulationDepth).toBeLessThan(textured.modulationDepth);
    expect(quiet.modulationCycleSec).toBeGreaterThan(textured.modulationCycleSec);
    expect(quiet.burstRatePerVoice).toBeLessThan(textured.burstRatePerVoice);
    expect(textured.chaos).toBe(1);
  });

  it('builds finite curve-shaped event envelopes that start and finish at silence', () => {
    for (const texture of [0, 0.5, 1]) {
      for (const envelope of buildAmbientEnvelopeBank(texture)) {
        expect(envelope[0]).toBe(0);
        expect(envelope.at(-1)).toBe(0);
        expect(Array.from(envelope).every((sample) => Number.isFinite(sample) && sample >= 0 && sample <= 1)).toBe(true);
        expect(Math.max(...envelope)).toBeGreaterThan(0.9);
      }
    }
  });
});