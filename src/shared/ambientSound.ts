/**
 * Procedural ambient sound: the persisted model, its defaults, the factory
 * soundscapes and the sanitizer every stored value passes through.
 *
 * A soundscape is a fixed row of MAX_AMBIENT_CHANNELS channels, and what
 * each slot holds is decided by its position (channelKindForSlot): six noise
 * layers (filtered noise whose level rises and falls in a repeating cycle),
 * two of each noise type -- brown, pink, white (AMBIENT_NOISE_SLOT_TYPES) --
 * then three rain layers, then three thunder layers. Rain and thunder follow
 * as groups; the rest are rain layers, each routed to its own output of
 * the AudioWorklet so the engine can give it its own pan, distance filter and
 * reverb send (see src/sound/AmbientSoundEngine.ts). A slot's kind is decided
 * by its POSITION, never stored, so a save can never hold a rain layer in a
 * noise slot -- and likewise a noise layer's type.
 *
 * The synthesis itself lives in public/ambient-generator.js, which runs in the
 * audio thread and cannot import from here: the rain surfaces below are named
 * in both places, and ambient-generator.test.ts asserts every surface named
 * here has a profile there.
 */

import { AMBIENT_BELL_RAMP_MAX, AMBIENT_BELL_RAMP_MIN, noiseRampForBellRamp } from './ambientNoiseCycle';

export const AMBIENT_NOISE_TYPES = ['white', 'pink', 'brown'] as const;
export type AmbientNoiseType = (typeof AMBIENT_NOISE_TYPES)[number];

/**
 * The noise type of each noise slot, by position: slots 1-2 brown (deep and
 * slow: surf, rumble), 3-4 pink (balanced: wind, wash), 5-6 white (bright:
 * hiss, air). Its length is AMBIENT_NOISE_CHANNEL_COUNT.
 */
export const AMBIENT_NOISE_SLOT_TYPES: readonly AmbientNoiseType[] = [
  'brown', 'brown', 'pink', 'pink', 'white', 'white',
];

/** The noise type of the noise slot at `index` (0-based). */
export function noiseTypeForSlot(index: number): AmbientNoiseType {
  return AMBIENT_NOISE_SLOT_TYPES[index] ?? 'pink';
}

/**
 * What a rain layer's drops land on, as one number from 0 (softest) to 1
 * (hardest). Every drop is the same model, and its parameters are blended
 * between three anchors (public/ambient-generator.js's surfaceProfile), each
 * a different kind of impact rather than a different filter over one sound:
 * - forest (0): a soft, low pat on leaves with a small thud underneath and
 *   hardly any bubbles.
 * - street (0.5): a very short band-passed click on a hard surface, and on a
 *   share of drops a rising-pitch bubble resonance (the "plip" of a drop
 *   entering standing water).
 * - glass (1): every drop rings a handful of decaying sinusoidal modes -- a
 *   bright, pitched tick, like hail on glass or on metal pipes.
 * Between them lie surfaces no anchor names -- soil or a wooden deck toward
 * the leaves, a car or tin roof toward the glass -- blended, not modelled.
 */
export const AMBIENT_RAIN_SURFACE_ANCHORS = [
  { name: 'forest', at: 0 },
  { name: 'street', at: 0.5 },
  { name: 'glass', at: 1 },
] as const;
export type AmbientRainSurfaceName = (typeof AMBIENT_RAIN_SURFACE_ANCHORS)[number]['name'];

/** The position of a named anchor on the surface scale. */
export function rainSurfaceAt(name: AmbientRainSurfaceName): number {
  return AMBIENT_RAIN_SURFACE_ANCHORS.find((anchor) => anchor.name === name)!.at;
}

export interface AmbientChannelBaseSettings {
  id: string;
  enabled: boolean;
  solo: boolean;
  volume: number;
}

export interface AmbientNoiseChannelSettings extends AmbientChannelBaseSettings {
  kind: 'noise';
  /** How far (0-1) the level swings around its mean over one cycle. */
  modulationAmplitude: number;
  /** Seconds per cycle of the level's rise and fall. */
  periodSec: number;
  /**
   * The cycle's curve, 0-1 (src/shared/ambientSoundDsp.ts's
   * buildNoiseCycle): a broad plateau at 0, a sine at 0.5, a narrow swell
   * at 1.
   */
  ramp: number;
  /** Where in the cycle the peak falls, 0-1 (0.5 is centred). */
  shape: number;
  /**
   * How much each cycle departs from the last, 0-1: its length, the height
   * of its swell, and a sway that takes the layer to alternate sides of the
   * stereo field, crossing centre at the peak. 0 is a strictly repeating
   * cycle. The worklet's startCycle holds the rule.
   */
  movement: number;
  /**
   * How far away the layer sounds, 0-1 -- darker, less direct, more reverb.
   * The same rule as a rain layer's distance (ambientSoundDsp.ts's
   * resolveAmbientSpace).
   */
  distance: number;
  /**
   * Stereo width, 0-1: 1 is the two sides unrelated, enveloping; 0 is the
   * same on both, a point source -- which the movement sway can then carry
   * across the field. Energy-preserving, so narrowing does not quieten it.
   */
  width: number;
  filter: number;
}

