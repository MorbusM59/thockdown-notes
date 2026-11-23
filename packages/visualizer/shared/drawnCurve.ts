/**
 * A DRAWN CURVE: a smooth path through points the reader places on a plane,
 * the model behind the music's EQ (`musicEqCurve.ts`) and the flashing curve
 * (`flashing.ts`). Pure, and shared with the main process's state sanitizer.
 *
 * THE PLANE (`CurvePlane`) is x 0..xMax by y yMin..yMax, in whatever units the
 * owner chose (semitones by dB for the EQ, a share of one cycle by opacity for
 * flashing). A plane that WRAPS is one period of a repeating curve: its end
 * points are one point seen twice, so they always carry the same y and handle,
 * and the neighbours of either end are found across the seam.
 *
 * POINTS (`CurvePoint`): x, y and a HANDLE (0..handleMax). The first point sits
 * at x = 0 and the last at x = xMax; they can be raised, lowered and given
 * handles, but not moved along x or removed. Points in between keep at least
 * `minGap` from their neighbours, so their order is fixed and two never share
 * an x.
 *
 * THE PATH is a cubic Bezier between each pair of neighbouring points. Each
 * point's two handles point the same way and are equally long, along the slope
 * `handleSlope` gives. A handle's length is set by how far it reaches ALONG X:
 * `handle` times half the gap to the nearer neighbour, so 0 is a corner, 1 a
 * round point, and up to handleMax a flatter plateau. Where two facing handles
 * would together reach past the gap between their points, both are shortened
 * in proportion until they just meet (`curveSegment`), which keeps each
 * segment's control points in x order and so the path a function of x at
 * every setting: one y per x, never a loop.
 */

export interface CurvePoint {
  x: number
  y: number
  /** 0..handleMax: how round the curve is through this point (see the header). */
  handle: number
}

/** In x order, the first at 0 and the last at the plane's xMax. */
export type DrawnCurve = readonly CurvePoint[]

