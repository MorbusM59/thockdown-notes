/**
 * Procedural ambient sound: the persisted model, its defaults, the factory
 * soundscapes and the sanitizer every stored value passes through.
 *
 * A soundscape is a fixed row of MAX_AMBIENT_CHANNELS channels. The first
 * AMBIENT_NOISE_CHANNEL_COUNT are noise layers (filtered noise whose level
 * rises and falls in a repeating cycle); the rest are rain layers, each routed to its own output of
 * the AudioWorklet so the engine can give it its own pan, distance filter and
 * reverb send (see src/sound/AmbientSoundEngine.ts). A slot's kind is decided
 * by its POSITION, never stored, so a save can never hold a rain layer in a
 * noise slot.
 *
 * The synthesis itself lives in public/ambient-generator.js, which runs in the
 * audio thread and cannot import from here: the rain surfaces below are named
 * in both places, and ambient-generator.test.ts asserts every surface named
 * here has a profile there.
 */

export const AMBIENT_NOISE_TYPES = ['white', 'pink', 'brown'] as const;
export type AmbientNoiseType = (typeof AMBIENT_NOISE_TYPES)[number];

/**
 * What a rain layer's drops land on. Each is a different impact model, not a
 * different filter over one sound:
 * - `glass`: every drop rings a handful of decaying sinusoidal modes -- a
 *   bright, pitched tick, like hail on glass or on metal pipes.
 * - `street`: a very short band-passed noise click on a hard surface, and on
 *   a share of drops a rising-pitch bubble resonance (the "plip" of a drop
 *   entering standing water).
 * - `forest`: a softer, lower pat on leaves with a small thud underneath and
 *   hardly any bubbles.
 */
export const AMBIENT_RAIN_SURFACES = ['glass', 'street', 'forest'] as const;
export type AmbientRainSurface = (typeof AMBIENT_RAIN_SURFACES)[number];

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
   * buildNoiseCycle). The left half blends a sine into the gentlest bell;
   * the right half sharpens that bell up to the steepest one.
   */
  ramp: number;
  /** Where in the cycle the peak falls, 0-1 (0.5 is centred). */
  shape: number;
  type: AmbientNoiseType;
  filter: number;
}

export interface AmbientRainChannelSettings extends AmbientChannelBaseSettings {
  kind: 'rain';
  surface: AmbientRainSurface;
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
  /** Level of the low component of each impact (resonance or thud). */
  bassGain: number;
  /** Level of the high component of each impact (click, splash, bubble). */
  trebleGain: number;
}

export type AmbientChannelSettings = AmbientNoiseChannelSettings | AmbientRainChannelSettings;
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

export const MAX_AMBIENT_CHANNELS = 12;
export const AMBIENT_NOISE_CHANNEL_COUNT = 9;
export const AMBIENT_RAIN_CHANNEL_COUNT = MAX_AMBIENT_CHANNELS - AMBIENT_NOISE_CHANNEL_COUNT;
export const AMBIENT_RAIN_FIRST_INDEX = AMBIENT_NOISE_CHANNEL_COUNT;
export const MAX_AMBIENT_CUSTOM_PRESETS = 12;

export const AMBIENT_PERIOD_MIN_SEC = 0.5;
export const AMBIENT_PERIOD_MAX_SEC = 50;
/**
 * The bell's own steepness range, which the right half of `ramp` sweeps
 * (smoothCurve.ts's buildBellEnvelope). The left half of `ramp` ends at the
 * gentlest of these.
 */
export const AMBIENT_BELL_RAMP_MIN = 0.1;
export const AMBIENT_BELL_RAMP_MAX = 5;
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
  ramp: 0,
  shape: 0.5,
  type: 'pink',
  filter: 0.5,
};

/** As DEFAULT_NOISE_CHANNEL, for rain layers. Pan defaults per slot instead. */
export const DEFAULT_RAIN_CHANNEL: Readonly<Omit<AmbientRainChannelSettings, 'id'>> = {
  kind: 'rain',
  enabled: true,
  solo: false,
  volume: 0.2,
  surface: 'street',
  dropsPerSecond: AMBIENT_RAIN_DEFAULT_DENSITY,
  wash: 0.5,
  drips: 0.2,
  distance: 0.5,
  pan: 0,
  bassGain: 0.55,
  trebleGain: 0.45,
};

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

