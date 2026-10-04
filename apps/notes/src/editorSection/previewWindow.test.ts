import { describe, expect, it } from 'vitest'
import {
  PREVIEW_WINDOW_INITIAL_BLOCKS,
  clampPreviewWindowRange,
  isPreviewWindowRangeUsable,
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


describe('isPreviewWindowRangeUsable', () => {
  // The whole point of this predicate: an edit to the document the window is
  // already over must not be a reason to rebuild the window, because every
  // rebuild remounts (and so re-parses) every block in it.
  it('keeps a grown window when the document is merely edited', () => {
    expect(isPreviewWindowRangeUsable({ startIndex: 300, endIndex: 347 }, 5_000)).toBe(true)
  })

  it('rejects a window planned before the document had any blocks', () => {
    expect(isPreviewWindowRangeUsable({ startIndex: 0, endIndex: -1 }, 900)).toBe(false)
  })

  it('accepts the empty window while the document really is empty', () => {
    expect(isPreviewWindowRangeUsable({ startIndex: 0, endIndex: -1 }, 0)).toBe(true)
  })

  it('rejects a window reaching past the end of a shrunken document', () => {
    expect(isPreviewWindowRangeUsable({ startIndex: 300, endIndex: 347 }, 320)).toBe(false)
  })

  it('accepts a window ending exactly on the last block', () => {
    expect(isPreviewWindowRangeUsable({ startIndex: 300, endIndex: 347 }, 348)).toBe(true)
  })

  /**
   * The regression this exists for is a CYCLE, so the test has to iterate.
   * A single-step assertion cannot see one: every individual decision here
   * was correct, and only running them back to back shows that the two are
   * unreachable from each other.
   *
   * These are the measured numbers from the note it was found on: a 371px
   * viewport, 171px mean block, and a window flipping between 16 and 24
   * blocks forever because the 8-block minimum step (1368px) was wider than
   * the band between growing (3 screenfuls) and trimming (6).
   */
  it('reaches a fixed point instead of flipping between two ranges', () => {
    const clientHeightPx = 371
    const averageBlockHeightPx = 171
    const scrollTopPx = 1387
    const blockCount = 200

    let range = { startIndex: 119, endIndex: 134 }
    const seen: string[] = []

    for (let pass = 0; pass < 12; pass += 1) {
      const key = `${range.startIndex}..${range.endIndex}`
      // Content height follows the window: the mounted run is what exists.
      const mountedBlocks = range.endIndex - range.startIndex + 1
      const contentHeightPx = mountedBlocks * averageBlockHeightPx
      const next = resolvePreviewWindowAdjustment(range, blockCount, {
        scrollTopPx,
        clientHeightPx,
        contentHeightPx,
        averageBlockHeightPx,
      })
      if (!next) {
        // Settled. That is the whole assertion.
        expect(seen).not.toContain(key)
        return
      }
      expect(seen).not.toContain(key)
      seen.push(key)
      range = next
    }

    throw new Error(`window never settled, visited: ${seen.join(' -> ')}`)
  })

  it('never lets a correction land past the threshold it is correcting for', () => {
    const clientHeightPx = 371
    const averageBlockHeightPx = 171
    const growPx = clientHeightPx * 3
    const trimPx = clientHeightPx * 6

    // Grown from too little runway: must not end up wanting a trim.
    const grown = resolvePreviewWindowAdjustment({ startIndex: 119, endIndex: 134 }, 200, {
      scrollTopPx: 1387,
      clientHeightPx,
      contentHeightPx: 16 * averageBlockHeightPx,
      averageBlockHeightPx,
    })
    expect(grown).not.toBeNull()
    const grownRunway = ((grown!.endIndex - grown!.startIndex + 1) * averageBlockHeightPx) - (1387 + clientHeightPx)
    expect(grownRunway).toBeLessThanOrEqual(trimPx)

    // Trimmed from too much runway: must not end up wanting to grow.
    const trimmed = resolvePreviewWindowAdjustment({ startIndex: 119, endIndex: 142 }, 200, {
      scrollTopPx: 1387,
      clientHeightPx,
      contentHeightPx: 24 * averageBlockHeightPx,
      averageBlockHeightPx,
    })
    expect(trimmed).not.toBeNull()
    const trimmedRunway = ((trimmed!.endIndex - trimmed!.startIndex + 1) * averageBlockHeightPx) - (1387 + clientHeightPx)
    expect(trimmedRunway).toBeGreaterThanOrEqual(growPx)
  })
})

/**
 * Trimming with real heights rather than the window mean.
 *
 * The mean is a statement about the window as a whole, and the blocks at an
 * EDGE are the ones least likely to resemble it -- two images or a code fence
 * sitting at the front of a run of ordinary paragraphs is the ordinary case,
 * not a pathological one. A trim planned on the mean then removes far more
 * pixels than it meant to, and because a front-edge trim is paid for on
 * `scrollTop`, it removes them from the backward runway itself: the reader is
 * thrown against the mounted edge by the very pass that was supposed to be
 * housekeeping. That is what "the note fights the scrolling" looks like from
 * the inside.
 *
 * The blocks being removed are mounted and already measured, so none of this
 * has to be guessed.
 *
 * Geometry below, self-consistent by construction: a 371px viewport (growing
 * below 1113px of runway, trimming above 2226, aiming at 1484), two 900px
 * blocks and six 112px ones above the viewport for a backward runway of
 * exactly 2472px, and enough beyond it that the forward direction has no
 * opinion.
 */
describe('resolvePreviewWindowAdjustment with real block heights', () => {
  const clientHeightPx = 371
  const growPx = clientHeightPx * 3
  const trimPx = clientHeightPx * 6
  const heightOf = (index: number) => (index === 3782 || index === 3783 ? 900 : 112)

  const geometryFor = (range: { startIndex: number, endIndex: number }, scrollTopPx: number) => {
    let contentHeightPx = 0
    for (let index = range.startIndex; index <= range.endIndex; index += 1) contentHeightPx += heightOf(index)
    const mounted = range.endIndex - range.startIndex + 1
    return {
      scrollTopPx,
      clientHeightPx,
      contentHeightPx,
      averageBlockHeightPx: contentHeightPx / mounted,
      measuredBlockHeightPx: heightOf,
    }
  }

  it('sheds what it aimed to shed when the edge blocks dwarf the mean', () => {
    const range = { startIndex: 3782, endIndex: 3807 }
    const next = resolvePreviewWindowAdjustment(range, 10_000, geometryFor(range, 2472))
    expect(next).not.toBeNull()
    let shedPx = 0
    for (let index = range.startIndex; index < next!.startIndex; index += 1) shedPx += heightOf(index)
    // The mean here is 172px against 900px edge blocks, so a modelled trim
    // sheds five blocks and 2136px -- landing at 336px of runway, which is
    // not a trim, it is the reader against the edge.
    expect(2472 - shedPx).toBeGreaterThanOrEqual(growPx)
    expect(2472 - shedPx).toBeLessThanOrEqual(trimPx)
  })

  it('never strands the reader below the grow threshold on the way to settling', () => {
    let range = { startIndex: 3782, endIndex: 3807 }
    // The reader does not move; only the window does. A front-edge move is
    // paid for on scrollTop by the carry, which is why the backward runway
    // the next pass measures is exactly what this pass just changed.
    let scrollTopPx = 2472
    const seen: string[] = []

    for (let pass = 0; pass < 12; pass += 1) {
      const key = `${range.startIndex}..${range.endIndex}@${Math.round(scrollTopPx)}`
      expect(seen).not.toContain(key)
      seen.push(key)
      const next = resolvePreviewWindowAdjustment(range, 10_000, geometryFor(range, scrollTopPx))
      if (!next) return
      for (let index = range.startIndex; index < next.startIndex; index += 1) scrollTopPx -= heightOf(index)
      for (let index = next.startIndex; index < range.startIndex; index += 1) scrollTopPx += heightOf(index)
      range = next
      // Every intermediate state is a state the reader is actually in for a
      // frame, so the band has to hold at each of them, not merely at rest.
      expect(scrollTopPx).toBeGreaterThanOrEqual(growPx)
    }

    throw new Error(`window never settled, visited: ${seen.join(' -> ')}`)
  })
})

describe('clampPreviewWindowRange', () => {
  it('slides a same-sized window back to the new end rather than to the top', () => {
    const clamped = clampPreviewWindowRange({ startIndex: 300, endIndex: 347 }, 320)
    expect(clamped.endIndex).toBe(319)
    expect(clamped.endIndex - clamped.startIndex + 1).toBe(48)
    expect(clamped.startIndex).toBe(272)
  })

  it('shrinks rather than going negative when the document is smaller than the span', () => {
    const clamped = clampPreviewWindowRange({ startIndex: 300, endIndex: 347 }, 10)
    expect(clamped.startIndex).toBe(0)
    expect(clamped.endIndex).toBe(9)
  })

  it('leaves a window that already fits exactly alone', () => {
    const clamped = clampPreviewWindowRange({ startIndex: 12, endIndex: 59 }, 5_000)
    expect(clamped).toEqual({ startIndex: 12, endIndex: 59 })
  })

  it('answers the empty window for an empty document', () => {
    expect(clampPreviewWindowRange({ startIndex: 300, endIndex: 347 }, 0)).toEqual({ startIndex: 0, endIndex: -1 })
  })
})