export interface AmbientRainChannelSettings extends AmbientChannelBaseSettings {
  kind: 'rain';
  /** 0 (softest: leaves) to 1 (hardest: glass); see AMBIENT_RAIN_SURFACE_ANCHORS. */
  surface: number;
  /** Individually audible nearby drops per second. */
  dropsPerSecond: number;
  /**
   * Level (0-1) of the dense bed of rain too many and too small to hear one
   * at a time. Individual drops alone at any rate read as dripping; the bed
   * is what makes it read as rain.
   */
  wash: number;
  /**
   * How often (0-1, scaled to AMBIENT_RAIN_DRIPS_MAX_PER_SEC) a large, slow
   * drop falls -- from a gutter, an eave or a branch.
   */
  drips: number;
  distance: number;
  pan: number;
  /**
   * Standing water on the surface, 0 (dry) to 1 (soaked): the share of drops
   * that land in water -- a bright splash, finer spray and the rising "plip"
   * of a trapped bubble -- and how much the water damps the surface's ring.
   */
  wetness: number;
  /**
   * How much the surface itself rings, 0 (dead: only the impact) to 1 (twice
   * as long); 0.5 is the surface as authored.
   */
  resonance: number;
}

/**
 * A thunder layer: one storm cell, pealing now and then. Distance is what
 * shapes each peal (public/ambient-generator.js's startPeal): far thunder is
 * a soft-onset, low, long rolling rumble whose highs the air has absorbed;
 * near thunder opens with a sharp clap and booms before a shorter, fuller roll.
 */
export interface AmbientThunderChannelSettings extends AmbientChannelBaseSettings {
  kind: 'thunder';
  /** Average peals per ten minutes, spaced at random. */
  pealsPer10Min: number;
  /** 0 (near: a sharp clap, then booms) to 1 (far: a low roll). */
  distance: number;
  /** Where the storm is, -1 (left) to 1 (right). */
  pan: number;
  /** How wide a peal rolls across the stereo field around `pan`, 0-1. */
  spread: number;
  /** 0 (a smooth roll, all rumble) to 1 (a cracking cascade of strokes). */
  character: number;
  /** How long a peal's roll lasts, in seconds. */
  lengthSec: number;
}

export type AmbientChannelSettings = AmbientNoiseChannelSettings | AmbientRainChannelSettings | AmbientThunderChannelSettings;
export type AmbientChannelKind = AmbientChannelSettings['kind'];
export type AmbientSettings = AmbientChannelSettings[];

export interface AmbientPreset {
  id: string;
  name: string;
  settings: AmbientSettings;
}

export interface AmbientPreferences {
  enabled: boolean;
  /**
   * Overall ambient level (0-1), applied after the mix of every layer. Like
   * `enabled` it belongs to the listener, not to the soundscape: it is not
   * part of a preset and does not affect which preset reads as selected.
   */
  masterVolume: number;
  settings: AmbientSettings;
  activePresetId: string | null;
  customPresets: AmbientPreset[];
}

export const AMBIENT_NOISE_CHANNEL_COUNT = 6;
export const AMBIENT_RAIN_CHANNEL_COUNT = 3;
export const AMBIENT_THUNDER_CHANNEL_COUNT = 3;
export const AMBIENT_RAIN_FIRST_INDEX = AMBIENT_NOISE_CHANNEL_COUNT;
export const AMBIENT_THUNDER_FIRST_INDEX = AMBIENT_RAIN_FIRST_INDEX + AMBIENT_RAIN_CHANNEL_COUNT;
export const MAX_AMBIENT_CHANNELS = AMBIENT_THUNDER_FIRST_INDEX + AMBIENT_THUNDER_CHANNEL_COUNT;

/** What the slot at `index` holds, by position. */
export function channelKindForSlot(index: number): AmbientChannelKind {
  if (index >= AMBIENT_THUNDER_FIRST_INDEX) return 'thunder';
  if (index >= AMBIENT_RAIN_FIRST_INDEX) return 'rain';
  return 'noise';
}

export const AMBIENT_THUNDER_PEALS_MIN = 0.5;
export const AMBIENT_THUNDER_PEALS_MAX = 20;
export const AMBIENT_THUNDER_LENGTH_MIN_SEC = 4;
export const AMBIENT_THUNDER_LENGTH_MAX_SEC = 30;
export const AMBIENT_THUNDER_DEFAULT_PANS = [-0.5, 0.1, 0.6] as const;
export const MAX_AMBIENT_CUSTOM_PRESETS = 12;

export const AMBIENT_PERIOD_MIN_SEC = 0.5;
export const AMBIENT_PERIOD_MAX_SEC = 50;
export const AMBIENT_SHAPE_MIN = 0.1;
export const AMBIENT_SHAPE_MAX = 0.9;
export const AMBIENT_RAIN_DENSITY_MIN = 1;
export const AMBIENT_RAIN_DENSITY_MAX = 60;
export const AMBIENT_RAIN_DEFAULT_DENSITY = 24;
export const AMBIENT_RAIN_DEFAULT_PANS = [-0.65, 0, 0.65] as const;
export const AMBIENT_RAIN_DRIPS_MAX_PER_SEC = 3;
export const AMBIENT_DEFAULT_MASTER_VOLUME = 1;