export interface CurvePlane {
  xMax: number
  yMin: number
  yMax: number
  /** The least x between two neighbouring points. */
  minGap: number
  /** The end points included. */
  maxPoints: number
  handleMax: number
  /** Whether the curve is one period of a repeating one (see the header). */
  wrap: boolean
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** A straight line at `y` across the plane. */
export function flatCurve(plane: CurvePlane, y: number): CurvePoint[] {
  return [{ x: 0, y, handle: 0 }, { x: plane.xMax, y, handle: 0 }]
}

/** A wrapping curve's last point is its first seen again: it takes the first's y and handle. */
function closeSeam(plane: CurvePlane, points: CurvePoint[]): CurvePoint[] {
  if (plane.wrap) {
    const last = points[points.length - 1]
    last.y = points[0].y
    last.handle = points[0].handle
  }
  return points
}

/**
 * Any stored value into a valid curve: the ends pinned to the axis, the points
 * between in order, each at least minGap from the last one kept and from the
 * top end, at most maxPoints in all, the seam closed on a wrapping plane.
 * Anything that is not a list of at least two is `fallback`.
 */
export function sanitizeCurve(plane: CurvePlane, value: unknown, fallback: DrawnCurve): CurvePoint[] {
  if (!Array.isArray(value) || value.length < 2) return fallback.map((point) => ({ ...point }))
  const point = (entry: unknown, x: number): CurvePoint => {
    const input = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    return {
      x,
      y: clamp(finite(input.y, 0), plane.yMin, plane.yMax),
      handle: clamp(finite(input.handle, 0), 0, plane.handleMax),
    }
  }
  const first = point(value[0], 0)
  const last = point(value[value.length - 1], plane.xMax)
  const middle: CurvePoint[] = []
  let previous = 0
  for (const entry of value.slice(1, -1)) {
    if (middle.length >= plane.maxPoints - 2) break
    const x = finite((entry as Record<string, unknown> | null)?.x, NaN)
    if (!Number.isFinite(x) || x < previous + plane.minGap || x > plane.xMax - plane.minGap) continue
    middle.push(point(entry, x))
    previous = x
  }
  return closeSeam(plane, [first, ...middle, last])
}

/** Two curves are one when they have the same points, each value agreeing to a thousandth of the plane's units. */
export function sameCurve(a: DrawnCurve, b: DrawnCurve): boolean {
  return a.length === b.length && a.every((point, i) => (
    Math.abs(point.x - b[i].x) < 0.0005
    && Math.abs(point.y - b[i].y) < 0.0005
    && Math.abs(point.handle - b[i].handle) < 0.0005
  ))
}

/**
 * Point `index`'s neighbours, or null where it has none: an end point of a
 * plane that does not wrap. On a wrapping plane the end points' outer
 * neighbours are found across the seam, shifted by a period.
 */
function neighbours(plane: CurvePlane, curve: DrawnCurve, index: number): [CurvePoint | null, CurvePoint | null] {
  const last = curve.length - 1
  const before = index > 0
    ? curve[index - 1]
    : plane.wrap && last > 1 ? { ...curve[last - 1], x: curve[last - 1].x - plane.xMax } : null
  const after = index < last
    ? curve[index + 1]
    : plane.wrap && last > 1 ? { ...curve[1], x: curve[1].x + plane.xMax } : null
  return [before, after]
}

/** How far along x a point's handles reach (see the header). */
function handleReach(plane: CurvePlane, curve: DrawnCurve, index: number): number {
  const { x } = curve[index]
  const [before, after] = neighbours(plane, curve, index)
  const nearer = Math.min(before ? x - before.x : Infinity, after ? after.x - x : Infinity)
  return Number.isFinite(nearer) ? curve[index].handle * 0.5 * nearer : 0
}

/**
 * The slope (y per x) a point's handles lie along.
 *
 * A point with one neighbour (an end of a plane that does not wrap) aims at
 * it. A point that is a peak, a dip or level with a neighbour gets level
 * handles, so the curve turns at the point itself. Between those, the slope is
 * shaped by where the point sits in the rectangle its two neighbours span:
 * - horizontally, the neighbours' rise is taken over twice the gap to the
 *   NEARER neighbour, so a point off-centre steepens; centred, that is
 *   exactly the straight line between the neighbours;
 * - vertically, that slope is scaled by a triangle that is 1 at the
 *   rectangle's vertical middle and falls linearly to 0 at either
 *   neighbour's y, so the handles flatten gradually towards the edges.
 */
function handleSlope(plane: CurvePlane, curve: DrawnCurve, index: number): number {
  const point = curve[index]
  const [prev, next] = neighbours(plane, curve, index)
  if (!prev || !next) {
    const other = prev ?? next
    if (!other) return 0
    const run = other.x - point.x
    return run !== 0 ? (other.y - point.y) / run : 0
  }
  const lo = Math.min(prev.y, next.y)
  const hi = Math.max(prev.y, next.y)
  if (point.y <= lo || point.y >= hi) return 0
  const nearer = Math.min(point.x - prev.x, next.x - point.x)
  const vertical = 1 - Math.abs((2 * (point.y - lo)) / (hi - lo) - 1)
  return ((next.y - prev.y) / (2 * nearer)) * vertical
}

/** Segment `index`'s four control points (from point `index` to the next), as [x, y] pairs. */
export function curveSegment(plane: CurvePlane, curve: DrawnCurve, index: number): [number, number][] {
  const a = curve[index]
  const b = curve[index + 1]
  // Facing handles that would cross are shortened together until they meet.
  const wanted = handleReach(plane, curve, index) + handleReach(plane, curve, index + 1)
  const fit = wanted > b.x - a.x ? (b.x - a.x) / wanted : 1
  const outReach = handleReach(plane, curve, index) * fit
  const inReach = handleReach(plane, curve, index + 1) * fit
  return [
    [a.x, a.y],
    [a.x + outReach, a.y + (handleSlope(plane, curve, index) * outReach)],
    [b.x - inReach, b.y - (handleSlope(plane, curve, index + 1) * inReach)],
    [b.x, b.y],
  ]
}

function bezier(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t
  return (u * u * u * p0) + (3 * u * u * t * p1) + (3 * u * t * t * p2) + (t * t * t * p3)
}

/** The curve's y at `x`, clamped to the plane. */
export function curveYAt(plane: CurvePlane, curve: DrawnCurve, x: number): number {
  let index = 0
  while (index < curve.length - 2 && curve[index + 1].x < x) index += 1
  const [p0, p1, p2, p3] = curveSegment(plane, curve, index)
  // x(t) rises monotonically (the control points are in x order), so bisection finds t.
  let low = 0
  let high = 1
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const mid = (low + high) / 2
    if (bezier(p0[0], p1[0], p2[0], p3[0], mid) < x) low = mid
    else high = mid
  }
  const t = (low + high) / 2
  return clamp(bezier(p0[1], p1[1], p2[1], p3[1], t), plane.yMin, plane.yMax)
}

/** The curve sampled at `count` evenly spaced x from 0 to xMax, both ends included. */
export function sampleCurve(plane: CurvePlane, curve: DrawnCurve, count: number): Float64Array {
  const out = new Float64Array(count)
  for (let i = 0; i < count; i += 1) out[i] = curveYAt(plane, curve, (i / (count - 1)) * plane.xMax)
  return out
}