function fillAmbientSlots(settings: AmbientSettings): AmbientSettings {
  const slots = [...settings];
  const seenIds = new Set(slots.map((channel) => channel.id));
  while (slots.length < MAX_AMBIENT_CHANNELS) {
    const index = slots.length;
    const candidate = index < AMBIENT_RAIN_FIRST_INDEX
      ? `ambient-layer-${index + 1}`
      : `ambient-rain-${index - AMBIENT_RAIN_FIRST_INDEX + 1}`;
    let id = candidate;
    let duplicateIndex = 1;
    while (seenIds.has(id)) {
      id = `${candidate}-${duplicateIndex}`;
      duplicateIndex += 1;
    }
    seenIds.add(id);
    slots.push(index < AMBIENT_RAIN_FIRST_INDEX
      ? makeDefaultNoiseChannel(id, { enabled: false })
      : makeDefaultRainChannel(id, {
        enabled: false,
        pan: defaultRainPan(index - AMBIENT_RAIN_FIRST_INDEX),
      }));
  }
  return slots;
}

export function createAmbientChannel(id: string): AmbientNoiseChannelSettings {
  return makeDefaultNoiseChannel(id);
}

export function createAmbientRainChannel(id: string): AmbientRainChannelSettings {
  return makeDefaultRainChannel(id);
}

