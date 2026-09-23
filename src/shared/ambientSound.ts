export const AMBIENT_LAYER_IDS = ['wind', 'ocean', 'rain'] as const;
export type AmbientLayerId = (typeof AMBIENT_LAYER_IDS)[number];

export interface AmbientLayerSettings {
  volume: number;
  texture: number;
}

export type AmbientSettings = Record<AmbientLayerId, AmbientLayerSettings>;

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

export const MAX_AMBIENT_CUSTOM_PRESETS = 12;

export const DEFAULT_AMBIENT_SETTINGS: AmbientSettings = {
  wind: { volume: 0.22, texture: 0.25 },
  ocean: { volume: 0.24, texture: 0.25 },
  rain: { volume: 0, texture: 0.35 },
};

export function ambientSettingsSignature(settings: AmbientSettings): string {
  return AMBIENT_LAYER_IDS
    .map((layerId) => `${settings[layerId].volume.toFixed(4)}:${settings[layerId].texture.toFixed(4)}`)
    .join('|');
}

export const DEFAULT_AMBIENT_PREFERENCES: AmbientPreferences = {
  enabled: false,
  settings: DEFAULT_AMBIENT_SETTINGS,
  activePresetId: null,
  customPresets: [],
};

function preset(id: string, name: string, settings: AmbientSettings): AmbientPreset {
  return { id, name, settings };
}

export const AMBIENT_FACTORY_PRESETS: readonly AmbientPreset[] = [
  preset('rain', 'Rain on glass', {
    wind: { volume: 0.04, texture: 0.2 },
    ocean: { volume: 0.04, texture: 0.2 },
    rain: { volume: 0.68, texture: 0.62 },
  }),
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
  }),
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
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

export function sanitizeAmbientSettings(input: unknown): AmbientSettings {
  const source = input && typeof input === 'object' ? input as Partial<Record<AmbientLayerId, unknown>> : {};
  return Object.fromEntries(AMBIENT_LAYER_IDS.map((layerId) => {
    const layer = source[layerId] && typeof source[layerId] === 'object'
      ? source[layerId] as Partial<AmbientLayerSettings>
      : {};
    return [layerId, {
      volume: finiteUnit(layer.volume, DEFAULT_AMBIENT_SETTINGS[layerId].volume),
      texture: finiteUnit(layer.texture, DEFAULT_AMBIENT_SETTINGS[layerId].texture),
    }];
  })) as AmbientSettings;
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
      settings: sanitizeAmbientSettings(entry.settings),
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