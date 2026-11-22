export type GlazeSettings = {
  linearStackCount: number;
  linearOpacity: number;
  /**
   * How the glare's strength is shared among its stacks by depth, -1..1
   * (`glazeLayerShare`): 0 gives every stack all of it, towards -1 the
   * farthest fades out, towards 1 the nearest does.
   */
  linearSpread: number;
  linearSeed: number;
  radialCount: number;
  radialOpacity: number;
  radialSeed: number;
  gloomPosition: number;
  gloomShape: number;
  gloomOpacity: number;
  sheenPosition: number;
  sheenShape: number;
  sheenOpacity: number;
  /**
   * How strongly the glare's stripes converge, 0 to 1: the vanishing point
   * sits at `GLAZE_RAY_NEAREST` x (the centre's distance to the screen's
   * edge in its direction) / this, so 1 is as near as it may come, always
   * off screen, and 0 is exactly parallel (the point at infinity), with
   * nothing singular on the way there (`glazeRayFan`).
   */
  rayCurvature: number;
  /**
   * Where the vanishing point sits round the centre, 0..360: 180 is straight
   * overhead, and either end is straight below, so the slider's middle is up
   * and moving away from it swings the point round either side. The direction
   * it names (degrees clockwise from up) is `glazeRayAngle`; parallel stripes
   * run along it.
   */
  rayPosition: number;
  /** How tightly the stripes (or rays) are stacked: 1 is the pattern's own spacing, 2 twice as tight. */
  rayDensity: number;
};

export const GLAZE_LINEAR_OPACITY_MAX = 0.15;
export const GLAZE_RADIAL_OPACITY_MAX = 0.25;
export const GLAZE_GLOOM_OPACITY_MAX = 0.5;
export const GLAZE_SHEEN_OPACITY_MAX = 0.5;
export const GLAZE_LINEAR_STACK_MAX = 5;
export const GLAZE_RADIAL_COUNT_MAX = 4;
export const GLAZE_RAY_CURVATURE_MAX = 1;
/** The nearest the vanishing point comes, as a multiple of the centre's distance to the screen's edge in its direction. */
export const GLAZE_RAY_NEAREST = 1.2;
export const GLAZE_RAY_DENSITY_MIN = 0.01;
export const GLAZE_RAY_DENSITY_MAX = 2;

/**
 * The glare's stripes on a screen of `widthPx` x `heightPx`, as a fan
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
  /** The screen the fan was sized for. */
  widthPx: number;
  heightPx: number;
};

/**
 * `orbit` is the share of its distance the point may travel round its
 * resting place (`orbitGlazeRayFan`); the resting place is pushed out by it,
 * so the orbit's nearest point keeps the margin along the heading.
 */
/** The vanishing point's direction from the centre, degrees clockwise from up (`rayPosition` 180 is 0, overhead). */
export function glazeRayAngle(settings: GlazeSettings): number {
  return settings.rayPosition - 180;
}

export function glazeRayFan(settings: GlazeSettings, widthPx: number, heightPx: number, orbit = 0): GlazeRayFan {
  const radians = (glazeRayAngle(settings) * Math.PI) / 180;
  const normal = { x: Math.sin(radians), y: -Math.cos(radians) };
  // The centre's distance to the screen's edge along `normal`.
  const edgePx = Math.min(
    Math.abs(normal.x) > 1e-9 ? widthPx / 2 / Math.abs(normal.x) : Infinity,
    Math.abs(normal.y) > 1e-9 ? heightPx / 2 / Math.abs(normal.y) : Infinity,
  );
  return {
    k: (settings.rayCurvature * (1 - orbit)) / (GLAZE_RAY_NEAREST * edgePx),
    normal,
    across: { x: normal.y, y: -normal.x },
    acrossDeg: glazeRayAngle(settings) - 90,
    density: settings.rayDensity,
    widthPx,
    heightPx,
  };
}

/**
 * The fan with its vanishing point moved round its resting place on a circle
 * of `orbit` x its distance from the centre, `offset` (length at most 1) being
 * where on that disc it is now (`poleOrbitOffset`). Written on
 * the point's direction alone (normal + orbit x (cos, sin), then normalised),
 * so it holds as the point goes to infinity: at k = 0 the parallel stripes
 * swing through the same angles, and nothing is singular. `linearScale` is
 * what the parallel path multiplies by, the limit of the turned fan's
 * k'/k, so the two paths agree as k -> 0.
 */
export function orbitGlazeRayFan(fan: GlazeRayFan, orbit: number, offset: { x: number; y: number }): { k: number; normal: { x: number; y: number }; across: { x: number; y: number }; linearScale: number } {
  const x = fan.normal.x + orbit * offset.x;
  const y = fan.normal.y + orbit * offset.y;
  const length = Math.hypot(x, y);
  const normal = { x: x / length, y: y / length };
  return { k: fan.k / length, normal, across: { x: normal.y, y: -normal.x }, linearScale: fan.density / length };
}

/**
 * The vanishing point's path round its resting place: three circles stacked
 * (epicycles), each turning on the one before at twice the rate of the one
 * it rides, radii 1/2, 1/3 and 1/6. At the fastest setting (a turn a bar)
 * that is a bar, half a bar and a beat. The radii sum to 1, so the path stays
 * inside the unit disc and the orbit's margin holds (`glazeRayFan`). `turns`
 * is the largest circle's turns so far.
 */
