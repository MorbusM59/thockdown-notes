import { describe, expect, it } from 'vitest'
import { resolveThumbRubberBand } from './scrollThumbRubberBand'

const band = (leadProgress: number, trailProgress: number, overrides?: Partial<Parameters<typeof resolveThumbRubberBand>[0]>) =>
  resolveThumbRubberBand({
    startTopPx: 100,
    targetTopPx: 600,
    thumbHeightPx: 40,
    leadProgress,
    trailProgress,
    ...overrides,
  })

describe('resolveThumbRubberBand travelling down', () => {
  it('rests at its normal size before anything has moved', () => {
    expect(band(0, 0)).toEqual({ topPx: 100, heightPx: 40 })
  })

  it('grows downward while the leading edge runs and the trailing one waits', () => {
    expect(band(0.5, 0)).toEqual({ topPx: 100, heightPx: 290 })
    // Leading edge has arrived; the thumb is stretched across the whole span.
    expect(band(1, 0)).toEqual({ topPx: 100, heightPx: 540 })
  })

  it('contracts onto the target as the trailing edge catches up', () => {
    expect(band(1, 0.5)).toEqual({ topPx: 350, heightPx: 290 })
    expect(band(1, 1)).toEqual({ topPx: 600, heightPx: 40 })
  })

  it('never lets the thumb shrink below its resting height', () => {
    for (let lead = 0; lead <= 1; lead += 0.1) {
      for (let trail = 0; trail <= lead; trail += 0.1) {
        expect(band(lead, trail).heightPx).toBeGreaterThanOrEqual(40)
      }
    }
  })
})

describe('resolveThumbRubberBand travelling up', () => {
  const up = (leadProgress: number, trailProgress: number) =>
    band(leadProgress, trailProgress, { startTopPx: 600, targetTopPx: 100 })

  it('grows upward instead, which is the same arithmetic', () => {
    expect(up(0, 0)).toEqual({ topPx: 600, heightPx: 40 })
    // The leading edge is the TOP one going up, so the thumb's top moves and
    // its bottom stays where it was.
    expect(up(0.5, 0)).toEqual({ topPx: 350, heightPx: 290 })
    expect(up(1, 0)).toEqual({ topPx: 100, heightPx: 540 })
  })

  it('contracts onto the target the same way', () => {
    expect(up(1, 0.5)).toEqual({ topPx: 100, heightPx: 290 })
    expect(up(1, 1)).toEqual({ topPx: 100, heightPx: 40 })
  })
})

describe('resolveThumbRubberBand edges', () => {
  it('holds still for a journey that goes nowhere', () => {
    const still = band(0.7, 0.2, { startTopPx: 300, targetTopPx: 300 })
    expect(still).toEqual({ topPx: 300, heightPx: 40 })
  })

  it('refuses progress outside its own travel', () => {
    expect(band(2, -1)).toEqual(band(1, 0))
  })

  it('is monotone: the thumb never doubles back while an edge is running', () => {
    let previousTop = -Infinity
    for (let trail = 0; trail <= 1; trail += 0.05) {
      const { topPx } = band(1, trail)
      expect(topPx).toBeGreaterThanOrEqual(previousTop)
      previousTop = topPx
    }
  })
})