const LEGACY_LAYER_IDS = ['wind', 'ocean', 'rain'] as const;
type LegacyLayerId = (typeof LEGACY_LAYER_IDS)[number];
type LegacyAmbientSettings = Record<LegacyLayerId, { volume: number; texture: number }>;

const LEGACY_DEFAULT_SETTINGS: LegacyAmbientSettings = {
  wind: { volume: 0.22, texture: 0.25 },
  ocean: { volume: 0.24, texture: 0.25 },
  rain: { volume: 0, texture: 0.35 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteRange(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, min, max)
    : fallback;
}

/**
 * The value every noise-layer control starts at and resets to. The settings
 * panel's reset-to-default reads these rather than restating them.
 */
export const DEFAULT_NOISE_CHANNEL: Readonly<Omit<AmbientNoiseChannelSettings, 'id'>> = {
  kind: 'noise',
  enabled: true,
  solo: false,
  volume: 0.2,
  modulationAmplitude: 0.25,
  periodSec: 30,
  ramp: 0.5,
  shape: 0.5,
  movement: 0,
  distance: 0,
  width: 1,
  filter: 0.5,
};

/** As DEFAULT_NOISE_CHANNEL, for rain layers. Pan defaults per slot instead. */
export const DEFAULT_RAIN_CHANNEL: Readonly<Omit<AmbientRainChannelSettings, 'id'>> = {
  kind: 'rain',
  enabled: true,
  solo: false,
  volume: 0.2,
  surface: rainSurfaceAt('street'),
  dropsPerSecond: AMBIENT_RAIN_DEFAULT_DENSITY,
  wash: 0.5,
  drips: 0.2,
  distance: 0.5,
  pan: 0,
  wetness: 0.5,
  resonance: 0.5,
};

/** As DEFAULT_NOISE_CHANNEL, for thunder layers. Pan defaults per slot instead. */
export const DEFAULT_THUNDER_CHANNEL: Readonly<Omit<AmbientThunderChannelSettings, 'id'>> = {
  kind: 'thunder',
  enabled: true,
  solo: false,
  volume: 0.4,
  pealsPer10Min: 3,
  distance: 0.7,
  pan: 0,
  spread: 0.5,
  character: 0.6,
  lengthSec: 12,
};

function makeDefaultThunderChannel(
  id: string,
  overrides: Partial<AmbientThunderChannelSettings> = {},
): AmbientThunderChannelSettings {
  return { ...DEFAULT_THUNDER_CHANNEL, id, ...overrides };
}

/** The default pan of the thunder layer at `thunderIndex` (0-based among thunder slots). */
export function defaultThunderPan(thunderIndex: number): number {
  return AMBIENT_THUNDER_DEFAULT_PANS[thunderIndex] ?? 0;
}

function makeDefaultNoiseChannel(
  id: string,
  overrides: Partial<AmbientNoiseChannelSettings> = {},
): AmbientNoiseChannelSettings {
  return { ...DEFAULT_NOISE_CHANNEL, id, ...overrides };
}

function makeDefaultRainChannel(
  id: string,
  overrides: Partial<AmbientRainChannelSettings> = {},
): AmbientRainChannelSettings {
  return { ...DEFAULT_RAIN_CHANNEL, id, ...overrides };
}

/** The default pan of the rain layer at `rainIndex` (0-based among rain slots). */
export function defaultRainPan(rainIndex: number): number {
  return AMBIENT_RAIN_DEFAULT_PANS[rainIndex] ?? 0;
}

/** The empty, disabled channel a slot holds when nothing was saved in it. */
function makeEmptySlot(index: number, id: string): AmbientChannelSettings {
  const kind = channelKindForSlot(index);
  if (kind === 'thunder') {
    return makeDefaultThunderChannel(id, { enabled: false, pan: defaultThunderPan(index - AMBIENT_THUNDER_FIRST_INDEX) });
  }
  if (kind === 'rain') {
    return makeDefaultRainChannel(id, { enabled: false, pan: defaultRainPan(index - AMBIENT_RAIN_FIRST_INDEX) });
  }
  return makeDefaultNoiseChannel(id, { enabled: false });
}

function slotIdPrefix(index: number): string {
  const kind = channelKindForSlot(index);
  if (kind === 'thunder') return `ambient-thunder-${index - AMBIENT_THUNDER_FIRST_INDEX + 1}`;
  if (kind === 'rain') return `ambient-rain-${index - AMBIENT_RAIN_FIRST_INDEX + 1}`;
  return `ambient-layer-${index + 1}`;
}

function fillAmbientSlots(settings: AmbientSettings): AmbientSettings {
  const slots = [...settings];
  const seenIds = new Set(slots.map((channel) => channel.id));
  while (slots.length < MAX_AMBIENT_CHANNELS) {
    const index = slots.length;
    const candidate = slotIdPrefix(index);
    let id = candidate;
    let duplicateIndex = 1;
    while (seenIds.has(id)) {
      id = `${candidate}-${duplicateIndex}`;
      duplicateIndex += 1;
    }
    seenIds.add(id);
    slots.push(makeEmptySlot(index, id));
  }
  return slots;
}

export function createAmbientChannel(id: string): AmbientNoiseChannelSettings {
  return makeDefaultNoiseChannel(id);
}

export function createAmbientRainChannel(id: string): AmbientRainChannelSettings {
  return makeDefaultRainChannel(id);
}

export function createAmbientThunderChannel(id: string): AmbientThunderChannelSettings {
  return makeDefaultThunderChannel(id);
}

function migrateLegacyAmbientSettings(input: unknown): AmbientSettings {
  const source = input && typeof input === 'object'
    ? input as Partial<Record<LegacyLayerId, unknown>>
    : {};
  // Wind was pink noise and ocean brown, so each takes the first slot of
  // its group; every other noise slot starts empty.
  const legacyNoise = LEGACY_LAYER_IDS.slice(0, 2).map((layerId) => {
    const rawLayer = source[layerId] && typeof source[layerId] === 'object'
      ? source[layerId] as Partial<LegacyAmbientSettings[LegacyLayerId]>
      : {};
    const legacy = LEGACY_DEFAULT_SETTINGS[layerId];
    const texture = finiteRange(rawLayer.texture, 0, 1, legacy.texture);
    return makeDefaultNoiseChannel(layerId, {
      volume: finiteRange(rawLayer.volume, 0, 1, legacy.volume),
      modulationAmplitude: texture,
      periodSec: 42 - (texture * 39),
    });
  });
  const legacySlots: Record<number, AmbientNoiseChannelSettings> = {
    [AMBIENT_NOISE_SLOT_TYPES.indexOf('pink')]: legacyNoise[0],
    [AMBIENT_NOISE_SLOT_TYPES.indexOf('brown')]: legacyNoise[1],
  };
  const rawRain = source.rain && typeof source.rain === 'object'
    ? source.rain as Partial<LegacyAmbientSettings['rain']>
    : {};
  const legacyRain = LEGACY_DEFAULT_SETTINGS.rain;
  const rainTexture = finiteRange(rawRain.texture, 0, 1, legacyRain.texture);
  const noiseSlots = Array.from({ length: AMBIENT_NOISE_CHANNEL_COUNT }, (_, index) => (
    legacySlots[index] ?? makeDefaultNoiseChannel(`ambient-layer-${index + 1}`, { enabled: false })
  ));
  return fillAmbientSlots([
    ...noiseSlots,
    makeDefaultRainChannel('rain', {
      surface: rainSurfaceAt('glass'),
      wash: 0,
      drips: 0,
      volume: finiteRange(rawRain.volume, 0, 1, legacyRain.volume),
      dropsPerSecond: Math.round(AMBIENT_RAIN_DENSITY_MIN + (rainTexture * (AMBIENT_RAIN_DENSITY_MAX - AMBIENT_RAIN_DENSITY_MIN))),
      pan: 0,
    }),
  ]);
}

export const DEFAULT_AMBIENT_SETTINGS: AmbientSettings = migrateLegacyAmbientSettings(LEGACY_DEFAULT_SETTINGS);

/**
 * A string that is equal for two soundscapes exactly when they sound the
 * same. Used to tell which preset, if any, the current settings match. It
 * deliberately leaves out `id` and `solo` (a listening aid, not part of the
 * sound), and everything on AmbientPreferences outside `settings`.
 */
export function ambientSettingsSignature(settings: AmbientSettings): string {
  return settings.map((channel) => {
    if (channel.kind === 'thunder') {
      return [
        channel.kind,
        channel.enabled,
        channel.volume,
        channel.pealsPer10Min,
        channel.distance,
        channel.pan,
        channel.spread,
        channel.character,
        channel.lengthSec,
      ].map((value) => typeof value === 'number' ? value.toFixed(4) : value).join(':');
    }
    const values = channel.kind === 'rain'
      ? [
        channel.kind,
        channel.enabled,
        channel.volume,
        channel.surface,
        channel.dropsPerSecond,
        channel.wash,
        channel.drips,
        channel.distance,
        channel.pan,
        channel.wetness,
        channel.resonance,
      ]
      : [
        channel.kind,
        channel.enabled,
        channel.volume,
        channel.modulationAmplitude,
        channel.periodSec,
        channel.ramp,
        channel.shape,
        channel.movement,
        channel.distance,
        channel.width,
        channel.filter,
      ];
    return values.map((value) => typeof value === 'number' ? value.toFixed(4) : value).join(':');
  }).join('|');
}

export const DEFAULT_AMBIENT_PREFERENCES: AmbientPreferences = {
  enabled: false,
  masterVolume: AMBIENT_DEFAULT_MASTER_VOLUME,
  settings: DEFAULT_AMBIENT_SETTINGS.map((channel) => ({ ...channel })),
  activePresetId: null,
  customPresets: [],
};

function preset(
  id: string,
  name: string,
  settings: LegacyAmbientSettings,
  rainLayers: Partial<AmbientRainChannelSettings>[] = [],
  thunderLayers: Partial<AmbientThunderChannelSettings>[] = [],
): AmbientPreset {
  const migrated = migrateLegacyAmbientSettings(settings);
  const channels = migrated.map((channel, index): AmbientChannelSettings => {
    const rainLayer = rainLayers[index - AMBIENT_RAIN_FIRST_INDEX];
    const thunderLayer = thunderLayers[index - AMBIENT_THUNDER_FIRST_INDEX];
    if (channel.kind === 'rain' && rainLayer) return { ...channel, ...rainLayer, kind: 'rain' };
    if (channel.kind === 'thunder' && thunderLayer) return { ...channel, ...thunderLayer, kind: 'thunder' };
    return channel;
  });
  return { id, name, settings: channels };
}

/**
 * The six factory soundscapes. Noise layers are still authored through the
 * three-knob legacy model (wind / ocean / rain volume and texture) and
 * migrated like an old save would be; rain layers are authored directly.
 *
 * "Rain on glass" is the original rain model on its own -- the bright,
 * pitched hail-on-glass sound -- and is kept exactly as it was. The other
 * rain soundscapes are built on the street and forest surfaces.
 */
export const AMBIENT_FACTORY_PRESETS: readonly AmbientPreset[] = [
  preset('rain', 'Rain on glass', {
    wind: { volume: 0.04, texture: 0.2 },
    ocean: { volume: 0.04, texture: 0.2 },
    rain: { volume: 0.68, texture: 0.62 },
  }, [
    { enabled: true, surface: 1, wash: 0, drips: 0, volume: 0.32, dropsPerSecond: 18, distance: 0.12, pan: -0.65, wetness: 0, resonance: 0.5 },
    { enabled: true, surface: 1, wash: 0, drips: 0, volume: 0.23, dropsPerSecond: 26, distance: 0.55, pan: 0, wetness: 0, resonance: 0.5 },
    { enabled: true, surface: 1, wash: 0, drips: 0, volume: 0.16, dropsPerSecond: 36, distance: 0.92, pan: 0.65, wetness: 0, resonance: 0.5 },
  ]),
  preset('street', 'Rain on the street', {
    wind: { volume: 0.05, texture: 0.2 },
    ocean: { volume: 0, texture: 0.2 },
    rain: { volume: 0, texture: 0.35 },
  }, [
    { enabled: true, surface: 0.5, volume: 0.3, dropsPerSecond: 22, wash: 0.35, drips: 0.35, distance: 0.08, pan: -0.55, wetness: 0.6, resonance: 0.4 },
    { enabled: true, surface: 0.5, volume: 0.34, dropsPerSecond: 40, wash: 0.7, drips: 0, distance: 0.45, pan: 0.1, wetness: 0.6, resonance: 0.4 },
    { enabled: true, surface: 0.5, volume: 0.26, dropsPerSecond: 60, wash: 0.9, drips: 0, distance: 0.9, pan: 0.6, wetness: 0.6, resonance: 0.4 },
  ]),
  preset('forest', 'Forest rain', {
    wind: { volume: 0.12, texture: 0.35 },
    ocean: { volume: 0, texture: 0.2 },
    rain: { volume: 0, texture: 0.35 },
  }, [
    { enabled: true, surface: 0, volume: 0.3, dropsPerSecond: 14, wash: 0.3, drips: 0.55, distance: 0.1, pan: -0.5, wetness: 0.1, resonance: 0.35 },
    { enabled: true, surface: 0, volume: 0.32, dropsPerSecond: 32, wash: 0.65, drips: 0.2, distance: 0.5, pan: 0.15, wetness: 0.1, resonance: 0.35 },
    { enabled: true, surface: 0, volume: 0.24, dropsPerSecond: 50, wash: 0.85, drips: 0, distance: 0.92, pan: 0.65, wetness: 0.1, resonance: 0.35 },
  ]),
  preset('storm', 'Passing storm', {
    wind: { volume: 0.42, texture: 0.78 },
    ocean: { volume: 0.42, texture: 0.72 },
    rain: { volume: 0.46, texture: 0.82 },
  }, [
    { enabled: true, surface: 0.5, volume: 0.46, dropsPerSecond: 44, wash: 0.8, drips: 0.4, distance: 0.12, pan: -0.65, wetness: 0.6, resonance: 0.4 },
    { enabled: true, surface: 0.5, volume: 0.42, dropsPerSecond: 60, wash: 1, drips: 0, distance: 0.55, pan: 0, wetness: 0.6, resonance: 0.4 },
    { enabled: true, surface: 0, volume: 0.34, dropsPerSecond: 60, wash: 1, drips: 0, distance: 0.92, pan: 0.65, wetness: 0.1, resonance: 0.35 },
  ], [
    // A storm cell passing close on the left, another rolling far off to the right.
    { enabled: true, volume: 0.5, pealsPer10Min: 4, distance: 0.35, pan: -0.4, spread: 0.6, character: 0.8, lengthSec: 10 },
    { enabled: true, volume: 0.45, pealsPer10Min: 3, distance: 0.9, pan: 0.55, spread: 0.8, character: 0.4, lengthSec: 18 },
  ]),
  preset('ocean', 'Open water', {
    wind: { volume: 0.14, texture: 0.3 },
    ocean: { volume: 0.68, texture: 0.62 },
    rain: { volume: 0, texture: 0.35 },
  }),
  preset('wind', 'Pine wind', {
    wind: { volume: 0.62, texture: 0.65 },
    ocean: { volume: 0, texture: 0.3 },
    rain: { volume: 0.04, texture: 0.25 },
  }),
];

/**
 * A noise layer's period and ramp, reading a layer saved before the two
 * modes were merged in their current terms. That model is recognised by
 * `modulationPeriodSec`: a continuous layer was a sine at that period, which
 * is ramp 0.5; a burst layer (period 0, or the older `mode: 'burst'`) was a
 * bell lasting `speedSec` with a steepness of `ramp` on the bell's own
 * scale, which noiseRampForBellRamp places on today's ramp. Its silence between
 * bursts has no equivalent -- a layer is continuous now -- so the burst's
 * own length becomes the cycle.
 */
function readNoiseCycle(
  source: Record<string, unknown>,
  fallback: AmbientNoiseChannelSettings,
): { periodSec: unknown; ramp: unknown } {
  if (source.periodSec !== undefined || source.modulationPeriodSec === undefined) {
    return { periodSec: source.periodSec, ramp: source.ramp };
  }
  const wasBurst = source.mode === 'burst' || source.modulationPeriodSec === 0;
  if (!wasBurst) return { periodSec: source.modulationPeriodSec, ramp: 0.5 };
  const bellRamp = finiteRange(source.ramp, AMBIENT_BELL_RAMP_MIN, AMBIENT_BELL_RAMP_MAX, AMBIENT_BELL_RAMP_MIN);
  return {
    periodSec: finiteRange(source.speedSec, AMBIENT_PERIOD_MIN_SEC, AMBIENT_PERIOD_MAX_SEC, fallback.periodSec),
    ramp: noiseRampForBellRamp(bellRamp),
  };
}

/**
 * Bring a saved slot row into the current layout (channelKindForSlot).
 *
 * The layout before thunder was nine noise slots then three rain slots, and
 * before that each noise layer stored its own `type`. Either is recognised --
 * a rain layer (a `kind` of 'rain', or rain fields) at slot 10, or a `type`
 * on any noise layer -- and rebuilt: each old noise layer's type is its
 * stored `type`, else what its old slot was (brown 1-3, pink 4-6, white 7-9);
 * it goes to a free slot of its own type's group, enabled layers first in
 * slot order, so a group that now has fewer slots keeps the layers that were
 * playing. A layer that finds no slot of its type is dropped rather than
 * forced into another type's slot, where it would sound like something else.
 * The old rain layers move to the rain slots; the thunder slots start empty.
 * A row already in the current layout is returned as it is.
 */
const PRE_THUNDER_NOISE_COUNT = 9;
const PRE_THUNDER_SLOT_TYPES: readonly AmbientNoiseType[] = [
  'brown', 'brown', 'brown', 'pink', 'pink', 'pink', 'white', 'white', 'white',
];

function migrateSlotLayout(raw: unknown[]): unknown[] {
  const field = (item: unknown, name: string) => (
    item && typeof item === 'object' ? (item as Record<string, unknown>)[name] : undefined
  );
  const slotNine = raw[PRE_THUNDER_NOISE_COUNT];
  // A stored `type` predates grouping, which predates thunder, so a row
  // carrying one is in the nine-noise layout too.
  const preThunder = field(slotNine, 'kind') === 'rain'
    || (field(slotNine, 'kind') === undefined && (field(slotNine, 'dropsPerSecond') !== undefined || field(slotNine, 'surface') !== undefined))
    || raw.slice(0, PRE_THUNDER_NOISE_COUNT).some((item) => field(item, 'type') !== undefined);
  if (!preThunder) return raw;

  const oldNoiseCount = PRE_THUNDER_NOISE_COUNT;
  const oldSlotTypes = PRE_THUNDER_SLOT_TYPES;
  const layers = raw.slice(0, oldNoiseCount).map((item, index) => {
    const saved = field(item, 'type');
    return {
      item,
      type: AMBIENT_NOISE_TYPES.includes(saved as AmbientNoiseType) ? saved as AmbientNoiseType : oldSlotTypes[index] ?? 'pink',
      enabled: field(item, 'enabled') !== false,
    };
  });
  const slots: unknown[] = Array.from({ length: AMBIENT_NOISE_CHANNEL_COUNT }, () => undefined);
  for (const layer of [...layers.filter((entry) => entry.enabled), ...layers.filter((entry) => !entry.enabled)]) {
    const free = AMBIENT_NOISE_SLOT_TYPES.findIndex((type, index) => type === layer.type && slots[index] === undefined);
    if (free >= 0) slots[free] = layer.item;
  }
  const rest = raw.slice(PRE_THUNDER_NOISE_COUNT, PRE_THUNDER_NOISE_COUNT + AMBIENT_RAIN_CHANNEL_COUNT);
  return [...slots.map((item) => item ?? { enabled: false }), ...rest];
}

/**
 * Reading a rain layer saved before wetness and resonance existed, when its
 * standing water was part of the surface and its ring was the "bass" level:
 * - wetness is the puddle share the surface itself carried then -- 4% of
 *   drops at the forest, 30% at the street, none at the glass, blended
 *   linearly between -- as a share of what wetness 1 sends into water now;
 * - resonance is the old bass level relative to its default of 0.55, which
 *   is resonance 0.5 (the surface as authored).
 * The old treble level has no counterpart: the balance of a drop's parts is
 * part of the surface now.
 */
const LEGACY_DEFAULT_BASS_GAIN = 0.55;
const LEGACY_PUDDLE_SHARE = { forest: 0.04, street: 0.3, glass: 0 } as const;
/**
 * The share of drops that land in water at wetness 1. Mirrors
 * WET_BUBBLE_CHANCE in public/ambient-generator.js, which ambient-generator
 * test holds it to.
 */
export const AMBIENT_WET_BUBBLE_CHANCE = 0.7;

function legacyWetnessAt(surface: number): number {
  const street = rainSurfaceAt('street');
  const share = surface <= street
    ? LEGACY_PUDDLE_SHARE.forest + ((LEGACY_PUDDLE_SHARE.street - LEGACY_PUDDLE_SHARE.forest) * (surface / street))
    : LEGACY_PUDDLE_SHARE.street + ((LEGACY_PUDDLE_SHARE.glass - LEGACY_PUDDLE_SHARE.street) * ((surface - street) / (1 - street)));
  return share / AMBIENT_WET_BUBBLE_CHANCE;
}

/**
 * A saved surface: a number is read as is; a name (from before the surface
 * became a scale) as its anchor's position; nothing at all as glass, which
 * is the only rain there was before surfaces existed.
 */
function readRainSurface(value: unknown, predatesSurfaces: boolean): number {
  if (predatesSurfaces) return rainSurfaceAt('glass');
  if (typeof value === 'string') {
    const anchor = AMBIENT_RAIN_SURFACE_ANCHORS.find((candidate) => candidate.name === value);
    return anchor ? anchor.at : DEFAULT_RAIN_CHANNEL.surface;
  }
  return finiteUnit(value, DEFAULT_RAIN_CHANNEL.surface);
}

function finiteUnit(value: unknown, fallback: number): number {
  return finiteRange(value, 0, 1, fallback);
}

export function sanitizeAmbientSettings(input: unknown): AmbientSettings {
  if (!Array.isArray(input)) return migrateLegacyAmbientSettings(input);
  if (input.length === 0) return DEFAULT_AMBIENT_SETTINGS.map((channel) => ({ ...channel }));

  const seenIds = new Set<string>();
  const rawChannels = migrateSlotLayout(input).slice(0, MAX_AMBIENT_CHANNELS);
  const soloIndex = rawChannels.findIndex((item) => (
    item !== null && typeof item === 'object' && (item as { solo?: unknown }).solo === true
  ));
  const channels = rawChannels.map((item, index) => {
    const source = item && typeof item === 'object'
      ? item as Record<string, unknown>
      : {};
    const fallbackChannel = DEFAULT_AMBIENT_SETTINGS[index];
    const candidateId = typeof source.id === 'string' && source.id.trim()
      ? source.id.trim().slice(0, 80)
      : `ambient-layer-${index + 1}`;
    let id = candidateId;
    let duplicateIndex = 1;
    while (seenIds.has(id)) {
      id = `${candidateId}-${duplicateIndex}`;
      duplicateIndex += 1;
    }
    seenIds.add(id);
    const common = {
      id,
      enabled: source.enabled !== false,
      solo: index === soloIndex,
      volume: finiteUnit(source.volume, fallbackChannel.volume),
    };
    const kind = channelKindForSlot(index);
    if (kind === 'thunder') {
      return {
        ...common,
        volume: finiteUnit(source.volume, DEFAULT_THUNDER_CHANNEL.volume),
        kind: 'thunder' as const,
        pealsPer10Min: finiteRange(source.pealsPer10Min, AMBIENT_THUNDER_PEALS_MIN, AMBIENT_THUNDER_PEALS_MAX, DEFAULT_THUNDER_CHANNEL.pealsPer10Min),
        distance: finiteUnit(source.distance, DEFAULT_THUNDER_CHANNEL.distance),
        pan: finiteRange(source.pan, -1, 1, defaultThunderPan(index - AMBIENT_THUNDER_FIRST_INDEX)),
        spread: finiteUnit(source.spread, DEFAULT_THUNDER_CHANNEL.spread),
        character: finiteUnit(source.character, DEFAULT_THUNDER_CHANNEL.character),
        lengthSec: finiteRange(source.lengthSec, AMBIENT_THUNDER_LENGTH_MIN_SEC, AMBIENT_THUNDER_LENGTH_MAX_SEC, DEFAULT_THUNDER_CHANNEL.lengthSec),
      };
    }
    if (kind === 'rain') {
      const fallback = fallbackChannel as AmbientRainChannelSettings;
      const migratedDensity = typeof source.densityPer10Sec === 'number'
        ? source.densityPer10Sec / 10
        : fallback.dropsPerSecond;
      // A rain layer saved before surfaces existed was the glass model with
      // no bed and no drips; reading it back that way keeps it sounding as
      // it did rather than silently turning it into street rain.
      const predatesSurfaces = source.surface === undefined;
      return {
        ...common,
        kind: 'rain' as const,
        surface: readRainSurface(source.surface, predatesSurfaces),
        wash: finiteUnit(source.wash, predatesSurfaces ? 0 : DEFAULT_RAIN_CHANNEL.wash),
        drips: finiteUnit(source.drips, predatesSurfaces ? 0 : DEFAULT_RAIN_CHANNEL.drips),
        dropsPerSecond: Math.round(finiteRange(
          source.dropsPerSecond ?? migratedDensity,
          AMBIENT_RAIN_DENSITY_MIN,
          AMBIENT_RAIN_DENSITY_MAX,
          fallback.dropsPerSecond,
        )),
        distance: finiteUnit(source.distance, fallback.distance),
        pan: finiteRange(source.pan, -1, 1, defaultRainPan(index - AMBIENT_RAIN_FIRST_INDEX)),
        wetness: finiteUnit(source.wetness, legacyWetnessAt(readRainSurface(source.surface, predatesSurfaces))),
        resonance: finiteUnit(
          source.resonance,
          typeof source.bassGain === 'number' ? source.bassGain / LEGACY_DEFAULT_BASS_GAIN / 2 : DEFAULT_RAIN_CHANNEL.resonance,
        ),
      };
    }
    const fallback = fallbackChannel as AmbientNoiseChannelSettings;
    const cycle = readNoiseCycle(source, fallback);
    return {
      ...common,
      kind: 'noise' as const,
      modulationAmplitude: finiteUnit(source.modulationAmplitude, fallback.modulationAmplitude),
      periodSec: finiteRange(cycle.periodSec, AMBIENT_PERIOD_MIN_SEC, AMBIENT_PERIOD_MAX_SEC, fallback.periodSec),
      ramp: finiteUnit(cycle.ramp, fallback.ramp),
      shape: finiteRange(source.shape, AMBIENT_SHAPE_MIN, AMBIENT_SHAPE_MAX, fallback.shape),
      movement: finiteUnit(source.movement, 0),
      distance: finiteUnit(source.distance, DEFAULT_NOISE_CHANNEL.distance),
      width: finiteUnit(source.width, DEFAULT_NOISE_CHANNEL.width),
      filter: finiteUnit(source.filter, fallback.filter),
    };
  });
  return fillAmbientSlots(channels);
}

export function sanitizeAmbientPreferences(input: unknown): AmbientPreferences {
  const source = input && typeof input === 'object' ? input as Partial<AmbientPreferences> : {};
  const rawCustom = Array.isArray(source.customPresets) ? source.customPresets : [];
  const seenIds = new Set<string>();
  const customPresets = rawCustom.slice(0, MAX_AMBIENT_CUSTOM_PRESETS).flatMap((item): AmbientPreset[] => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as Partial<AmbientPreset>;
    if (typeof entry.id !== 'string' || !entry.id || seenIds.has(entry.id)) return [];
    if (typeof entry.name !== 'string' || !entry.name.trim()) return [];
    seenIds.add(entry.id);
    return [{
      id: entry.id.slice(0, 80),
      name: entry.name.trim().slice(0, 40),
      settings: sanitizeAmbientSettings(entry.settings).map((channel) => ({ ...channel, solo: false })),
    }];
  });
  const activePresetId = typeof source.activePresetId === 'string'
    && (AMBIENT_FACTORY_PRESETS.some((item) => item.id === source.activePresetId)
      || customPresets.some((item) => item.id === source.activePresetId))
    ? source.activePresetId
    : null;

  return {
    enabled: source.enabled === true,
    masterVolume: finiteUnit(source.masterVolume, AMBIENT_DEFAULT_MASTER_VOLUME),
    settings: sanitizeAmbientSettings(source.settings),
    activePresetId,
    customPresets,
  };
}
/**
 * Switch to a soundscape: its settings, ambient sound turned on, and the
 * preset marked active. Solo is a listening aid rather than part of the
 * sound, so whichever slot was soloed stays soloed. The one way a preset is
 * applied, whether from the settings panel or the player's switch.
 */
export function applyAmbientPreset(preferences: AmbientPreferences, preset: AmbientPreset): AmbientPreferences {
  const soloIndex = preferences.settings.findIndex((channel) => channel.solo);
  return {
    ...preferences,
    enabled: true,
    settings: preset.settings.map((channel, index) => ({ ...channel, solo: index === soloIndex })),
    activePresetId: preset.id,
  };
}

/**
 * The soundscape after the active one, for stepping through them from the
 * player: the user's own if there are any, otherwise the factory ones, in
 * the order the settings panel shows them, wrapping at the end. From a
 * soundscape outside that list -- none active, or a factory one while
 * custom ones exist -- it starts at the first.
 */
export function nextAmbientPreset(preferences: AmbientPreferences): AmbientPreset {
  const cycle = preferences.customPresets.length > 0 ? preferences.customPresets : AMBIENT_FACTORY_PRESETS;
  const current = cycle.findIndex((preset) => preset.id === preferences.activePresetId);
  return cycle[(current + 1) % cycle.length];
}
