import { describe, expect, it } from 'vitest';
import {
  AMBIENT_DEFAULT_MASTER_VOLUME,
  AMBIENT_NOISE_SLOT_TYPES,
  AMBIENT_RAIN_SURFACES,
  AMBIENT_FACTORY_PRESETS,
  AMBIENT_PERIOD_MAX_SEC,
  AMBIENT_PERIOD_MIN_SEC,
  AMBIENT_RAIN_DEFAULT_PANS,
  DEFAULT_AMBIENT_SETTINGS,
  MAX_AMBIENT_CHANNELS,
  MAX_AMBIENT_CUSTOM_PRESETS,
  ambientSettingsSignature,
  applyAmbientPreset,
  nextAmbientPreset,
  sanitizeAmbientPreferences,
  sanitizeAmbientSettings,
} from './ambientSound';
import { resolveAmbientSpace } from './ambientSoundDsp';
import { AMBIENT_BELL_RAMP_NEAREST_SINE, buildNoiseCycle } from './ambientNoiseCycle';

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
          expect(channel.distance).toBeGreaterThanOrEqual(0);
          expect(channel.width).toBeLessThanOrEqual(1);
          expect(channel.filter).toBeGreaterThanOrEqual(0);
          expect(channel.filter).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(AMBIENT_FACTORY_PRESETS[0].settings.slice(9).every((channel) => channel.enabled)).toBe(true);
  });

  it('migrates saved Wind and Ocean settings into their noise groups and moves Rain into its dedicated slot', () => {
    const settings = sanitizeAmbientSettings({
      wind: { volume: 3, texture: -1 },
      rain: { volume: Number.NaN, texture: 0.7 },
    });
    expect(settings).toHaveLength(MAX_AMBIENT_CHANNELS);
    // Ocean was brown noise: the first brown slot. Wind was pink: the first pink slot.
    expect(settings[0]).toMatchObject({ id: 'ocean', volume: DEFAULT_AMBIENT_SETTINGS[0].volume });
    expect(settings[3]).toMatchObject({ id: 'wind', volume: 1, modulationAmplitude: 0 });
    expect(settings[1]).toMatchObject({ id: 'ambient-layer-2', kind: 'noise', enabled: false });
    expect(settings[4]).toMatchObject({ enabled: false, filter: 0.5 });
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
      ramp: 1, shape: 0.1, filter: 1,
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
    // Continuous was a sine at its period, which is the middle of today's
    // ramp; its old ramp only shaped bursts.
    expect(settings[0]).toMatchObject({ periodSec: 12, ramp: 0.5 });
    // A burst was a bell lasting speedSec, at a steepness on the bell's own
    // scale: the steepest bell is the top of today's ramp...
    expect(settings[1]).toMatchObject({ periodSec: 1.5, ramp: 1 });
    // ...and the broadest the bottom. A burst shorter than the shortest
    // period is lengthened to it.
    expect(settings[2]).toMatchObject({ periodSec: AMBIENT_PERIOD_MIN_SEC, ramp: 0 });
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

describe('noise layers grouped by type', () => {
  it('gives every noise slot the type of its group', () => {
    expect(AMBIENT_NOISE_SLOT_TYPES).toEqual(['brown', 'brown', 'brown', 'pink', 'pink', 'pink', 'white', 'white', 'white']);
    expect(AMBIENT_NOISE_SLOT_TYPES).toHaveLength(MAX_AMBIENT_CHANNELS - 3);
  });

  it('moves each layer of a save that stored types into its own group, enabled layers first', () => {
    const noise = [
      { id: 'w1', type: 'white', volume: 0.11 },
      { id: 'p1', type: 'pink', volume: 0.12 },
      { id: 'b1', type: 'brown', volume: 0.13 },
      { id: 'w2', type: 'white', volume: 0.14, enabled: false },
      { id: 'p2', type: 'pink', volume: 0.15 },
      { id: 'w3', type: 'white', volume: 0.16 },
      { id: 'w4', type: 'white', volume: 0.17 },
      { id: 'w5', type: 'white', volume: 0.18 },
    ];
    const settings = sanitizeAmbientSettings(noise);
    const idAt = (index: number) => settings[index].id;
    expect([idAt(0)]).toEqual(['b1']);
    expect([idAt(3), idAt(4)]).toEqual(['p1', 'p2']);
    // Four enabled white layers for three white slots: the first three keep
    // white, and the fourth takes the first free slot elsewhere. The
    // disabled one comes last.
    expect([idAt(6), idAt(7), idAt(8)]).toEqual(['w1', 'w3', 'w4']);
    expect(idAt(1)).toBe('w5');
    expect(idAt(2)).toBe('w2');
    expect(settings.slice(0, 9).find((channel) => channel.id === 'w2')?.enabled).toBe(false);
    expect(settings[5]).toMatchObject({ enabled: false });
  });

  it('leaves a save already in slot terms where it is', () => {
    const settings = DEFAULT_AMBIENT_SETTINGS.map((channel) => ({ ...channel }));
    expect(sanitizeAmbientSettings(settings).map((channel) => channel.id)).toEqual(settings.map((channel) => channel.id));
  });

  it('keeps distance and width in 0..1, defaulting to near and wide', () => {
    const settings = sanitizeAmbientSettings([{ id: 'a', distance: 3, width: -2 }, { id: 'b' }]);
    expect(settings[0]).toMatchObject({ distance: 1, width: 0 });
    expect(settings[1]).toMatchObject({ distance: 0, width: 1 });
  });
});

describe('stepping through soundscapes', () => {
  const custom = (id: string) => ({ id, name: id, settings: DEFAULT_AMBIENT_SETTINGS.map((channel) => ({ ...channel })) });

  it('walks the factory soundscapes in order and wraps, when there are no custom ones', () => {
    let preferences = sanitizeAmbientPreferences({});
    const visited = AMBIENT_FACTORY_PRESETS.map(() => {
      preferences = applyAmbientPreset(preferences, nextAmbientPreset(preferences));
      return preferences.activePresetId;
    });
    expect(visited).toEqual(AMBIENT_FACTORY_PRESETS.map((preset) => preset.id));
    expect(nextAmbientPreset(preferences).id).toBe(AMBIENT_FACTORY_PRESETS[0].id);
  });

  it('walks only the custom soundscapes once any exist, starting from the first', () => {
    const preferences = { ...sanitizeAmbientPreferences({}), activePresetId: 'storm', customPresets: [custom('a'), custom('b')] };
    expect(nextAmbientPreset(preferences).id).toBe('a');
    expect(nextAmbientPreset({ ...preferences, activePresetId: 'a' }).id).toBe('b');
    expect(nextAmbientPreset({ ...preferences, activePresetId: 'b' }).id).toBe('a');
  });

  it('turns ambient on, keeps the soloed slot and the listener volume', () => {
    const base = sanitizeAmbientPreferences({ masterVolume: 0.4 });
    const soloed = { ...base, settings: base.settings.map((channel, index) => ({ ...channel, solo: index === 3 })) };
    const applied = applyAmbientPreset(soloed, AMBIENT_FACTORY_PRESETS[2]);
    expect(applied).toMatchObject({ enabled: true, masterVolume: 0.4, activePresetId: AMBIENT_FACTORY_PRESETS[2].id });
    expect(applied.settings.map((channel) => channel.solo)).toEqual(applied.settings.map((_, index) => index === 3));
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

  it('is a pure sine at the middle and changes continuously across the whole slider', () => {
    const sine = buildNoiseCycle(0.5, 0.5);
    sine.forEach((value, index) => {
      expect(value).toBeCloseTo(-Math.cos((2 * Math.PI * index) / (sine.length - 1)), 5);
    });
    // Neighbouring slider positions give neighbouring curves -- including
    // across the middle, where one half's bell hands over to the other's.
    for (let step = 0; step < 100; step += 1) {
      const a = buildNoiseCycle(step / 100, 0.5);
      const b = buildNoiseCycle((step + 1) / 100, 0.5);
      const largest = Math.max(...Array.from(a, (value, index) => Math.abs(value - b[index])));
      expect(largest).toBeLessThan(0.12);
    }
  });

  // The slider runs one way only: from a plateau that is loud most of the
  // time, through a sine, to a swell that is quiet most of the time. Measured
  // as the mean level over the cycle, which a single turn-back anywhere along
  // the slider would make fall and rise again.
  it('spends more of the cycle low at every step to the right', () => {
    const meanLevel = (ramp: number) => {
      const cycle = Array.from(buildNoiseCycle(ramp, 0.5));
      return cycle.reduce((sum, value) => sum + value, 0) / cycle.length;
    };
    const means = Array.from({ length: 51 }, (_, step) => meanLevel(step / 50));
    for (let index = 1; index < means.length; index += 1) {
      expect(means[index]).toBeLessThan(means[index - 1]);
    }
    expect(means[0]).toBeGreaterThan(0.2);
    expect(Math.abs(means[25])).toBeLessThan(0.01);
    expect(means[50]).toBeLessThan(-0.6);
  });

  it('meets the sine at the bell that is actually nearest to it', () => {
    expect(AMBIENT_BELL_RAMP_NEAREST_SINE).toBeGreaterThan(0.5);
    expect(AMBIENT_BELL_RAMP_NEAREST_SINE).toBeLessThan(1);
  });
});

describe('ambient rain distance', () => {
  it('moves monotonically from direct and bright to quieter, filtered, and reverberant', () => {
    const near = resolveAmbientSpace(0);
    const middle = resolveAmbientSpace(0.5);
    const far = resolveAmbientSpace(1);

    expect(near.cutoffHz).toBeGreaterThan(middle.cutoffHz);
    expect(middle.cutoffHz).toBeGreaterThan(far.cutoffHz);
    expect(near.directGain).toBeGreaterThan(middle.directGain);
    expect(middle.directGain).toBeGreaterThan(far.directGain);
    expect(near.reverbSend).toBeLessThan(middle.reverbSend);
    expect(middle.reverbSend).toBeLessThan(far.reverbSend);
    expect(resolveAmbientSpace(-1)).toEqual(near);
    expect(resolveAmbientSpace(2)).toEqual(far);
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