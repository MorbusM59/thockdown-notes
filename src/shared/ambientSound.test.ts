import { describe, expect, it } from 'vitest';
import {
  AMBIENT_DEFAULT_MASTER_VOLUME,
  AMBIENT_NOISE_TYPES,
  AMBIENT_RAIN_SURFACES,
  AMBIENT_FACTORY_PRESETS,
  AMBIENT_PERIOD_MAX_SEC,
  AMBIENT_PERIOD_MIN_SEC,
  AMBIENT_RAIN_DEFAULT_PANS,
  DEFAULT_AMBIENT_SETTINGS,
  MAX_AMBIENT_CHANNELS,
  MAX_AMBIENT_CUSTOM_PRESETS,
  ambientSettingsSignature,
  sanitizeAmbientPreferences,
  sanitizeAmbientSettings,
} from './ambientSound';
import { buildNoiseCycle, resolveAmbientRainSpace } from './ambientSoundDsp';

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
          expect(channel.periodSec).toBeGreaterThanOrEqual(AMBIENT_PERIOD_MIN_SEC);
          expect(channel.periodSec).toBeLessThanOrEqual(AMBIENT_PERIOD_MAX_SEC);
          expect(channel.ramp).toBeGreaterThanOrEqual(0);
          expect(channel.ramp).toBeLessThanOrEqual(1);
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
      { id: 'same', volume: 2, modulationAmplitude: -1, periodSec: 100, ramp: 8, shape: 0, type: 'violet', filter: 4 },
      { id: 'same', volume: 0.4, modulationAmplitude: 0.6 },
      ...Array.from({ length: MAX_AMBIENT_CHANNELS }, (_, index) => ({ id: `extra-${index}` })),
    ]);
    expect(settings).toHaveLength(MAX_AMBIENT_CHANNELS);
    expect(settings[0]).toMatchObject({
      id: 'same', volume: 1, modulationAmplitude: 0, periodSec: AMBIENT_PERIOD_MAX_SEC,
      ramp: 1, shape: 0.1, type: 'pink', filter: 1,
    });
    expect(settings[1].id).toBe('same-1');
    expect(sanitizeAmbientSettings([])).toHaveLength(MAX_AMBIENT_CHANNELS);
  });

  it('reads a noise layer saved in the continuous/burst model in period-and-ramp terms', () => {
    const settings = sanitizeAmbientSettings([
      { id: 'continuous', modulationPeriodSec: 12, ramp: 3, speedSec: 0.7 },
      { id: 'burst', modulationPeriodSec: 0, ramp: 5, speedSec: 1.5 },
      { id: 'burst-old-mode', mode: 'burst', modulationPeriodSec: 20, ramp: 0.1, speedSec: 0.2 },
      { id: 'current', periodSec: 8, ramp: 0.3 },
    ]);
    // Continuous was a sine at its period; its old ramp only shaped bursts.
    expect(settings[0]).toMatchObject({ periodSec: 12, ramp: 0 });
    // A burst was a bell lasting speedSec, at a steepness on the bell's own
    // scale: the steepest bell is the top of today's ramp.
    expect(settings[1]).toMatchObject({ periodSec: 1.5, ramp: 1 });
    // The gentlest bell is the middle, and a burst shorter than the shortest
    // period is lengthened to it.
    expect(settings[2]).toMatchObject({ periodSec: AMBIENT_PERIOD_MIN_SEC, ramp: 0.5 });
    expect(settings[3]).toMatchObject({ periodSec: 8, ramp: 0.3 });
    expect(settings[4]).toMatchObject({ id: 'ambient-layer-5', enabled: false });
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
      ? { ...channel, ramp: channel.ramp + 0.01 }
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

describe('ambient noise cycle', () => {
  const ramps = [0, 0.1, 0.25, 0.49, 0.5, 0.51, 0.75, 1];
  const shapes = [0.1, 0.5, 0.9];

  it('runs from the trough to a single peak and back, with no seam where it repeats', () => {
    for (const ramp of ramps) {
      for (const shape of shapes) {
        const cycle = Array.from(buildNoiseCycle(ramp, shape));
        expect(cycle[0]).toBeCloseTo(-1, 6);
        expect(cycle.at(-1)).toBeCloseTo(-1, 6);
        expect(cycle.every((value) => Number.isFinite(value) && value >= -1 - 1e-6 && value <= 1 + 1e-6)).toBe(true);
        expect(Math.max(...cycle)).toBeGreaterThan(0.95);
      }
    }
  });

  it('places the peak where shape says, whatever the ramp', () => {
    for (const ramp of ramps) {
      for (const shape of shapes) {
        const cycle = Array.from(buildNoiseCycle(ramp, shape));
        const peakPhase = cycle.indexOf(Math.max(...cycle)) / (cycle.length - 1);
        expect(Math.abs(peakPhase - shape)).toBeLessThan(0.02);
      }
    }
  });

  it('is a pure sine at 0 and changes continuously across the whole slider', () => {
    const sine = buildNoiseCycle(0, 0.5);
    sine.forEach((value, index) => {
      expect(value).toBeCloseTo(-Math.cos((2 * Math.PI * index) / (sine.length - 1)), 5);
    });
    // Neighbouring slider positions give neighbouring curves -- including
    // across the middle, where the blend hands over to the bell's steepness.
    for (let step = 0; step < 100; step += 1) {
      const a = buildNoiseCycle(step / 100, 0.5);
      const b = buildNoiseCycle((step + 1) / 100, 0.5);
      const largest = Math.max(...Array.from(a, (value, index) => Math.abs(value - b[index])));
      expect(largest).toBeLessThan(0.12);
    }
  });

  it('spends more of the cycle low as the bell steepens', () => {
    const lowShare = (ramp: number) => {
      const cycle = Array.from(buildNoiseCycle(ramp, 0.5));
      return cycle.filter((value) => value < 0).length / cycle.length;
    };
    const shares = [0, 0.5, 0.75, 1].map(lowShare);
    for (let index = 1; index < shares.length; index += 1) {
      expect(shares[index]).toBeGreaterThanOrEqual(shares[index - 1]);
    }
    expect(shares.at(-1)).toBeGreaterThan(shares[0] + 0.2);
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