// Pure math for placing snapshots along the timeline slider.
//
// This module deliberately knows nothing about pixels, SQLite, or React --
// it only answers "given these snapshot ages, where does each one sit on a
// 0..1 rail". Keeping this separate from retention (SnapshotRetention.ts)
// and from rendering (SnapshotTimelineSlider.tsx) is the whole point: v1
// tangled "what to keep" and "where it goes on screen" together in one
// component, which made both harder to reason about and impossible to unit
// test in isolation.

export const ONE_MINUTE_MS = 60 * 1000
export const ONE_HOUR_MS = 60 * ONE_MINUTE_MS
export const ONE_DAY_MS = 24 * ONE_HOUR_MS

export type SnapshotLike = {
  id: number
  timestamp: string // ISO string, as stored in note_snapshots
  isManual: boolean
}

export type PlacedSnapshot = SnapshotLike & {
  /** 0 = oldest end of the rail, 1 = present. */
  ratio: number
  ageMs: number
}

export type TimelineCurveOptions = {
  /**
   * Higher = recent saves spread out more, older ones compress harder.
   * 1 is linear. v1 shipped with 10 and it's the value being ported
   * forward because it's the one already validated by daily use.
   */
  curvature?: number
  /** Anything this recent always maps to ratio 1 (the present end). */
  presentThresholdMs?: number
}

const DEFAULT_CURVATURE = 10
const DEFAULT_PRESENT_THRESHOLD_MS = ONE_MINUTE_MS

/**
 * Maps a single age (ms) into a 0..1 ratio across a span, using a log-like
 * curve. `spanMs` should be the age of the oldest snapshot being placed --
 * NOT a hardcoded ceiling. Because retention now keeps most auto-history
 * within a ~30 day active window (see SnapshotRetention.ts), the span will
 * usually be small; manual snapshots can still be very old, and the curve
 * degrades gracefully to "very old things all land near 0" rather than v1's
 * hard 1-year cap that made anything beyond it indistinguishable.
 */
export function ageToRatio(
  ageMs: number,
  spanMs: number,
  options: TimelineCurveOptions = {},
): number {
  const curvature = Math.max(1.0001, options.curvature ?? DEFAULT_CURVATURE)
  const presentThresholdMs = Math.max(1, options.presentThresholdMs ?? DEFAULT_PRESENT_THRESHOLD_MS)

  if (ageMs <= presentThresholdMs) return 1
  const safeSpan = Math.max(spanMs, presentThresholdMs + 1)
  if (ageMs >= safeSpan) return 0

  const k = 1 / curvature
  const minK = presentThresholdMs ** k
  const spanK = safeSpan ** k
  const ageK = ageMs ** k

  const denom = spanK - minK
  if (denom <= 0) return 1 // degenerate span (all ages basically equal) -- avoid NaN/Infinity

  const climbed = (ageK - minK) / denom
  return clamp01(1 - climbed)
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * Places every snapshot on the 0..1 rail relative to `now`. Span is derived
 * from the oldest snapshot present, not assumed -- callers get a rail that
 * always uses its full width for whatever history actually survived
 * retention, whether that's three hours or three years.
 */
export function computeSnapshotPlacements(
  snapshots: SnapshotLike[],
  now: number,
  options: TimelineCurveOptions = {},
): PlacedSnapshot[] {
  if (snapshots.length === 0) return []

  const ages = snapshots.map((snap) => Math.max(0, now - new Date(snap.timestamp).getTime()))
  const spanMs = Math.max(ONE_DAY_MS, ...ages)

  return snapshots.map((snap, index) => ({
    ...snap,
    ageMs: ages[index],
    ratio: ageToRatio(ages[index], spanMs, options),
  }))
}

/**
 * Groups placements that round to the same rail position (within
 * `mergeEpsilon`) so overlapping marks can be rendered as a single cluster
 * with a flyout, same idea as v1's column clustering but expressed as a
 * continuous ratio instead of a discrete pixel column.
 */
export function clusterPlacements(
  placements: PlacedSnapshot[],
  mergeEpsilon = 0.012,
): PlacedSnapshot[][] {
  if (placements.length === 0) return []

  const sorted = [...placements].sort((a, b) => b.ratio - a.ratio)
  const clusters: PlacedSnapshot[][] = []

  for (const placement of sorted) {
    const lastCluster = clusters[clusters.length - 1]
    const lastInCluster = lastCluster?.[lastCluster.length - 1]
    if (lastInCluster && lastInCluster.ratio - placement.ratio <= mergeEpsilon) {
      lastCluster.push(placement)
    } else {
      clusters.push([placement])
    }
  }

  return clusters
}
