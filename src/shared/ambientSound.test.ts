import { describe, expect, it } from 'vitest';
import {
  AMBIENT_DEFAULT_MASTER_VOLUME,
  AMBIENT_NOISE_TYPES,
  AMBIENT_RAIN_SURFACES,
  AMBIENT_FACTORY_PRESETS,
  AMBIENT_MODULATION_PERIOD_MIN_SEC,
  AMBIENT_RAIN_DEFAULT_PANS,
  DEFAULT_AMBIENT_SETTINGS,
  MAX_AMBIENT_CHANNELS,
  MAX_AMBIENT_CUSTOM_PRESETS,
  ambientSettingsSignature,
  sanitizeAmbientPreferences,
  sanitizeAmbientSettings,
} from './ambientSound';
import { buildAmbientEnvelope, resolveAmbientRainSpace } from './ambientSoundDsp';

describe('ambient sound configuration', () => {
  it('defines six complete factory soundscapes with bounded channel values', () => {
    expect(AMBIENT_FACTORY_PRESETS).toHaveLength(6);
    for (const preset of AMBIENT_FACTORY_PRESETS) {
      expect(preset.settings).toHaveLength(MAX_AMBIENT_CHANNELS);
      expect(preset.settings.filter((channel) => channel.enabled)).toHaveLength(
        ['rain', 'street', 'forest', 'storm'].includes(preset.id) ? 5 : 3,
      );
      for (const channel of preset.settings) {
        expect(channel.volume).toBeGreaterThanOrEqual(0);
        expect(channel.volume).toBeLessThanOrEqual(1);
        if (channel.kind === 'rain') {
          expect(channel.dropsPerSecond).toBeGreaterThanOrEqual(1);
          expect(channel.dropsPerSecond).toBeLessThanOrEqual(60);
          expect(channel.distance).toBeGreaterThanOrEqual(0);
          expect(channel.distance).toBeLessThanOrEqual(1);
          expect(channel.pan).toBeGreaterThanOrEqual(-1);
          expect(channel.pan).toBeLessThanOrEqual(1);
          expect(channel.bassGain).toBeGreaterThanOrEqual(0);
          expect(channel.bassGain).toBeLessThanOrEqual(1);
          expect(channel.trebleGain).toBeGreaterThanOrEqual(0);
          expect(channel.trebleGain).toBeLessThanOrEqual(1);
          expect(AMBIENT_RAIN_SURFACES).toContain(channel.surface);
          expect(channel.wash).toBeGreaterThanOrEqual(0);
          expect(channel.wash).toBeLessThanOrEqual(1);
          expect(channel.drips).toBeGreaterThanOrEqual(0);
          expect(channel.drips).toBeLessThanOrEqual(1);
        } else {
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
    }
    expect(AMBIENT_FACTORY_PRESETS[0].settings.slice(9).every((channel) => channel.enabled)).toBe(true);
  });

  it('migrates saved Wind and Ocean settings and moves Rain into its dedicated slot', () => {
    const settings = sanitizeAmbientSettings({
      wind: { volume: 3, texture: -1 },
      rain: { volume: Number.NaN, texture: 0.7 },
    });
    expect(settings).toHaveLength(MAX_AMBIENT_CHANNELS);
    expect(settings[0]).toMatchObject({ id: 'wind', volume: 1, modulationAmplitude: 0 });
    expect(settings[1]).toMatchObject({ id: 'ocean', volume: DEFAULT_AMBIENT_SETTINGS[1].volume });
    expect(settings[2]).toMatchObject({ id: 'ambient-layer-3', kind: 'noise', enabled: false });
    expect(settings[3]).toMatchObject({ enabled: false, filter: 0.5 });
    expect(settings[9]).toMatchObject({ id: 'rain', kind: 'rain', volume: 0, dropsPerSecond: 42 });
  });

  it('normalizes the final three saved slots as rain while preserving common channel state', () => {
    const input = Array.from({ length: MAX_AMBIENT_CHANNELS }, (_, index) => ({
      id: `slot-${index + 1}`,
      enabled: index >= 9,
      solo: index === 10,
      volume: 0.1 * (index + 1),
      densityPer10Sec: 40,
      filter: 0.25,
    }));
    const settings = sanitizeAmbientSettings(input);

    expect(settings.slice(0, 9).every((channel) => channel.kind === 'noise')).toBe(true);
    expect(settings.slice(9).map((channel) => channel.kind)).toEqual(['rain', 'rain', 'rain']);
    expect(settings.slice(9).map((channel) => channel.kind === 'rain' ? channel.dropsPerSecond : null))
      .toEqual([4, 4, 4]);
    expect(settings.slice(9).map((channel) => channel.kind === 'rain' ? channel.pan : null))
      .toEqual(AMBIENT_RAIN_DEFAULT_PANS);
    expect(settings[10]).toMatchObject({ id: 'slot-11', enabled: true, solo: true, volume: 1, distance: 0.5 });
  });

  it('clamps rain pan and component gains independently', () => {
    const input = DEFAULT_AMBIENT_SETTINGS.map((channel, index) => (
      index === 9 && channel.kind === 'rain'
        ? { ...channel, pan: -2, bassGain: 2, trebleGain: -1 }
        : channel
    ));
    const rain = sanitizeAmbientSettings(input)[9];

    expect(rain).toMatchObject({ kind: 'rain', pan: -1, bassGain: 1, trebleGain: 0 });
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
    expect(settings[0].kind === 'noise' ? settings[0].modulationPeriodSec : null).toBe(0);
    expect(settings[1].kind === 'noise' ? settings[1].modulationPeriodSec : null)
      .toBe(AMBIENT_MODULATION_PERIOD_MIN_SEC);
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
    const changed = preset.settings.map((channel, index) => index === 2 && channel.kind === 'noise'
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
    const rain = preset.settings[9];
    if (rain.kind === 'rain') {
      for (const change of [
        { ...rain, pan: 0.2 },
        { ...rain, bassGain: 0.2 },
        { ...rain, trebleGain: 0.2 },
      ]) {
        const changedRain = preset.settings.map((channel, index) => index === 9 ? change : channel);
        expect(ambientSettingsSignature(changedRain)).not.toBe(ambientSettingsSignature(preset.settings));
      }
    }
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

describe('ambient rain distance', () => {
  it('moves monotonically from direct and bright to quieter, filtered, and reverberant', () => {
    const near = resolveAmbientRainSpace(0);
    const middle = resolveAmbientRainSpace(0.5);
    const far = resolveAmbientRainSpace(1);

    expect(near.cutoffHz).toBeGreaterThan(middle.cutoffHz);
    expect(middle.cutoffHz).toBeGreaterThan(far.cutoffHz);
    expect(near.directGain).toBeGreaterThan(middle.directGain);
    expect(middle.directGain).toBeGreaterThan(far.directGain);
    expect(near.reverbSend).toBeLessThan(middle.reverbSend);
    expect(middle.reverbSend).toBeLessThan(far.reverbSend);
    expect(resolveAmbientRainSpace(-1)).toEqual(near);
    expect(resolveAmbientRainSpace(2)).toEqual(far);
  });
  it('reads a rain layer saved before surfaces existed as the glass model it was', () => {
    const legacyRain = DEFAULT_AMBIENT_SETTINGS.map((channel) => {
      if (channel.kind !== 'rain') return channel;
      const { surface: _surface, wash: _wash, drips: _drips, ...rest } = channel;
      return rest;
    });
    const settings = sanitizeAmbientSettings(legacyRain);
    for (const channel of settings.slice(9)) {
      expect(channel).toMatchObject({ kind: 'rain', surface: 'glass', wash: 0, drips: 0 });
    }
  });

  it('keeps a known surface, replaces an unknown one and clamps wash and drips', () => {
    const input = DEFAULT_AMBIENT_SETTINGS.map((channel, index) => (
      channel.kind !== 'rain' ? channel
        : index === 9 ? { ...channel, surface: 'forest', wash: 3, drips: -1 }
          : { ...channel, surface: 'lava' }
    ));
    const settings = sanitizeAmbientSettings(input);
    expect(settings[9]).toMatchObject({ surface: 'forest', wash: 1, drips: 0 });
    expect(settings[10]).toMatchObject({ surface: 'street' });
  });

  it('treats master volume as a listener setting outside the soundscape', () => {
    expect(sanitizeAmbientPreferences({}).masterVolume).toBe(AMBIENT_DEFAULT_MASTER_VOLUME);
    expect(sanitizeAmbientPreferences({ masterVolume: 4 }).masterVolume).toBe(1);
    expect(sanitizeAmbientPreferences({ masterVolume: 0.25 }).masterVolume).toBe(0.25);
    const surfaceChanged = DEFAULT_AMBIENT_SETTINGS.map((channel) => (
      channel.kind === 'rain' ? { ...channel, surface: 'forest' as const } : channel
    ));
    expect(ambientSettingsSignature(surfaceChanged)).not.toBe(ambientSettingsSignature(DEFAULT_AMBIENT_SETTINGS));
  });
});