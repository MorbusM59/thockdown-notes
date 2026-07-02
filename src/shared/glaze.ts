export type GlazeSettings = {
  linearStackCount: number;
  linearOpacity: number;
  linearSeed: number;
  radialCount: number;
  radialOpacity: number;
  radialSeed: number;
  radialAboveLinear: boolean;
  gloomPosition: number;
  gloomShape: number;
  gloomOpacity: number;
  sheenPosition: number;
  sheenShape: number;
  sheenOpacity: number;
};

export const GLAZE_LINEAR_OPACITY_MAX = 0.15;
export const GLAZE_RADIAL_OPACITY_MAX = 0.25;
export const GLAZE_GLOOM_OPACITY_MAX = 0.5;
export const GLAZE_SHEEN_OPACITY_MAX = 0.5;

export const DEFAULT_GLAZE_SETTINGS: GlazeSettings = {
  linearStackCount: 3,
  linearOpacity: 0,
  linearSeed: 132147,
  radialCount: 2,
  radialOpacity: 0,
  radialSeed: 94021,
  radialAboveLinear: false,
  gloomPosition: 0.5,
  gloomShape: 0.38,
  gloomOpacity: 0,
  sheenPosition: 0.385,
  sheenShape: 0,
  sheenOpacity: 0,
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
    linearOpacity: clamp(toFinite(source.linearOpacity, fallback.linearOpacity), 0, GLAZE_LINEAR_OPACITY_MAX),
    linearSeed: clamp(Math.round(toFinite(source.linearSeed, fallback.linearSeed)), 0, 1000000),
    radialCount: clamp(Math.round(toFinite(source.radialCount, fallback.radialCount)), 0, 4),
    radialOpacity: clamp(toFinite(source.radialOpacity, fallback.radialOpacity), 0, GLAZE_RADIAL_OPACITY_MAX),
    radialSeed: clamp(Math.round(toFinite(source.radialSeed, fallback.radialSeed)), 0, 1000000),
    radialAboveLinear: typeof source.radialAboveLinear === 'boolean' ? source.radialAboveLinear : fallback.radialAboveLinear,
    gloomPosition: clamp(toFinite(source.gloomPosition, fallback.gloomPosition), -0.5, 1.5),
    gloomShape: clamp(toFinite(source.gloomShape, fallback.gloomShape), 0, 2),
    gloomOpacity: clamp(toFinite(source.gloomOpacity, fallback.gloomOpacity), 0, GLAZE_GLOOM_OPACITY_MAX),
    sheenPosition: clamp(toFinite(source.sheenPosition, fallback.sheenPosition), -0.5, 1.5),
    sheenShape: clamp(toFinite(source.sheenShape, fallback.sheenShape), 0, 2),
    sheenOpacity: clamp(toFinite(source.sheenOpacity, fallback.sheenOpacity), 0, GLAZE_SHEEN_OPACITY_MAX),
  };
}