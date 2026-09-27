import { describe, expect, it } from 'vitest';
import {
  SOUNDSCAPE_CHANNEL_DEFAULTS,
  SOUNDSCAPE_CHANNEL_ROSTER,
  SOUNDSCAPE_FACTORY_PRESETS,
  SOUNDSCAPE_FIELD_BOUNDS,
  SOUNDSCAPE_SPACE_BOUNDS,
  SOUNDSCAPE_WEATHER_BOUNDS,
  DEFAULT_SOUNDSCAPE_SETTINGS,
  soundscapeFaderDb,
  soundscapeFaderGain,
  soundscapeSettingsSignature,
  applySoundscapePreset,
  cloneSettings,
  chimeSemitoneHz,
  createSoundscapeChannel,
  DEFAULT_SOUNDSCAPE_SPACE,
  hasAudibleSoundscapeLayer,
  nextSoundscapePreset,
  sanitizeSoundscapePreferences,
  sanitizeSoundscapeSettings,
  type SoundscapePreferences,
} from './soundscape';
import {
  buildNoiseToneTable,
  noiseColourWeights,
  noiseFilterPower,
  resolveSoundscapeSpace,
  toWorkletConfiguration,
} from './soundscapeDsp';
import { SOUNDSCAPE_BELL_RAMP_NEAREST_SINE, buildNoiseCycle } from './soundscapeNoiseCycle';
import { buildSoundscapeImpulseResponse, spaceDecaySec } from './soundscapeSpace';

function inBounds(record: Record<string, unknown>, bounds: Record<string, readonly unknown[]>) {
  for (const [field, range] of Object.entries(bounds)) {
    const value = record[field] as number;
    expect(Number.isFinite(value), field).toBe(true);
    expect(value, field).toBeGreaterThanOrEqual(range[0] as number);
    expect(value, field).toBeLessThanOrEqual(range[1] as number);
    if (range[2] === 'integer') expect(Number.isInteger(value), field).toBe(true);
  }
}

describe('the roster', () => {
  it('names every channel once, numbered within its kind', () => {
    const ids = SOUNDSCAPE_CHANNEL_ROSTER.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of SOUNDSCAPE_CHANNEL_ROSTER) {
      const ofKind = SOUNDSCAPE_CHANNEL_ROSTER.filter((item) => item.kind === entry.kind);
      expect(ofKind.indexOf(entry) + 1).toBe(entry.number);
    }
  });

  it('gives every kind a default for every field the sanitizer bounds, inside its bounds', () => {
    for (const [kind, defaults] of Object.entries(SOUNDSCAPE_CHANNEL_DEFAULTS)) {
      inBounds(defaults as unknown as Record<string, unknown>, SOUNDSCAPE_FIELD_BOUNDS[kind as keyof typeof SOUNDSCAPE_FIELD_BOUNDS]);
    }
  });
});

describe('defaults', () => {
  it('start every channel centred', () => {
    for (const entry of SOUNDSCAPE_CHANNEL_ROSTER) {
      const channel = createSoundscapeChannel(entry.id, entry.kind) as { pan?: number }
      if (channel.pan !== undefined) expect(channel.pan, entry.id).toBe(0)
    }
  })

  it('tune chimes in semitones from A440, a stored pitch landing on the nearest', () => {
    expect(chimeSemitoneHz(0)).toBe(440)
    expect(chimeSemitoneHz(12)).toBeCloseTo(880, 9)
    const settings = sanitizeSoundscapeSettings({ channels: [{ id: 'chimes-1', pitchHz: 450 }, { id: 'chimes-2', pitchHz: 5000 }] })
    expect(settings.channels.find((channel) => channel.id === 'chimes-1')).toMatchObject({ pitchHz: 440 })
    expect((settings.channels.find((channel) => channel.id === 'chimes-2') as { pitchHz: number }).pitchHz).toBeCloseTo(chimeSemitoneHz(21), 9)
    for (const preset of SOUNDSCAPE_FACTORY_PRESETS) {
      for (const channel of preset.settings.channels) {
        if (channel.kind !== 'chimes') continue
        const semitones = 12 * Math.log2(channel.pitchHz / 440)
        expect(Math.abs(semitones - Math.round(semitones))).toBeLessThan(1e-9)
      }
    }
  })
})

