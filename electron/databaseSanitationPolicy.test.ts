import { describe, expect, it } from 'vitest'
import {
  shouldVacuumForBloat,
  VACUUM_FREELIST_RATIO_THRESHOLD,
  VACUUM_MIN_RECLAIMABLE_BYTES,
} from './databaseSanitationPolicy'

const PAGE_SIZE = 4096

describe('shouldVacuumForBloat', () => {
  it('returns false for a freshly-created database (no pages, no freelist)', () => {
    expect(shouldVacuumForBloat({ pageCount: 0, freelistCount: 0, pageSizeBytes: PAGE_SIZE })).toBe(false)
  })

  it('returns false for a healthy database with no freelist at all', () => {
    expect(shouldVacuumForBloat({ pageCount: 10_000, freelistCount: 0, pageSizeBytes: PAGE_SIZE })).toBe(false)
  })

  it('returns false when the ratio is high but the absolute reclaimable size is trivial', () => {
    // 8 of 10 pages free (80% ratio) but that's only 32KB -- not worth a VACUUM.
    expect(shouldVacuumForBloat({ pageCount: 10, freelistCount: 8, pageSizeBytes: PAGE_SIZE })).toBe(false)
  })

  it('returns false when the absolute size is large but the ratio is low (big but proportionally tidy)', () => {
    // 50,000 free pages (~195MB) out of 5,000,000 total is only a 1% ratio.
    expect(shouldVacuumForBloat({ pageCount: 5_000_000, freelistCount: 50_000, pageSizeBytes: PAGE_SIZE })).toBe(false)
  })

  it('returns true when both the ratio and absolute size clear their thresholds', () => {
    // Mirrors the real bug found live: ~71% freelist ratio on a ~300MB db.
    expect(shouldVacuumForBloat({ pageCount: 76_253, freelistCount: 54_481, pageSizeBytes: PAGE_SIZE })).toBe(true)
  })

  it('is exact at the threshold boundaries', () => {
    // Ratio exactly at the threshold (not strictly greater) should not trigger.
    const pageCount = 1000
    const freelistCountAtThreshold = Math.floor(pageCount * VACUUM_FREELIST_RATIO_THRESHOLD)
    const bigPageSize = Math.ceil((VACUUM_MIN_RECLAIMABLE_BYTES * 2) / freelistCountAtThreshold)
    expect(shouldVacuumForBloat({ pageCount, freelistCount: freelistCountAtThreshold, pageSizeBytes: bigPageSize })).toBe(false)

    // One more free page pushes the ratio just over the threshold.
    expect(shouldVacuumForBloat({ pageCount, freelistCount: freelistCountAtThreshold + 1, pageSizeBytes: bigPageSize })).toBe(true)
  })
})
