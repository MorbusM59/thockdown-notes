import { describe, expect, it } from 'vitest'
import {
  PREVIEW_PREWARM_INITIAL_BATCH,
  PREVIEW_PREWARM_MAX_BATCH,
  PREVIEW_PREWARM_MIN_BATCH,
  planNextPrewarmBatch,
  resolveNextPrewarmBatchSize,
} from './previewMeasurementPrewarm'

const measuredSet = (indices: number[]) => {
  const set = new Set(indices)
  return (index: number) => set.has(index)
}

describe('planNextPrewarmBatch', () => {
  it('sweeps downward from the reader before coming back for what is above', () => {
    // The virtualizer compensates scrollTop when a block above the fold
    // changes size, so measuring upward first would move the thumb under the
    // reader's hand. Everything from the cursor down comes first.
    expect(planNextPrewarmBatch({
      blockCount: 10,
      isMeasured: measuredSet([]),
      cursorIndex: 6,
      batchSize: 6,
    })).toEqual([6, 7, 8, 9, 0, 1])
  })

  it('measures in document order on a freshly opened note', () => {
    // The case this feature is really for: reader at the top, so the whole
    // sweep is below the fold and nothing shifts at all.
    expect(planNextPrewarmBatch({
      blockCount: 100,
      isMeasured: measuredSet([]),
      cursorIndex: 0,
      batchSize: 4,
    })).toEqual([0, 1, 2, 3])
  })

  it('skips blocks that already have a real height', () => {
    expect(planNextPrewarmBatch({
      blockCount: 8,
      isMeasured: measuredSet([0, 1, 3, 5]),
      cursorIndex: 0,
      batchSize: 3,
    })).toEqual([2, 4, 6])
  })

  it('returns nothing once every block is measured, so the sweep terminates', () => {
    expect(planNextPrewarmBatch({
      blockCount: 4,
      isMeasured: measuredSet([0, 1, 2, 3]),
      cursorIndex: 2,
      batchSize: 10,
    })).toEqual([])
  })

  it('never visits an index twice, wherever the cursor sits', () => {
    for (const cursorIndex of [0, 1, 5, 9, 42]) {
      const batch = planNextPrewarmBatch({
        blockCount: 10,
        isMeasured: measuredSet([]),
        cursorIndex,
        batchSize: 10,
      })
      expect(new Set(batch).size).toBe(batch.length)
      expect([...batch].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    }
  })

  it('handles an empty document and a nonsense batch size without throwing', () => {
    expect(planNextPrewarmBatch({ blockCount: 0, isMeasured: measuredSet([]), cursorIndex: 0, batchSize: 5 })).toEqual([])
    expect(planNextPrewarmBatch({ blockCount: 5, isMeasured: measuredSet([]), cursorIndex: 0, batchSize: 0 })).toEqual([])
  })
})

describe('resolveNextPrewarmBatchSize', () => {
  it('grows when the slice came in under budget', () => {
    // 10 blocks in 2ms against an 8ms budget -> room for ~40, capped by the
    // no-more-than-2x step.
    expect(resolveNextPrewarmBatchSize(10, 2, 8)).toBe(20)
  })

  it('shrinks when the slice overran, but never by more than half', () => {
    // 10 blocks in 40ms is 5x over an 8ms budget; a single anomalous slice
    // must not collapse the sweep to one block at a time.
    expect(resolveNextPrewarmBatchSize(10, 40, 8)).toBe(5)
  })

  it('steps up gently when the slice was too fast to time', () => {
    expect(resolveNextPrewarmBatchSize(4, 0, 8)).toBe(8)
  })

  it('stays inside its bounds', () => {
    expect(resolveNextPrewarmBatchSize(PREVIEW_PREWARM_MAX_BATCH, 0.01, 8)).toBe(PREVIEW_PREWARM_MAX_BATCH)
    expect(resolveNextPrewarmBatchSize(1, 10000, 8)).toBe(PREVIEW_PREWARM_MIN_BATCH)
  })

  it('falls back to the initial size when handed no previous batch', () => {
    expect(resolveNextPrewarmBatchSize(0, 5, 8)).toBe(PREVIEW_PREWARM_INITIAL_BATCH)
  })
})
