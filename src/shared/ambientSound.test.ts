import { describe, expect, it } from 'vitest';
import {
  AMBIENT_NOISE_TYPES,
  AMBIENT_FACTORY_PRESETS,
  AMBIENT_MODULATION_PERIOD_MIN_SEC,
  DEFAULT_AMBIENT_SETTINGS,
  MAX_AMBIENT_CHANNELS,
  MAX_AMBIENT_CUSTOM_PRESETS,
  ambientSettingsSignature,
  sanitizeAmbientPreferences,
  sanitizeAmbientSettings,
} from './ambientSound';
import { buildAmbientEnvelope } from './ambientSoundDsp';

describe('ambient sound configuration', () => {
  it('defines six complete factory soundscapes with bounded channel values', () => {
    expect(AMBIENT_FACTORY_PRESETS).toHaveLength(6);
    for (const preset of AMBIENT_FACTORY_PRESETS) {
      expect(preset.settings).toHaveLength(MAX_AMBIENT_CHANNELS);
      for (const channel of preset.settings) {
        expect(channel.enabled).toBe(['wind', 'ocean', 'rain'].includes(channel.id));
        expect(channel.volume).toBeGreaterThanOrEqual(0);
        expect(channel.volume).toBeLessThanOrEqual(1);
        expect(channel.modulationAmplitude).toBeGreaterThanOrEqual(0);
        expect(channel.modulationAmplitude).toBeLessThanOrEqual(1);
        if (channel.modulationPeriodSec !== 0) {
          expect(channel.modulationPeriodSec).toBeGreaterThanOrEqual(AMBIENT_MODULATION_PERIOD_MIN_SEC);
        }
        expect(channel.modulationPeriodSec).toBeLessThanOrEqual(50);
        expect(AMBIENT_NOISE_TYPES).toContain(channel.type);
        expect(channel.filter).toBeGreaterThanOrEqual(0);
        expect(channel.filter).toBeLessThanOrEqual(1);
      }
    }
  });

  it('migrates saved Wind, Ocean, and Rain settings into editable channels', () => {
    const settings = sanitizeAmbientSettings({
      wind: { volume: 3, texture: -1 },
      rain: { volume: Number.NaN, texture: 0.7 },
    });
    expect(settings).toHaveLength(MAX_AMBIENT_CHANNELS);
    expect(settings[0]).toMatchObject({ id: 'wind', volume: 1, modulationAmplitude: 0 });
    expect(settings[1]).toMatchObject({ id: 'ocean', volume: DEFAULT_AMBIENT_SETTINGS[1].volume });
    expect(settings[2]).toMatchObject({ id: 'rain', volume: 0, modulationAmplitude: 0.7, type: 'white', modulationPeriodSec: 0 });
    expect(settings[3]).toMatchObject({ enabled: false, filter: 0.5 });
  });

  it('clamps and bounds dynamic channel settings while ensuring one channel remains', () => {
    const settings = sanitizeAmbientSettings([
      { id: 'same', volume: 2, modulationAmplitude: -1, modulationPeriodSec: 100, ramp: 8, shape: 0, speedSec: -3, type: 'violet', densityPer10Sec: 105, filter: 4 },
      { id: 'same', volume: 0.4, modulationAmplitude: 0.6 },
      ...Array.from({ length: MAX_AMBIENT_CHANNELS }, (_, index) => ({ id: `extra-${index}` })),
    ]);
    expect(settings).toHaveLength(MAX_AMBIENT_CHANNELS);
    expect(settings[0]).toMatchObject({
      id: 'same', volume: 1, modulationAmplitude: 0, modulationPeriodSec: 50,
      ramp: 5, shape: 0.1, speedSec: 0, type: 'pink', densityPer10Sec: 100, filter: 1,
    });
    expect(settings[1].id).toBe('same-1');
    expect(sanitizeAmbientSettings([])).toHaveLength(MAX_AMBIENT_CHANNELS);
  });

  it('fills permanent disabled slots and uses zero modulation period for burst mode', () => {
    const settings = sanitizeAmbientSettings([
      { id: 'first', modulationPeriodSec: 0 },
      { id: 'second', modulationPeriodSec: 0.1 },
    ]);

    expect(settings).toHaveLength(MAX_AMBIENT_CHANNELS);
    expect(settings[0].modulationPeriodSec).toBe(0);
    expect(settings[1].modulationPeriodSec).toBe(AMBIENT_MODULATION_PERIOD_MIN_SEC);
    expect(settings[2]).toMatchObject({ id: 'ambient-layer-3', enabled: false });
  });

  it('keeps solo independent from enabled state and normalizes it to one slot', () => {
    const settings = sanitizeAmbientSettings([
      { id: 'first', enabled: true, solo: true },
      { id: 'second', enabled: true, solo: true },
      { id: 'third', enabled: false, solo: true },
    ]);

    expect(settings.slice(0, 3).map(({ enabled, solo }) => ({ enabled, solo }))).toEqual([
      { enabled: true, solo: true },
      { enabled: true, solo: false },
      { enabled: false, solo: false },
    ]);
  });

  it('preserves disabled channel slots and their settings in order', () => {
    const settings = sanitizeAmbientSettings([
      { id: 'first', enabled: true, volume: 0.33 },
      { id: 'second', enabled: false, volume: 0.77 },
      { id: 'third', enabled: true, volume: 0.15 },
    ]);

    expect(settings.slice(0, 3).map(({ id, enabled, volume }) => ({ id, enabled, volume }))).toEqual([
      { id: 'first', enabled: true, volume: 0.33 },
      { id: 'second', enabled: false, volume: 0.77 },
      { id: 'third', enabled: true, volume: 0.15 },
    ]);
    expect(settings.slice(3).every((channel) => !channel.enabled)).toBe(true);
  });

  it('uses all layer values to distinguish a saved soundscape from pending changes', () => {
    const preset = AMBIENT_FACTORY_PRESETS[0];
    const changed = preset.settings.map((channel, index) => index === 2
      ? { ...channel, densityPer10Sec: channel.densityPer10Sec + 1 }
      : { ...channel });
    expect(ambientSettingsSignature(preset.settings)).toBe(ambientSettingsSignature(preset.settings.map((channel) => ({ ...channel, id: 'different-id' }))));
    expect(ambientSettingsSignature(changed)).not.toBe(ambientSettingsSignature(preset.settings));
    expect(ambientSettingsSignature(preset.settings)).not.toBe(ambientSettingsSignature(
      preset.settings.map((channel, index) => index === 0 ? { ...channel, enabled: false } : channel),
    ));
    expect(ambientSettingsSignature(preset.settings)).not.toBe(ambientSettingsSignature(
      preset.settings.map((channel, index) => index === 0 ? { ...channel, filter: 0.4 } : channel),
    ));
    expect(ambientSettingsSignature(preset.settings)).toBe(ambientSettingsSignature(
      preset.settings.map((channel, index) => index === 0 ? { ...channel, solo: true } : channel),
    ));
  });

  it('bounds and deduplicates saved presets, and drops an invalid active id', () => {
    const soloSettings = DEFAULT_AMBIENT_SETTINGS.map((channel, index) => ({
      ...channel,
      solo: index === 1,
    }));
    const loaded = sanitizeAmbientPreferences({
      enabled: true,
      activePresetId: 'missing',
      customPresets: [
        { id: 'one', name: ' Saved ', settings: soloSettings },
        { id: 'one', name: 'Duplicate', settings: DEFAULT_AMBIENT_SETTINGS },
        { id: 'bad', name: ' ', settings: DEFAULT_AMBIENT_SETTINGS },
      ],
    });
    expect(loaded.enabled).toBe(true);
    expect(loaded.activePresetId).toBeNull();
    expect(loaded.customPresets).toHaveLength(1);
    expect(loaded.customPresets[0].name).toBe('Saved');
    expect(loaded.customPresets[0].settings[1].solo).toBe(false);

    const tooMany = Array.from({ length: MAX_AMBIENT_CUSTOM_PRESETS + 2 }, (_, index) => ({
      id: `preset-${index}`,
      name: `Preset ${index}`,
      settings: DEFAULT_AMBIENT_SETTINGS,
    }));
    expect(sanitizeAmbientPreferences({ customPresets: tooMany }).customPresets)
      .toHaveLength(MAX_AMBIENT_CUSTOM_PRESETS);
  });
});

describe('ambient burst envelopes', () => {
  it('builds finite curve-shaped envelopes that start and finish at silence', () => {
    for (const ramp of [0.1, 1.5, 5]) {
      for (const shape of [0.1, 0.5, 0.9]) {
        const envelope = buildAmbientEnvelope(ramp, shape);
        expect(envelope[0]).toBe(0);
        expect(envelope.at(-1)).toBe(0);
        expect(Array.from(envelope).every((sample) => Number.isFinite(sample) && sample >= 0 && sample <= 1)).toBe(true);
        expect(Math.max(...envelope)).toBeGreaterThan(0.9);
      }
    }
  });
});