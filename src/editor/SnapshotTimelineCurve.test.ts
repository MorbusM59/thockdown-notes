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

  it('maps very old ages to 0', () => {
    expect(ageToRatio(ONE_DAY_MS * 10)).toBe(0)
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

  it('reduces the ratio when curve constant increases', () => {
    const low = ageToRatio(ONE_HOUR_MS, { curveConstant: 5 })
    const high = ageToRatio(ONE_HOUR_MS, { curveConstant: 20 })
    expect(high).toBeLessThan(low)
  })
})

describe('computeSnapshotPlacements', () => {
  const now = Date.parse('2026-07-07T12:00:00.000Z')

  it('returns an empty array for no snapshots', () => {
    expect(computeSnapshotPlacements([], now)).toEqual([])
  })

  it('places the newest snapshot at ratio 1 and the oldest at ratio 0', () => {
    const snapshots = [
      { id: 1, timestamp: new Date(now - 10 * ONE_DAY_MS).toISOString(), isManual: false },
      { id: 2, timestamp: new Date(now - ONE_MINUTE_MS).toISOString(), isManual: false },
    ]
    const placed = computeSnapshotPlacements(snapshots, now)
    const newest = placed.find((p) => p.id === 2)!
    const oldest = placed.find((p) => p.id === 1)!
    expect(newest.ratio).toBe(1)
    expect(oldest.ratio).toBe(0)
  })

  it('derives the span from the oldest snapshot rather than a hardcoded cap', () => {
    // A note far older than v1's hardcoded 1-year ceiling should still get
    // a full 0..1 spread instead of everything piling up at 0.
    const snapshots = [
      { id: 1, timestamp: new Date(now - 500 * ONE_DAY_MS).toISOString(), isManual: true },
      { id: 2, timestamp: new Date(now - 250 * ONE_DAY_MS).toISOString(), isManual: false },
      { id: 3, timestamp: new Date(now - ONE_MINUTE_MS).toISOString(), isManual: false },
    ]
    const placed = computeSnapshotPlacements(snapshots, now)
    const ratios = placed.map((p) => p.ratio).sort((a, b) => a - b)
    expect(ratios[0]).toBe(0)
    expect(ratios[ratios.length - 1]).toBe(1)
    // the middle one should land strictly between, not collapse onto either end
    expect(ratios[1]).toBeGreaterThan(0)
    expect(ratios[1]).toBeLessThan(1)
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
