export const AMBIENT_NOISE_TYPES = ['white', 'pink', 'brown'] as const;
export type AmbientNoiseType = (typeof AMBIENT_NOISE_TYPES)[number];

export interface AmbientChannelBaseSettings {
  id: string;
  enabled: boolean;
  solo: boolean;
  volume: number;
}

export interface AmbientNoiseChannelSettings extends AmbientChannelBaseSettings {
  kind: 'noise';
  modulationAmplitude: number;
  modulationPeriodSec: number;
  ramp: number;
  shape: number;
  speedSec: number;
  type: AmbientNoiseType;
  densityPer10Sec: number;
  filter: number;
}

export interface AmbientRainChannelSettings extends AmbientChannelBaseSettings {
  kind: 'rain';
  dropsPerSecond: number;
  distance: number;
  pan: number;
  bassGain: number;
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
  settings: AmbientSettings;
  activePresetId: string | null;
  customPresets: AmbientPreset[];
}

export const MAX_AMBIENT_CHANNELS = 12;
export const AMBIENT_NOISE_CHANNEL_COUNT = 9;
export const AMBIENT_RAIN_CHANNEL_COUNT = MAX_AMBIENT_CHANNELS - AMBIENT_NOISE_CHANNEL_COUNT;
export const AMBIENT_RAIN_FIRST_INDEX = AMBIENT_NOISE_CHANNEL_COUNT;
export const MAX_AMBIENT_CUSTOM_PRESETS = 12;

export const AMBIENT_MODULATION_PERIOD_MIN_SEC = 0.5;
export const AMBIENT_MODULATION_PERIOD_MAX_SEC = 50;
export const AMBIENT_RAMP_MIN = 0.1;
export const AMBIENT_RAMP_MAX = 5;
export const AMBIENT_SHAPE_MIN = 0.1;
export const AMBIENT_SHAPE_MAX = 0.9;
export const AMBIENT_SPEED_MIN_SEC = 0;
export const AMBIENT_SPEED_MAX_SEC = 2;
export const AMBIENT_DENSITY_MIN = 1;
export const AMBIENT_DENSITY_MAX = 100;
export const AMBIENT_RAIN_DENSITY_MIN = 1;
export const AMBIENT_RAIN_DENSITY_MAX = 60;
export const AMBIENT_RAIN_DEFAULT_DENSITY = 24;
export const AMBIENT_RAIN_DEFAULT_PANS = [-0.65, 0, 0.65] as const;

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

function makeDefaultNoiseChannel(
  id: string,
  overrides: Partial<AmbientNoiseChannelSettings> = {},
): AmbientNoiseChannelSettings {
  return {
    id,
    kind: 'noise',
    enabled: true,
    solo: false,
    volume: 0.2,
    modulationAmplitude: 0.25,
    modulationPeriodSec: 30,
    ramp: 1.5,
    shape: 0.5,
    speedSec: 0.4,
    type: 'pink',
    densityPer10Sec: 8,
    filter: 0.5,
    ...overrides,
  };
}

function makeDefaultRainChannel(
  id: string,
  overrides: Partial<AmbientRainChannelSettings> = {},
): AmbientRainChannelSettings {
  return {
    id,
    kind: 'rain',
    enabled: true,
    solo: false,
    volume: 0.2,
    dropsPerSecond: AMBIENT_RAIN_DEFAULT_DENSITY,
    distance: 0.5,
    pan: 0,
    bassGain: 0.55,
    trebleGain: 0.45,
    ...overrides,
  };
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
        pan: AMBIENT_RAIN_DEFAULT_PANS[index - AMBIENT_RAIN_FIRST_INDEX],
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
      modulationPeriodSec: 42 - (texture * 39),
      densityPer10Sec: clamp(Math.round((0.015 + (texture * texture)) * 30), 1, 100),
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
      volume: finiteRange(rawRain.volume, 0, 1, legacyRain.volume),
      dropsPerSecond: Math.round(AMBIENT_RAIN_DENSITY_MIN + (rainTexture * (AMBIENT_RAIN_DENSITY_MAX - AMBIENT_RAIN_DENSITY_MIN))),
      pan: 0,
    }),
  ]);
}

export const DEFAULT_AMBIENT_SETTINGS: AmbientSettings = migrateLegacyAmbientSettings(LEGACY_DEFAULT_SETTINGS);

export function ambientSettingsSignature(settings: AmbientSettings): string {
  return settings.map((channel) => {
    const values = channel.kind === 'rain'
      ? [
        channel.kind,
        channel.enabled,
        channel.volume,
        channel.dropsPerSecond,
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
        channel.modulationPeriodSec,
        channel.ramp,
        channel.shape,
        channel.speedSec,
        channel.type,
        channel.densityPer10Sec,
        channel.filter,
      ];
    return values.map((value) => typeof value === 'number' ? value.toFixed(4) : value).join(':');
  }).join('|');
}

