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
   * A larger constant makes the curve compress faster. 10 is the current
   * default. The user will be able to configure this value.
   */
  curveConstant?: number
}

const DEFAULT_CURVE_CONSTANT = 16

/**
 * Maps a single age (ms) into a 0..1 ratio using a minutes-based base-2
 * logarithmic scale.
 *
 * The formula is:
 *   ratio = min((1 - log2(t + 1)) / c, 1)
 * where t = floor(ageMs / ONE_MINUTE_MS) and c = curveConstant.
 */
export function ageToRatio(ageMs: number, options: TimelineCurveOptions = {}): number {
  const curveConstant = Math.max(0.0001, options.curveConstant ?? DEFAULT_CURVE_CONSTANT)
  const minutes = Math.floor(ageMs / ONE_MINUTE_MS)
  const ratio = 1 - (Math.log2(minutes + 1)) / curveConstant
  return clamp01(ratio)
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

  return snapshots.map((snap, index) => ({
    ...snap,
    ageMs: ages[index],
    ratio: ageToRatio(ages[index], options),
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