function migrateLegacyAmbientSettings(input: unknown): AmbientSettings {
  const source = input && typeof input === 'object'
    ? input as Partial<Record<LegacyLayerId, unknown>>
    : {};
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
      type: layerId === 'wind' ? 'pink' : 'brown',
    });
  });
  const rawRain = source.rain && typeof source.rain === 'object'
    ? source.rain as Partial<LegacyAmbientSettings['rain']>
    : {};
  const legacyRain = LEGACY_DEFAULT_SETTINGS.rain;
  const rainTexture = finiteRange(rawRain.texture, 0, 1, legacyRain.texture);
  const noiseSlots = Array.from({ length: AMBIENT_NOISE_CHANNEL_COUNT - legacyNoise.length }, (_, index) => (
    makeDefaultNoiseChannel(`ambient-layer-${legacyNoise.length + index + 1}`, { enabled: false })
  ));
  return fillAmbientSlots([
    ...legacyNoise,
    ...noiseSlots,
    makeDefaultRainChannel('rain', {
      surface: 'glass',
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
        channel.bassGain,
        channel.trebleGain,
      ]
      : [
        channel.kind,
        channel.enabled,
        channel.volume,
        channel.modulationAmplitude,
        channel.periodSec,
        channel.ramp,
        channel.shape,
        channel.type,
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
): AmbientPreset {
  const migrated = migrateLegacyAmbientSettings(settings);
  const channels = migrated.map((channel, index) => {
    const rainLayer = rainLayers[index - AMBIENT_RAIN_FIRST_INDEX];
    return channel.kind === 'rain' && rainLayer
      ? { ...channel, ...rainLayer, kind: 'rain' as const }
      : channel;
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
    { enabled: true, surface: 'glass', wash: 0, drips: 0, volume: 0.32, dropsPerSecond: 18, distance: 0.12, pan: -0.65, bassGain: 0.7, trebleGain: 0.72 },
    { enabled: true, surface: 'glass', wash: 0, drips: 0, volume: 0.23, dropsPerSecond: 26, distance: 0.55, pan: 0, bassGain: 0.55, trebleGain: 0.52 },
    { enabled: true, surface: 'glass', wash: 0, drips: 0, volume: 0.16, dropsPerSecond: 36, distance: 0.92, pan: 0.65, bassGain: 0.42, trebleGain: 0.34 },
  ]),
  preset('street', 'Rain on the street', {
    wind: { volume: 0.05, texture: 0.2 },
    ocean: { volume: 0, texture: 0.2 },
    rain: { volume: 0, texture: 0.35 },
  }, [
    { enabled: true, surface: 'street', volume: 0.3, dropsPerSecond: 22, wash: 0.35, drips: 0.35, distance: 0.08, pan: -0.55, bassGain: 0.35, trebleGain: 0.7 },
    { enabled: true, surface: 'street', volume: 0.34, dropsPerSecond: 40, wash: 0.7, drips: 0, distance: 0.45, pan: 0.1, bassGain: 0.4, trebleGain: 0.55 },
    { enabled: true, surface: 'street', volume: 0.26, dropsPerSecond: 60, wash: 0.9, drips: 0, distance: 0.9, pan: 0.6, bassGain: 0.5, trebleGain: 0.4 },
  ]),
  preset('forest', 'Forest rain', {
    wind: { volume: 0.12, texture: 0.35 },
    ocean: { volume: 0, texture: 0.2 },
    rain: { volume: 0, texture: 0.35 },
  }, [
    { enabled: true, surface: 'forest', volume: 0.3, dropsPerSecond: 14, wash: 0.3, drips: 0.55, distance: 0.1, pan: -0.5, bassGain: 0.6, trebleGain: 0.55 },
    { enabled: true, surface: 'forest', volume: 0.32, dropsPerSecond: 32, wash: 0.65, drips: 0.2, distance: 0.5, pan: 0.15, bassGain: 0.5, trebleGain: 0.5 },
    { enabled: true, surface: 'forest', volume: 0.24, dropsPerSecond: 50, wash: 0.85, drips: 0, distance: 0.92, pan: 0.65, bassGain: 0.45, trebleGain: 0.35 },
  ]),
  preset('storm', 'Passing storm', {
    wind: { volume: 0.42, texture: 0.78 },
    ocean: { volume: 0.42, texture: 0.72 },
    rain: { volume: 0.46, texture: 0.82 },
  }, [
    { enabled: true, surface: 'street', volume: 0.46, dropsPerSecond: 44, wash: 0.8, drips: 0.4, distance: 0.12, pan: -0.65, bassGain: 0.6, trebleGain: 0.64 },
    { enabled: true, surface: 'street', volume: 0.42, dropsPerSecond: 60, wash: 1, drips: 0, distance: 0.55, pan: 0, bassGain: 0.55, trebleGain: 0.5 },
    { enabled: true, surface: 'forest', volume: 0.34, dropsPerSecond: 60, wash: 1, drips: 0, distance: 0.92, pan: 0.65, bassGain: 0.5, trebleGain: 0.35 },
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
 * is ramp 0; a burst layer (period 0, or the older `mode: 'burst'`) was a
 * bell lasting `speedSec` with a steepness of `ramp` on the bell's own
 * scale, which is the right half of today's ramp. Its silence between
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
  if (!wasBurst) return { periodSec: source.modulationPeriodSec, ramp: 0 };
  const bellRamp = finiteRange(source.ramp, AMBIENT_BELL_RAMP_MIN, AMBIENT_BELL_RAMP_MAX, AMBIENT_BELL_RAMP_MIN);
  return {
    periodSec: finiteRange(source.speedSec, AMBIENT_PERIOD_MIN_SEC, AMBIENT_PERIOD_MAX_SEC, fallback.periodSec),
    ramp: 0.5 + (0.5 * (bellRamp - AMBIENT_BELL_RAMP_MIN) / (AMBIENT_BELL_RAMP_MAX - AMBIENT_BELL_RAMP_MIN)),
  };
}

function finiteUnit(value: unknown, fallback: number): number {
  return finiteRange(value, 0, 1, fallback);
}

export function sanitizeAmbientSettings(input: unknown): AmbientSettings {
  if (!Array.isArray(input)) return migrateLegacyAmbientSettings(input);
  if (input.length === 0) return DEFAULT_AMBIENT_SETTINGS.map((channel) => ({ ...channel }));

  const seenIds = new Set<string>();
  const rawChannels = input.slice(0, MAX_AMBIENT_CHANNELS);
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
    if (index >= AMBIENT_RAIN_FIRST_INDEX) {
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
        surface: AMBIENT_RAIN_SURFACES.includes(source.surface as AmbientRainSurface)
          ? source.surface as AmbientRainSurface
          : predatesSurfaces ? 'glass' as const : DEFAULT_RAIN_CHANNEL.surface,
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
        bassGain: finiteUnit(source.bassGain, fallback.bassGain),
        trebleGain: finiteUnit(source.trebleGain, fallback.trebleGain),
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
      type: AMBIENT_NOISE_TYPES.includes(source.type as AmbientNoiseType) ? source.type as AmbientNoiseType : fallback.type,
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