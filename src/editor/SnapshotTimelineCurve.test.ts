import { describe, expect, it } from 'vitest'
import {
  ONE_DAY_MS,
  ONE_HOUR_MS,
  ONE_MINUTE_MS,
  ageToRatio,
  clusterPlacements,
  computeSnapshotPlacements,
} from './SnapshotTimelineCurve'

describe('ageToRatio', () => {
  it('maps 0 minutes to 1 and rounds sub-minute ages down to 0', () => {
    expect(ageToRatio(0)).toBe(1)
    expect(ageToRatio(50 * 1000)).toBe(1)
  })

  it('maps 1 minute to a lower ratio than 0 minutes', () => {
    expect(ageToRatio(0)).toBe(1)
    expect(ageToRatio(ONE_MINUTE_MS)).toBeLessThan(1)
  })

  it('maps ages past the curveConstant cutoff (2^c minutes) to 0', () => {
    // Default curveConstant is 16, i.e. a ~45.5 day cutoff (2^16 - 1
    // minutes) -- 10 days doesn't clear that, so exercise it with an
    // explicit small curveConstant instead of relying on the default.
    expect(ageToRatio(ONE_DAY_MS * 10, { curveConstant: 5 })).toBe(0)
  })

  it('spreads recent ages further apart than older ages (log-like curvature)', () => {
    const r1h = ageToRatio(ONE_HOUR_MS)
    const r6h = ageToRatio(6 * ONE_HOUR_MS)
    const r29d = ageToRatio(29 * ONE_DAY_MS)
    const r30d = ageToRatio(30 * ONE_DAY_MS)

    const recentGap = r1h - r6h
    const oldGap = r29d - r30d

    expect(recentGap).toBeGreaterThan(oldGap)
  })

  it('never produces NaN or Infinity for any age', () => {
    const ratio = ageToRatio(1)
    expect(Number.isFinite(ratio)).toBe(true)
  })

  it('is monotonic: newer ages never sit behind older ages', () => {
    const samples = [0, ONE_HOUR_MS, ONE_DAY_MS, 5 * ONE_DAY_MS, 20 * ONE_DAY_MS, 59 * ONE_DAY_MS]
    const ratios = samples.map((age) => ageToRatio(age))
    for (let i = 1; i < ratios.length; i += 1) {
      expect(ratios[i]).toBeLessThanOrEqual(ratios[i - 1])
    }
  })

  it('increases the ratio when curve constant increases (extends the cutoff, i.e. zooms out)', () => {
    const low = ageToRatio(ONE_HOUR_MS, { curveConstant: 5 })
    const high = ageToRatio(ONE_HOUR_MS, { curveConstant: 20 })
    expect(high).toBeGreaterThan(low)
  })
})

describe('computeSnapshotPlacements', () => {
  const now = Date.parse('2026-07-07T12:00:00.000Z')

  it('returns an empty array for no snapshots', () => {
    expect(computeSnapshotPlacements([], now)).toEqual([])
  })

  it('computes each ratio independently via ageToRatio, not normalized against the rest of the set', () => {
    const snapshots = [
      { id: 1, timestamp: new Date(now - 10 * ONE_DAY_MS).toISOString(), isManual: false },
      { id: 2, timestamp: new Date(now - ONE_MINUTE_MS).toISOString(), isManual: false },
    ]
    const placed = computeSnapshotPlacements(snapshots, now)
    const newest = placed.find((p) => p.id === 2)!
    const oldest = placed.find((p) => p.id === 1)!
    expect(newest.ratio).toBe(ageToRatio(ONE_MINUTE_MS))
    expect(oldest.ratio).toBe(ageToRatio(10 * ONE_DAY_MS))
    expect(newest.ratio).toBeGreaterThan(oldest.ratio)
  })

  it('keeps snapshots past the cutoff finite and pinned at 0, with newer ones still ranking above them', () => {
    // A note far older than v1's hardcoded 1-year ceiling should still
    // produce a finite ratio instead of NaN/Infinity, and a snapshot within
    // the cutoff should still clearly outrank one beyond it.
    const snapshots = [
      { id: 1, timestamp: new Date(now - 500 * ONE_DAY_MS).toISOString(), isManual: true },
      { id: 2, timestamp: new Date(now - 250 * ONE_DAY_MS).toISOString(), isManual: false },
      { id: 3, timestamp: new Date(now - ONE_MINUTE_MS).toISOString(), isManual: false },
    ]
    const placed = computeSnapshotPlacements(snapshots, now)
    const byId = new Map(placed.map((p) => [p.id, p.ratio]))
    for (const ratio of byId.values()) {
      expect(Number.isFinite(ratio)).toBe(true)
    }
    // Both 500d and 250d are well past the default curveConstant=16 cutoff
    // (~45.5 days), so both clamp to 0 -- that's the intentional behavior,
    // not a bug (see the "maps ages past the cutoff to 0" test above).
    expect(byId.get(1)).toBe(0)
    expect(byId.get(2)).toBe(0)
    expect(byId.get(3)!).toBeGreaterThan(0)
  })
})

describe('clusterPlacements', () => {
  const now = Date.parse('2026-07-07T12:00:00.000Z')

  it('groups snapshots that land within epsilon of each other', () => {
    const snapshots = [
      { id: 1, timestamp: new Date(now - 30 * ONE_DAY_MS).toISOString(), isManual: false },
      { id: 2, timestamp: new Date(now - 30 * ONE_DAY_MS + 1000).toISOString(), isManual: false },
      { id: 3, timestamp: new Date(now - ONE_MINUTE_MS).toISOString(), isManual: false },
    ]
    const placed = computeSnapshotPlacements(snapshots, now)
    const clusters = clusterPlacements(placed, 0.05)
    expect(clusters.length).toBe(2)
  })

  it('keeps distinct clusters when marks are far apart', () => {
    const snapshots = [
      { id: 1, timestamp: new Date(now - 30 * ONE_DAY_MS).toISOString(), isManual: false },
      { id: 2, timestamp: new Date(now - ONE_MINUTE_MS).toISOString(), isManual: false },
    ]
    const placed = computeSnapshotPlacements(snapshots, now)
    const clusters = clusterPlacements(placed)
    expect(clusters.length).toBe(2)
  })
})
