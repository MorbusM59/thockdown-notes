export type GlazeSettings = {
  linearStackCount: number;
  linearOpacity: number;
  linearSeed: number;
  radialCount: number;
  radialOpacity: number;
  radialSeed: number;
  bellyPosition: number;
  bellyShape: number;
  bellyOpacity: number;
};

export const GLAZE_OPACITY_MAX = 0.25;

export const DEFAULT_GLAZE_SETTINGS: GlazeSettings = {
  linearStackCount: 3,
  linearOpacity: 0,
  linearSeed: 132147,
  radialCount: 2,
  radialOpacity: 0,
  radialSeed: 94021,
  bellyPosition: 0.5,
  bellyShape: 0.38,
  bellyOpacity: 0,
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return {};
}

function toFinite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function sanitizeGlazeSettings(input: unknown, fallback: GlazeSettings = DEFAULT_GLAZE_SETTINGS): GlazeSettings {
  const source = toRecord(input);
  return {
    linearStackCount: clamp(Math.round(toFinite(source.linearStackCount, fallback.linearStackCount)), 0, 5),
    linearOpacity: clamp(toFinite(source.linearOpacity, fallback.linearOpacity), 0, GLAZE_OPACITY_MAX),
    linearSeed: clamp(Math.round(toFinite(source.linearSeed, fallback.linearSeed)), 0, 1000000),
    radialCount: clamp(Math.round(toFinite(source.radialCount, fallback.radialCount)), 0, 4),
    radialOpacity: clamp(toFinite(source.radialOpacity, fallback.radialOpacity), 0, GLAZE_OPACITY_MAX),
    radialSeed: clamp(Math.round(toFinite(source.radialSeed, fallback.radialSeed)), 0, 1000000),
    bellyPosition: clamp(toFinite(source.bellyPosition, fallback.bellyPosition), -0.5, 1.5),
    bellyShape: clamp(toFinite(source.bellyShape, fallback.bellyShape), 0, 2),
    bellyOpacity: clamp(toFinite(source.bellyOpacity, fallback.bellyOpacity), 0, GLAZE_OPACITY_MAX),
  };
}