import { describe, expect, it } from 'vitest'
import {
  PREVIEW_PREWARM_INITIAL_BATCH,
  PREVIEW_PREWARM_MAX_BATCH,
  PREVIEW_PREWARM_MIN_BATCH,
  resolveNextPrewarmBatchSize,
} from './previewMeasurementPrewarm'

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

describe('resolveNextPrewarmBatchSize with a known fixed cost', () => {
  it('stretches the budget when overhead alone would eat it', () => {
    // Slow hardware: a slice costs 70ms before it measures anything, against a
    // 32ms budget. Holding the budget would pin the batch at the floor and
    // spend every slice on overhead -- measured as 11.9s to calibrate 160
    // blocks at 6x CPU throttle.
    expect(resolveNextPrewarmBatchSize(6, 80, 32, 70)).toBeGreaterThan(6)
  })

  it('does not stretch when the fixed cost already fits the budget', () => {
    // 10 blocks in 20ms with 8ms of overhead: 1.2ms a block, so ~20 fit the
    // 32ms budget -- the same answer the no-fixed-cost form gives.
    expect(resolveNextPrewarmBatchSize(10, 20, 32, 8)).toBe(20)
  })

  it('never lets a slice exceed the hard ceiling', () => {
    // Absurd overhead: the batch may grow, but not on the strength of a
    // budget that would hold the main thread for a second.
    const batch = resolveNextPrewarmBatchSize(4, 900, 32, 880)
    expect(batch).toBeLessThanOrEqual(PREVIEW_PREWARM_MAX_BATCH)
    expect(batch).toBeGreaterThanOrEqual(PREVIEW_PREWARM_MIN_BATCH)
  })

  it('behaves as before when nothing is known about the fixed cost', () => {
    expect(resolveNextPrewarmBatchSize(10, 2, 8, 0)).toBe(20)
    expect(resolveNextPrewarmBatchSize(10, 40, 8, 0)).toBe(5)
  })
})