describe('factory soundscapes', () => {
  it('are complete, in roster order, bounded, and each sounds', () => {
    const ids = new Set<string>();
    for (const preset of SOUNDSCAPE_FACTORY_PRESETS) {
      expect(ids.has(preset.id)).toBe(false);
      ids.add(preset.id);
      expect(preset.settings.channels.map((channel) => channel.id)).toEqual(SOUNDSCAPE_CHANNEL_ROSTER.map((entry) => entry.id));
      for (const channel of preset.settings.channels) {
        expect(channel.kind).toBe(SOUNDSCAPE_CHANNEL_ROSTER.find((entry) => entry.id === channel.id)?.kind);
        expect(channel.solo).toBe(false);
        inBounds(channel as unknown as Record<string, unknown>, SOUNDSCAPE_FIELD_BOUNDS[channel.kind]);
      }
      inBounds(preset.settings.space as unknown as Record<string, unknown>, SOUNDSCAPE_SPACE_BOUNDS);
      inBounds(preset.settings.weather as unknown as Record<string, unknown>, SOUNDSCAPE_WEATHER_BOUNDS);
      expect(hasAudibleSoundscapeLayer(preset.settings)).toBe(true);
      // Sanitizing a preset changes nothing: it is already in the stored shape.
      expect(sanitizeSoundscapeSettings(preset.settings)).toEqual(preset.settings);
    }
  });

  it('are told apart by their signatures', () => {
    const signatures = new Set(SOUNDSCAPE_FACTORY_PRESETS.map((preset) => soundscapeSettingsSignature(preset.settings)));
    expect(signatures.size).toBe(SOUNDSCAPE_FACTORY_PRESETS.length);
  });
});

describe('sanitizing', () => {
  it('reads anything not in the current shape -- an older save included -- as the default soundscape', () => {
    for (const input of [undefined, null, 3, [], [{ kind: 'noise', volume: 0.4 }], { wind: { volume: 0.2, texture: 0.3 } }, { channels: 'x' }]) {
      expect(sanitizeSoundscapeSettings(input)).toEqual(DEFAULT_SOUNDSCAPE_SETTINGS);
    }
  });

  it('matches channels by id, drops unknown ones, and starts a missing one disabled at its defaults', () => {
    const settings = sanitizeSoundscapeSettings({
      channels: [
        { id: 'fire-1', kind: 'noise', enabled: true, volume: 0.3, size: 0.9 },
        { id: 'ghost-1', enabled: true, volume: 1 },
        { id: 'noise-2', enabled: false, colour: 7, brightnessHz: 5, periodSec: 1000 },
      ],
    });
    expect(settings.channels.map((channel) => channel.id)).toEqual(SOUNDSCAPE_CHANNEL_ROSTER.map((entry) => entry.id));
    const fire = settings.channels.find((channel) => channel.id === 'fire-1');
    // The kind is the roster's, never the stored one.
    expect(fire).toMatchObject({ kind: 'fire', enabled: true, volume: 0.3, size: 0.9 });
    const noise = settings.channels.find((channel) => channel.id === 'noise-2');
    expect(noise).toMatchObject({ kind: 'noise', enabled: false, colour: 1, brightnessHz: 80, periodSec: 60 });
    const water = settings.channels.find((channel) => channel.id === 'water-1');
    expect(water).toEqual(createSoundscapeChannel('water-1', 'water', { enabled: false }));
  });

  it('keeps at most one channel soloed, and rounds a whole-number field', () => {
    const settings = sanitizeSoundscapeSettings({
      channels: [
        { id: 'rain-2', solo: true },
        { id: 'noise-1', solo: true },
        { id: 'chimes-1', tubes: 5.6 },
      ],
    });
    expect(settings.channels.filter((channel) => channel.solo).map((channel) => channel.id)).toEqual(['noise-1']);
    expect(settings.channels.find((channel) => channel.id === 'chimes-1')).toMatchObject({ tubes: 6 });
  });

  it('bounds the space and the weather', () => {
    const settings = sanitizeSoundscapeSettings({ channels: [], space: { size: 3, damping: -1, echoes: 'x' }, weather: { paceSec: 0 } });
    expect(settings.space).toMatchObject({ size: 1, damping: 0, echoes: DEFAULT_SOUNDSCAPE_SPACE.echoes });
    expect(settings.weather.paceSec).toBe(2);
  });

  it('bounds and deduplicates saved presets, drops ones from before the roster, and an invalid active id', () => {
    const settings = cloneSettings(SOUNDSCAPE_FACTORY_PRESETS[2].settings);
    const preferences = sanitizeSoundscapePreferences({
      enabled: true,
      masterVolume: 4,
      settings,
      activePresetId: 'nope',
      customPresets: [
        { id: 'a', name: '  Night  ', settings },
        { id: 'a', name: 'Duplicate', settings },
        { id: 'b', name: 'Old', settings: [{ kind: 'noise' }] },
        { id: 'c', name: '', settings },
      ],
    });
    expect(preferences.masterVolume).toBe(1);
    expect(preferences.activePresetId).toBeNull();
    expect(preferences.customPresets.map((preset) => [preset.id, preset.name])).toEqual([['a', 'Night']]);
  });
});