export const DEFAULT_AMBIENT_PREFERENCES: AmbientPreferences = {
  enabled: false,
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

export const AMBIENT_FACTORY_PRESETS: readonly AmbientPreset[] = [
  preset('rain', 'Rain on glass', {
    wind: { volume: 0.04, texture: 0.2 },
    ocean: { volume: 0.04, texture: 0.2 },
    rain: { volume: 0.68, texture: 0.62 },
  }, [
    { enabled: true, volume: 0.32, dropsPerSecond: 18, distance: 0.12, pan: -0.65, bassGain: 0.7, trebleGain: 0.72 },
    { enabled: true, volume: 0.23, dropsPerSecond: 26, distance: 0.55, pan: 0, bassGain: 0.55, trebleGain: 0.52 },
    { enabled: true, volume: 0.16, dropsPerSecond: 36, distance: 0.92, pan: 0.65, bassGain: 0.42, trebleGain: 0.34 },
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
  preset('storm', 'Passing storm', {
    wind: { volume: 0.42, texture: 0.78 },
    ocean: { volume: 0.42, texture: 0.72 },
    rain: { volume: 0.46, texture: 0.82 },
  }, [
    { enabled: true, volume: 0.4, dropsPerSecond: 30, distance: 0.12, pan: -0.65, bassGain: 0.78, trebleGain: 0.64 },
    { enabled: true, volume: 0.32, dropsPerSecond: 42, distance: 0.55, pan: 0, bassGain: 0.62, trebleGain: 0.48 },
    { enabled: true, volume: 0.22, dropsPerSecond: 54, distance: 0.92, pan: 0.65, bassGain: 0.48, trebleGain: 0.32 },
  ]),
  preset('shore', 'Quiet shoreline', {
    wind: { volume: 0.18, texture: 0.28 },
    ocean: { volume: 0.48, texture: 0.38 },
    rain: { volume: 0.05, texture: 0.2 },
  }),
  preset('drone', 'Soft drone', {
    wind: { volume: 0.24, texture: 0.08 },
    ocean: { volume: 0.2, texture: 0.06 },
    rain: { volume: 0.12, texture: 0.08 },
  }),
];

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
      return {
        ...common,
        kind: 'rain' as const,
        dropsPerSecond: Math.round(finiteRange(
          source.dropsPerSecond ?? migratedDensity,
          AMBIENT_RAIN_DENSITY_MIN,
          AMBIENT_RAIN_DENSITY_MAX,
          fallback.dropsPerSecond,
        )),
        distance: finiteUnit(source.distance, fallback.distance),
        pan: finiteRange(
          source.pan,
          -1,
          1,
          AMBIENT_RAIN_DEFAULT_PANS[index - AMBIENT_RAIN_FIRST_INDEX],
        ),
        bassGain: finiteUnit(source.bassGain, fallback.bassGain),
        trebleGain: finiteUnit(source.trebleGain, fallback.trebleGain),
      };
    }
    const fallback = fallbackChannel as AmbientNoiseChannelSettings;
    const rawPeriod = source.mode === 'burst' ? 0 : source.modulationPeriodSec;
    const period = finiteRange(rawPeriod, 0, AMBIENT_MODULATION_PERIOD_MAX_SEC, fallback.modulationPeriodSec);

    return {
      ...common,
      kind: 'noise' as const,
      modulationAmplitude: finiteUnit(source.modulationAmplitude, fallback.modulationAmplitude),
      modulationPeriodSec: period === 0 ? 0 : Math.max(AMBIENT_MODULATION_PERIOD_MIN_SEC, period),
      ramp: finiteRange(source.ramp, AMBIENT_RAMP_MIN, AMBIENT_RAMP_MAX, fallback.ramp),
      shape: finiteRange(source.shape, AMBIENT_SHAPE_MIN, AMBIENT_SHAPE_MAX, fallback.shape),
      speedSec: finiteRange(source.speedSec, AMBIENT_SPEED_MIN_SEC, AMBIENT_SPEED_MAX_SEC, fallback.speedSec),
      type: AMBIENT_NOISE_TYPES.includes(source.type as AmbientNoiseType) ? source.type as AmbientNoiseType : fallback.type,
      densityPer10Sec: Math.round(finiteRange(
        source.densityPer10Sec,
        AMBIENT_DENSITY_MIN,
        AMBIENT_DENSITY_MAX,
        fallback.densityPer10Sec,
      )),
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
    settings: sanitizeAmbientSettings(source.settings),
    activePresetId,
    customPresets,
  };
}