const ORBIT_EPICYCLES: ReadonlyArray<{ radius: number; rate: number; phase: number }> = [
  { radius: 1 / 2, rate: 1, phase: 0 },
  { radius: 1 / 3, rate: 2, phase: 0 },
  { radius: 1 / 6, rate: 4, phase: 0 },
];

export function poleOrbitOffset(turns: number): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const { radius, rate, phase } of ORBIT_EPICYCLES) {
    const angle = 2 * Math.PI * turns * rate + phase;
    x += radius * Math.cos(angle);
    y += radius * Math.sin(angle);
  }
  return { x, y };
}

/**
 * Pattern px per radian around the point: the fan's density / k, so a ray
 * is as wide at the centre as the parallel stripe. A turn need not hold a
 * whole number of periods: the seam at the atan's +-pi runs from the point
 * directly away from the centre, and with the point outside the screen
 * (`GLAZE_RAY_NEAREST` > 1) and the screen convex around the centre, that
 * ray never crosses it. Only meaningful when k > 0.
 */
export function glazeRayScale(fan: GlazeRayFan): number {
  return fan.density / fan.k;
}

export const DEFAULT_GLAZE_SETTINGS: GlazeSettings = {
  linearStackCount: 3,
  linearOpacity: 0,
  linearSpread: -0.5,
  linearSeed: 132147,
  radialCount: 2,
  radialOpacity: 0,
  radialSeed: 94021,
  gloomPosition: 0.5,
  gloomShape: 0.38,
  gloomOpacity: 0,
  sheenPosition: 0.385,
  sheenShape: 0,
  sheenOpacity: 0,
  rayCurvature: 0,
  // Parallel stripes at this angle run across the CSS 45deg gradient every glaze was drawn with before.
  rayPosition: 135,
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
    linearSpread: clamp(toFinite(source.linearSpread, fallback.linearSpread), -1, 1),
    linearSeed: clamp(Math.round(toFinite(source.linearSeed, fallback.linearSeed)), 0, 1000000),
    radialCount: clamp(Math.round(toFinite(source.radialCount, fallback.radialCount)), 0, GLAZE_RADIAL_COUNT_MAX),
    radialOpacity: clamp(toFinite(source.radialOpacity, fallback.radialOpacity), 0, GLAZE_RADIAL_OPACITY_MAX),
    radialSeed: clamp(Math.round(toFinite(source.radialSeed, fallback.radialSeed)), 0, 1000000),
    gloomPosition: clamp(toFinite(source.gloomPosition, fallback.gloomPosition), -0.5, 1.5),
    gloomShape: clamp(toFinite(source.gloomShape, fallback.gloomShape), 0, 2),
    gloomOpacity: clamp(toFinite(source.gloomOpacity, fallback.gloomOpacity), 0, GLAZE_GLOOM_OPACITY_MAX),
    sheenPosition: clamp(toFinite(source.sheenPosition, fallback.sheenPosition), -0.5, 1.5),
    sheenShape: clamp(toFinite(source.sheenShape, fallback.sheenShape), 0, 2),
    sheenOpacity: clamp(toFinite(source.sheenOpacity, fallback.sheenOpacity), 0, GLAZE_SHEEN_OPACITY_MAX),
    rayCurvature: clamp(toFinite(source.rayCurvature, fallback.rayCurvature), 0, GLAZE_RAY_CURVATURE_MAX),
    rayPosition: clamp(toFinite(source.rayPosition, fallback.rayPosition), 0, 360),
    rayDensity: clamp(toFinite(source.rayDensity, fallback.rayDensity), GLAZE_RAY_DENSITY_MIN, GLAZE_RAY_DENSITY_MAX),
  };
}
/**
 * The glaze the notes app's visualizer mode sways: the layout's own seeds
 * and shapes, at least `glareMinStacks` linear stacks and `flairMinSources`
 * radial sources, and the layout's linear and radial strengths scaled by
 * `glareStrength` and `flairStrength` (the visualizer's own settings,
 * `VisualizerImmersive`), so up to four times the layout's own limits. Gloom and sheen are not
 * swayed and are left exactly as the layout has them.
 */
export function visualizerGlazeSettings(
  settings: GlazeSettings,
  tuning: { glareStrength: number; flairStrength: number; glareMinStacks: number; flairMinSources: number },
): GlazeSettings {
  return {
    ...settings,
    linearStackCount: Math.min(GLAZE_LINEAR_STACK_MAX, Math.max(settings.linearStackCount, tuning.glareMinStacks)),
    radialCount: Math.min(GLAZE_RADIAL_COUNT_MAX, Math.max(settings.radialCount, tuning.flairMinSources)),
    linearOpacity: Math.min(1, settings.linearOpacity * tuning.glareStrength),
    radialOpacity: Math.min(1, settings.radialOpacity * tuning.flairStrength),
  };
}

/**
 * A linear stack's share of the glare strength, from its place in the stack
 * (`position`: 0 the farthest, 1 the nearest) and the spread. At 0 every stack
 * has all of it; towards -1 the share blends to `position` (nothing at the
 * back, all at the front); towards 1 to `1 - position` (the reverse).
 */
export function glazeLayerShare(position: number, spread: number): number {
  const ramp = spread < 0 ? position : 1 - position
  const amount = Math.abs(spread)
  return 1 - amount + amount * ramp
}