describe('the signature', () => {
  it('changes with every field of every channel, the space and the weather, and not with solo', () => {
    const base = cloneSettings(DEFAULT_SOUNDSCAPE_SETTINGS);
    const signature = soundscapeSettingsSignature(base);
    for (const [index, channel] of base.channels.entries()) {
      for (const field of Object.keys(SOUNDSCAPE_FIELD_BOUNDS[channel.kind])) {
        const changed = cloneSettings(base);
        const target = changed.channels[index] as unknown as Record<string, number>;
        target[field] = target[field] + 0.5;
        expect(soundscapeSettingsSignature(changed), `${channel.id}.${field}`).not.toBe(signature);
      }
    }
    const soloed = cloneSettings(base);
    soloed.channels[3].solo = true;
    expect(soundscapeSettingsSignature(soloed)).toBe(signature);
    expect(soundscapeSettingsSignature({ ...base, space: { ...base.space, echoes: 0.9 } })).not.toBe(signature);
    expect(soundscapeSettingsSignature({ ...base, weather: { ...base.weather, paceSec: 40 } })).not.toBe(signature);
  });
});

describe('stepping through soundscapes', () => {
  const preferences = sanitizeSoundscapePreferences({});

  it('walks the factory soundscapes in order and wraps, when there are no custom ones', () => {
    let current: SoundscapePreferences = { ...preferences, activePresetId: null };
    const seen = SOUNDSCAPE_FACTORY_PRESETS.map(() => {
      current = applySoundscapePreset(current, nextSoundscapePreset(current));
      return current.activePresetId;
    });
    expect(seen).toEqual(SOUNDSCAPE_FACTORY_PRESETS.map((preset) => preset.id));
    expect(nextSoundscapePreset(current).id).toBe(SOUNDSCAPE_FACTORY_PRESETS[0].id);
  });

  it('turns soundscape on and keeps the soloed channel', () => {
    const soloed = {
      ...preferences,
      settings: { ...preferences.settings, channels: preferences.settings.channels.map((channel) => ({ ...channel, solo: channel.id === 'rain-2' })) },
    };
    const next = applySoundscapePreset(soloed, SOUNDSCAPE_FACTORY_PRESETS[3]);
    expect(next.enabled).toBe(true);
    expect(next.settings.channels.filter((channel) => channel.solo).map((channel) => channel.id)).toEqual(['rain-2']);
  });
});

describe('the fader', () => {
  it('is silent at 0, unity at the top, and even in decibels between', () => {
    expect(soundscapeFaderGain(0)).toBe(0);
    expect(soundscapeFaderGain(1)).toBe(1);
    expect(soundscapeFaderDb(0.5)).toBeCloseTo(-24, 9);
    expect(soundscapeFaderDb(0.75) - soundscapeFaderDb(0.5)).toBeCloseTo(soundscapeFaderDb(0.5) - soundscapeFaderDb(0.25), 9);
  });
});

describe('noise colour and filter', () => {
  it('crossfades the colours at equal power', () => {
    for (let step = 0; step <= 20; step += 1) {
      const weights = noiseColourWeights(step / 20);
      expect(weights.reduce((sum, weight) => sum + (weight * weight), 0)).toBeCloseTo(1, 9);
    }
    expect(noiseColourWeights(0)).toEqual([1, 0, 0]);
    expect(noiseColourWeights(0.5)[1]).toBeCloseTo(1, 9);
    expect(noiseColourWeights(1)[2]).toBeCloseTo(1, 9);
  });

  it('is a Butterworth low-pass unfocused and a unity-peak band focused', () => {
    expect(noiseFilterPower(0, 0)).toBeCloseTo(1, 9);
    expect(noiseFilterPower(1, 0)).toBeCloseTo(0.5, 9);
    expect(noiseFilterPower(1, 1)).toBeCloseTo(1, 9);
    expect(noiseFilterPower(0.01, 1)).toBeLessThan(0.01);
    expect(noiseFilterPower(100, 1)).toBeLessThan(0.01);
  });

  it('gives back more level where the filter takes more away', () => {
    const table = buildNoiseToneTable(1, 0);
    // White noise low-passed: the lower the cutoff, the more is put back.
    for (let index = 1; index < table.length; index += 1) expect(table[index]).toBeLessThanOrEqual(table[index - 1] + 1e-6);
    expect(table.at(-1)).toBeLessThan(1.1);
  });
});