/** The curve as an SVG path, through `toX`/`toY` from the plane's units. */
export function curvePath(plane: CurvePlane, curve: DrawnCurve, toX: (x: number) => number, toY: (y: number) => number): string {
  let d = `M${toX(curve[0].x)} ${toY(curve[0].y)}`
  for (let index = 0; index < curve.length - 1; index += 1) {
    const [, c1, c2, end] = curveSegment(plane, curve, index)
    d += `C${toX(c1[0])} ${toY(c1[1])} ${toX(c2[0])} ${toY(c2[1])} ${toX(end[0])} ${toY(end[1])}`
  }
  return d
}

// ── Editing ─────────────────────────────────────────────────────────────────
// The editor's operations, pure so their rules hold wherever they are used:
// each returns a valid curve, or the same curve when the edit is not allowed.

export interface CurvePointChange {
  x?: number
  y?: number
  handle?: number
}

/** The range of x a point may move in: fixed for the ends, between its neighbours' gaps otherwise. */
export function curvePointXRange(plane: CurvePlane, curve: DrawnCurve, index: number): [number, number] {
  if (index === 0) return [0, 0]
  if (index === curve.length - 1) return [plane.xMax, plane.xMax]
  return [curve[index - 1].x + plane.minGap, curve[index + 1].x - plane.minGap]
}

/** One point changed, each value clamped to what the point may take; on a wrapping plane an end's change is both ends'. */
export function editCurvePoint(plane: CurvePlane, curve: DrawnCurve, index: number, change: CurvePointChange): CurvePoint[] {
  const next = curve.map((point) => ({ ...point }))
  const point = next[index]
  if (!point) return next
  if (change.x !== undefined && index > 0 && index < curve.length - 1) {
    const [low, high] = curvePointXRange(plane, curve, index)
    point.x = clamp(change.x, low, high)
  }
  if (change.y !== undefined) point.y = clamp(change.y, plane.yMin, plane.yMax)
  if (change.handle !== undefined) point.handle = clamp(change.handle, 0, plane.handleMax)
  if (plane.wrap && index === next.length - 1) {
    next[0].y = point.y
    next[0].handle = point.handle
  }
  return closeSeam(plane, next)
}

/**
 * A new point at `x` and `y`, or null when it cannot go there: the curve is
 * full, or it would sit closer than minGap to a neighbour. Returns the curve
 * and the new point's index.
 */
export function insertCurvePoint(plane: CurvePlane, curve: DrawnCurve, x: number, y: number, handle: number): { curve: CurvePoint[]; index: number } | null {
  if (curve.length >= plane.maxPoints) return null
  const index = curve.findIndex((point) => point.x > x)
  if (index <= 0) return null
  if (x - curve[index - 1].x < plane.minGap) return null
  if (curve[index].x - x < plane.minGap) return null
  const next = curve.map((point) => ({ ...point }))
  next.splice(index, 0, { x, y: clamp(y, plane.yMin, plane.yMax), handle: clamp(handle, 0, plane.handleMax) })
  return { curve: next, index }
}

/** A point halfway (in x, on the step grid) between point `index` and the next one, on the curve; for the last point, between it and the one before. */
export function insertCurvePointAfter(plane: CurvePlane, curve: DrawnCurve, index: number, xStep: number, yStep: number, handle: number): { curve: CurvePoint[]; index: number } | null {
  const from = Math.min(index, curve.length - 2)
  const x = Math.round(((curve[from].x + curve[from + 1].x) / 2) / xStep) * xStep
  const y = Math.round(curveYAt(plane, curve, x) / yStep) * yStep
  return insertCurvePoint(plane, curve, x, y, handle)
}

/** The curve without point `index`; the ends cannot be removed. */
export function removeCurvePoint(curve: DrawnCurve, index: number): CurvePoint[] {
  if (index <= 0 || index >= curve.length - 1) return curve.map((point) => ({ ...point }))
  return curve.filter((_, i) => i !== index).map((point) => ({ ...point }))
}

/**
 * A typed x: unlike a drag, it may land past a neighbour, and the point moves
 * to its place in the order. It stays inside the axis, at least minGap from
 * the ends; an x that close to another point is refused (null). The ends' x
 * are fixed. Returns the curve and the point's new index.
 */
export function setCurvePointX(plane: CurvePlane, curve: DrawnCurve, index: number, x: number): { curve: CurvePoint[]; index: number } | null {
  if (index <= 0 || index >= curve.length - 1 || !Number.isFinite(x)) return null
  const at = clamp(x, plane.minGap, plane.xMax - plane.minGap)
  const point = curve[index]
  return insertCurvePoint(plane, curve.filter((_, i) => i !== index), at, point.y, point.handle)
}
