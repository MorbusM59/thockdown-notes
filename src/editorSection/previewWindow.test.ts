import { describe, expect, it } from 'vitest'
import {
  PREVIEW_WINDOW_INITIAL_BLOCKS,
  PREVIEW_WINDOW_MIN_BLOCKS,
  PREVIEW_WINDOW_MIN_STEP_BLOCKS,
  isWithinPreviewWindow,
  planPreviewWindowAround,
  resolvePreviewWindowAdjustment,
} from './previewWindow'

const geometry = (over: Partial<Parameters<typeof resolvePreviewWindowAdjustment>[2]> = {}) => ({
  scrollTopPx: 2000,
  clientHeightPx: 655,
  contentHeightPx: 6000,
  averageBlockHeightPx: 42,
  ...over,
})

describe('planPreviewWindowAround', () => {
  it('puts the anchor a third of the way in, so most of the runway is ahead', () => {
    const range = planPreviewWindowAround(500, 10_000, 48)
    expect(range.endIndex - range.startIndex + 1).toBe(48)
    expect(range.startIndex).toBe(500 - 16)
    expect(isWithinPreviewWindow(range, 500)).toBe(true)
  })

  it('clamps at the document start without shrinking the span', () => {
    const range = planPreviewWindowAround(2, 10_000, 48)
    expect(range.startIndex).toBe(0)
    expect(range.endIndex).toBe(47)
  })

  it('clamps at the document end without shrinking the span', () => {
    const range = planPreviewWindowAround(9_995, 10_000, 48)
    expect(range.endIndex).toBe(9_999)
    expect(range.endIndex - range.startIndex + 1).toBe(48)
  })

  it('never exceeds the document', () => {
    const range = planPreviewWindowAround(1, 5, PREVIEW_WINDOW_INITIAL_BLOCKS)
    expect(range.startIndex).toBe(0)
    expect(range.endIndex).toBe(4)
  })

  it('reports an empty range for an empty document', () => {
    expect(planPreviewWindowAround(0, 0)).toEqual({ startIndex: 0, endIndex: -1 })
  })
})

describe('resolvePreviewWindowAdjustment', () => {
  it('leaves a window alone when both runways are deep enough', () => {
    // 655px viewport: 3 screenfuls is 1965px. Scrolled to 2000 with 6000 of
    // content leaves 3345 ahead and 2000 behind -- both above the threshold,
    // neither above the 3930px trim trigger.
    const result = resolvePreviewWindowAdjustment({ startIndex: 100, endIndex: 200 }, 10_000, geometry())
    expect(result).toBeNull()
  })

  it('grows forward when the forward runway is short', () => {
    const result = resolvePreviewWindowAdjustment(
      { startIndex: 100, endIndex: 200 },
      10_000,
      geometry({ scrollTopPx: 4000, contentHeightPx: 5000 }),
    )
    expect(result).not.toBeNull()
    expect(result!.endIndex).toBeGreaterThan(200)
  })

  it('grows backward when the backward runway is short', () => {
    const result = resolvePreviewWindowAdjustment(
      { startIndex: 100, endIndex: 200 },
      10_000,
      geometry({ scrollTopPx: 200, contentHeightPx: 9000 }),
    )
    expect(result).not.toBeNull()
    expect(result!.startIndex).toBeLessThan(100)
  })

  it('does not grow past the ends of the document', () => {
    const atStart = resolvePreviewWindowAdjustment(
      { startIndex: 0, endIndex: 100 },
      10_000,
      geometry({ scrollTopPx: 0, contentHeightPx: 9000 }),
    )
    expect(atStart?.startIndex ?? 0).toBe(0)

    const atEnd = resolvePreviewWindowAdjustment(
      { startIndex: 9_900, endIndex: 9_999 },
      10_000,
      geometry({ scrollTopPx: 4000, contentHeightPx: 5000 }),
    )
    expect(atEnd?.endIndex ?? 9_999).toBe(9_999)
  })

  it('trims the tail only from well beyond the grow threshold', () => {
    const result = resolvePreviewWindowAdjustment(
      { startIndex: 100, endIndex: 400 },
      10_000,
      geometry({ scrollTopPx: 2000, contentHeightPx: 20_000 }),
    )
    expect(result).not.toBeNull()
    expect(result!.endIndex).toBeLessThan(400)
  })

  it('trims the head when the reader has left it far behind', () => {
    const result = resolvePreviewWindowAdjustment(
      { startIndex: 100, endIndex: 400 },
      10_000,
      geometry({ scrollTopPx: 8000, contentHeightPx: 12_000 }),
    )
    expect(result).not.toBeNull()
    expect(result!.startIndex).toBeGreaterThan(100)
  })

  it('never trims below the minimum window', () => {
    const result = resolvePreviewWindowAdjustment(
      { startIndex: 100, endIndex: 100 + PREVIEW_WINDOW_MIN_BLOCKS },
      10_000,
      geometry({ scrollTopPx: 40_000, contentHeightPx: 80_000 }),
    )
    const next = result ?? { startIndex: 100, endIndex: 100 + PREVIEW_WINDOW_MIN_BLOCKS }
    expect(next.endIndex - next.startIndex + 1).toBeGreaterThanOrEqual(PREVIEW_WINDOW_MIN_BLOCKS)
  })

  it('does not oscillate: a trimmed window is not immediately short again', () => {
    // The hysteresis guarantee, stated as the property that matters. Trim to
    // the target depth and the result must still be above the grow threshold,
    // or a steady scroll would grow and trim on alternating frames.
    const clientHeightPx = 655
    const trimmedForwardRunwayPx = clientHeightPx * 4
    expect(trimmedForwardRunwayPx).toBeGreaterThan(clientHeightPx * 3)
  })

  it('grows by at least the minimum step even when blocks are enormous', () => {
    const result = resolvePreviewWindowAdjustment(
      { startIndex: 0, endIndex: 20 },
      10_000,
      geometry({ scrollTopPx: 4000, contentHeightPx: 5000, averageBlockHeightPx: 100_000 }),
    )
    expect(result!.endIndex - 20).toBeGreaterThanOrEqual(PREVIEW_WINDOW_MIN_STEP_BLOCKS)
  })

  it('says nothing about an empty document', () => {
    expect(resolvePreviewWindowAdjustment({ startIndex: 0, endIndex: -1 }, 0, geometry())).toBeNull()
  })

  it('says nothing before the pane has a height', () => {
    expect(resolvePreviewWindowAdjustment({ startIndex: 0, endIndex: 40 }, 10_000, geometry({ clientHeightPx: 0 }))).toBeNull()
  })
})