describe('distance', () => {
  it('moves monotonically from direct and bright to quieter, filtered, and in the space', () => {
    let previous = resolveSoundscapeSpace(0);
    for (let step = 1; step <= 10; step += 1) {
      const next = resolveSoundscapeSpace(step / 10);
      expect(next.cutoffHz).toBeLessThan(previous.cutoffHz);
      expect(next.directGain).toBeLessThan(previous.directGain);
      expect(next.reverbSend).toBeGreaterThan(previous.reverbSend);
      previous = next;
    }
  });
});

describe('the configure message', () => {
  it('carries every enabled and disabled channel, and the weather', () => {
    const configuration = toWorkletConfiguration(DEFAULT_SOUNDSCAPE_SETTINGS);
    expect(configuration.channels.map((channel) => channel.id)).toEqual(SOUNDSCAPE_CHANNEL_ROSTER.map((entry) => entry.id));
    expect(configuration.weather).toEqual(DEFAULT_SOUNDSCAPE_SETTINGS.weather);
    for (const channel of configuration.channels) {
      expect(channel.gain).toBeGreaterThanOrEqual(0);
      if (channel.kind !== 'thunder') expect(channel.space).toBeDefined();
    }
  });
});

describe('the space', () => {
  const rate = 16000;
  const energyAfter = (data: Float32Array, fromSec: number) => {
    let energy = 0;
    for (let index = Math.floor(fromSec * rate); index < data.length; index += 1) energy += data[index] * data[index];
    return energy;
  };

  it('decays to about -60 dB at the decay time its size gives', () => {
    for (const size of [0.2, 0.6]) {
      const [left] = buildSoundscapeImpulseResponse({ size, damping: 0, echoes: 0 }, rate);
      const decay = spaceDecaySec(size);
      // Energy in a window at time t, relative to one near the start.
      const window = (atSec: number) => energyAfter(left.subarray(0, Math.floor((atSec + 0.05) * rate)), atSec);
      const drop = 10 * Math.log10(window(decay * 0.5) / window(0.1));
      expect(drop).toBeLessThan(-20);
      expect(drop).toBeGreaterThan(-45);
    }
  });

  it('starts after a pre-delay, and its two sides are unrelated', () => {
    const [left, right] = buildSoundscapeImpulseResponse({ size: 0.8, damping: 0.5, echoes: 0 }, rate);
    expect(left.subarray(0, 32).every((value) => value === 0)).toBe(true);
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let index = 0; index < left.length; index += 1) {
      ab += left[index] * right[index];
      aa += left[index] * left[index];
      bb += right[index] * right[index];
    }
    expect(Math.abs(ab / Math.sqrt(aa * bb))).toBeLessThan(0.1);
  });

  it('darkens its tail with damping', () => {
    const lateBrightness = (damping: number) => {
      const [left] = buildSoundscapeImpulseResponse({ size: 0.6, damping, echoes: 0 }, rate);
      const late = left.subarray(Math.floor(rate * 1.5));
      let diff = 0;
      let total = 0;
      for (let index = 1; index < late.length; index += 1) {
        diff += (late[index] - late[index - 1]) ** 2;
        total += late[index] ** 2;
      }
      return diff / total;
    };
    expect(lateBrightness(1)).toBeLessThan(0.5 * lateBrightness(0));
  });

  it('adds distinct echoes only when asked', () => {
    const [plain] = buildSoundscapeImpulseResponse({ size: 0.5, damping: 0.5, echoes: 0 }, rate);
    const [echoing] = buildSoundscapeImpulseResponse({ size: 0.5, damping: 0.5, echoes: 1 }, rate);
    const peakOf = (data: Float32Array) => data.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    expect(peakOf(echoing)).toBeGreaterThan(3 * peakOf(plain));
  });
});

describe("the noise cycle", () => {
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
    expect(SOUNDSCAPE_BELL_RAMP_NEAREST_SINE).toBeGreaterThan(0.5);
    expect(SOUNDSCAPE_BELL_RAMP_NEAREST_SINE).toBeLessThan(1);
  });
});
