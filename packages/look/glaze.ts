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
  /**
   * How strongly the glare's stripes converge, as the curvature of their
   * fan: 1 / the vanishing point's distance from the screen's centre, in
   * halves of the screen's longer side. 0 is exactly parallel (the point at
   * infinity), and nothing is singular on the way there (`glazeRayFan`).
   */
  rayCurvature: number;
  /** The direction of the vanishing point from the centre, degrees clockwise from up; parallel stripes run along it. */
  rayAngle: number;
  /** How tightly the stripes (or rays) are stacked: 1 is the pattern's own spacing, 2 twice as tight. */
  rayDensity: number;
};

export const GLAZE_LINEAR_OPACITY_MAX = 0.15;
export const GLAZE_RADIAL_OPACITY_MAX = 0.25;
export const GLAZE_GLOOM_OPACITY_MAX = 0.5;
export const GLAZE_SHEEN_OPACITY_MAX = 0.5;
export const GLAZE_LINEAR_STACK_MAX = 5;
export const GLAZE_RADIAL_COUNT_MAX = 4;
/** Curvature at the top of its range: the vanishing point a twentieth of the screen from its centre. */
export const GLAZE_RAY_CURVATURE_MAX = 10;
export const GLAZE_RAY_DENSITY_MIN = 0.25;
export const GLAZE_RAY_DENSITY_MAX = 4;

/**
 * The glare's stripes on a screen of `vmaxPx` (its longer side), as a fan
 * around a vanishing point at distance 1/k from the centre along `normal`.
 * A pixel p (px from the centre, y down) reads its stack's pattern at
 *
 *   u = density * atan2(w k, 1 - s k) / k,   s = p.normal, w = p.across
 *
 * which is the arc length, at the centre's distance from the point, of the
 * pixel's angle around it: stripes become rays through the point, as wide at
 * the centre as the pattern's own stripes. As k -> 0 it tends to
 * u = density * w, the parallel stripes across `across`, and at k = 0 it is
 * exactly that, so the whole range is continuous and nothing divides by 0.
 * `across` is `normal` turned a quarter counter-clockwise, so u grows
 * clockwise around the point, as a CSS conic gradient's angle does.
 */
export type GlazeRayFan = {
  /** Curvature in 1/px; 0 = parallel. */
  k: number;
  normal: { x: number; y: number };
  across: { x: number; y: number };
  /** CSS angle of `across` (a linear gradient's direction). */
  acrossDeg: number;
  density: number;
};

export function glazeRayFan(settings: GlazeSettings, vmaxPx: number): GlazeRayFan {
  const radians = (settings.rayAngle * Math.PI) / 180;
  const normal = { x: Math.sin(radians), y: -Math.cos(radians) };
  return {
    k: settings.rayCurvature / (vmaxPx / 2),
    normal,
    across: { x: normal.y, y: -normal.x },
    acrossDeg: settings.rayAngle - 90,
    density: settings.rayDensity,
  };
}

/**
 * Pattern px per radian around the point, for a stack of `periodPx`: the
 * fan's density / k, rounded so one turn holds the period a whole number of
 * times (the seam at the far side of the point then falls on a period
 * boundary). Only meaningful when k > 0.
 */
export function glazeRayScale(fan: GlazeRayFan, periodPx: number): number {
  const repeats = Math.max(1, Math.round((2 * Math.PI * fan.density) / (fan.k * periodPx)));
  return (repeats * periodPx) / (2 * Math.PI);
}

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
  rayCurvature: 0,
  // Parallel stripes at this angle run across the CSS 45deg gradient every glaze was drawn with before.
  rayAngle: 135,
  rayDensity: 1,
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
    linearStackCount: clamp(Math.round(toFinite(source.linearStackCount, fallback.linearStackCount)), 0, GLAZE_LINEAR_STACK_MAX),
    linearOpacity: clamp(toFinite(source.linearOpacity, fallback.linearOpacity), 0, GLAZE_LINEAR_OPACITY_MAX),
    linearSeed: clamp(Math.round(toFinite(source.linearSeed, fallback.linearSeed)), 0, 1000000),
    radialCount: clamp(Math.round(toFinite(source.radialCount, fallback.radialCount)), 0, GLAZE_RADIAL_COUNT_MAX),
    radialOpacity: clamp(toFinite(source.radialOpacity, fallback.radialOpacity), 0, GLAZE_RADIAL_OPACITY_MAX),
    radialSeed: clamp(Math.round(toFinite(source.radialSeed, fallback.radialSeed)), 0, 1000000),
    radialAboveLinear: typeof source.radialAboveLinear === 'boolean' ? source.radialAboveLinear : fallback.radialAboveLinear,
    gloomPosition: clamp(toFinite(source.gloomPosition, fallback.gloomPosition), -0.5, 1.5),
    gloomShape: clamp(toFinite(source.gloomShape, fallback.gloomShape), 0, 2),
    gloomOpacity: clamp(toFinite(source.gloomOpacity, fallback.gloomOpacity), 0, GLAZE_GLOOM_OPACITY_MAX),
    sheenPosition: clamp(toFinite(source.sheenPosition, fallback.sheenPosition), -0.5, 1.5),
    sheenShape: clamp(toFinite(source.sheenShape, fallback.sheenShape), 0, 2),
    sheenOpacity: clamp(toFinite(source.sheenOpacity, fallback.sheenOpacity), 0, GLAZE_SHEEN_OPACITY_MAX),
    rayCurvature: clamp(toFinite(source.rayCurvature, fallback.rayCurvature), 0, GLAZE_RAY_CURVATURE_MAX),
    rayAngle: clamp(toFinite(source.rayAngle, fallback.rayAngle), 0, 360),
    rayDensity: clamp(toFinite(source.rayDensity, fallback.rayDensity), GLAZE_RAY_DENSITY_MIN, GLAZE_RAY_DENSITY_MAX),
  };
}
/**
 * The glaze the notes app's visualizer mode sways: the layout's own seeds
 * and shapes, with every linear stack and every radial source on, all at
 * `strength` (the visualizer's own setting, `VisualizerImmersive`), whatever
 * the layout's linear and radial strengths are. Gloom and sheen are not
 * swayed and are left exactly as the layout has them.
 */
export function visualizerGlazeSettings(settings: GlazeSettings, strength: number): GlazeSettings {
  return {
    ...settings,
    linearStackCount: GLAZE_LINEAR_STACK_MAX,
    radialCount: GLAZE_RADIAL_COUNT_MAX,
    linearOpacity: strength,
    radialOpacity: strength,
  };
}
