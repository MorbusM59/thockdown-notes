import { describe, expect, it } from 'vitest'
import { resolveRowGridCorrection, resolveRowGridDirection, ROW_GRID_TOLERANCE_PX } from './rowGridGuard'

const at = (scrollTopPx: number, overrides?: Partial<Parameters<typeof resolveRowGridCorrection>[0]>) =>
  resolveRowGridCorrection({ scrollTopPx, lineHeightPx: 26, maxScrollTopPx: 100000, ...overrides })

describe('resolveRowGridCorrection', () => {
  it('leaves a position that is already on the grid alone', () => {
    expect(at(0)).toBeNull()
    expect(at(26)).toBeNull()
    expect(at(8788)).toBeNull()
  })

  it('rounds to the nearest row in both directions', () => {
    // 8774 is the exact miss measured live after CM6 corrected its own
    // height estimate mid-run: 12px past row 337 (8762), and 14px short of
    // row 338 (8788), so the nearest row is the one behind it.
    expect(at(8774)).toBe(8762)
    expect(at(8780)).toBe(8788)
    expect(at(8770)).toBe(8762)
  })

  it('tolerates sub-pixel noise rather than trading writes with the browser', () => {
    expect(at(26 + (ROW_GRID_TOLERANCE_PX / 2))).toBeNull()
    expect(at(26 - (ROW_GRID_TOLERANCE_PX / 2))).toBeNull()
    // Just past the tolerance is a real miss again.
    expect(at(26.75)).toBe(26)
  })

  it('never proposes a position outside the scrollable range', () => {
    expect(at(3, { maxScrollTopPx: 100000 })).toBe(0)
    // A maximum that is not itself a row multiple: rounding up would leave
    // the range, so the guard steps down to the last row that fits rather
    // than clamping to an off-grid position it would want to correct again.
    expect(at(99989, { maxScrollTopPx: 99990 })).toBe(99970)
  })

  it('always proposes a position that is itself on the grid', () => {
    for (const maxScrollTopPx of [99990, 100000, 12345, 26]) {
      for (const scrollTopPx of [0, 3, 27, 8774, 12340, 99989]) {
        const correction = at(scrollTopPx, { maxScrollTopPx })
        if (correction === null) continue
        expect(correction % 26).toBe(0)
        expect(correction).toBeGreaterThanOrEqual(0)
        expect(correction).toBeLessThanOrEqual(maxScrollTopPx)
      }
    }
  })

  it('declines when it has nothing to work with', () => {
    expect(at(500, { lineHeightPx: 0 })).toBeNull()
    expect(at(500, { lineHeightPx: Number.NaN })).toBeNull()
    expect(at(Number.NaN)).toBeNull()
  })

  it('does not fight a document that cannot scroll', () => {
    expect(at(0, { maxScrollTopPx: 0 })).toBeNull()
  })
})

describe('gesture-driven corrections', () => {
  it('rounds the way the gesture is already going', () => {
    // Mid-drag downward: pulling back to row 337 would stutter the selection
    // against the drag, so it rounds up instead even though 8762 is nearer.
    expect(at(8774, { direction: 'forward' })).toBe(8788)
    expect(at(8780, { direction: 'backward' })).toBe(8762)
  })

  it('reads the direction off the scroll delta', () => {
    expect(resolveRowGridDirection(12)).toBe('forward')
    expect(resolveRowGridDirection(-12)).toBe('backward')
    // Native drag auto-scroll advances by sub-pixel amounts per frame, and
    // those are real motion -- judging them motionless would drop the
    // directional rounding this exists for.
    expect(resolveRowGridDirection(0.3)).toBe('forward')
    expect(resolveRowGridDirection(-0.3)).toBe('backward')
    // Only an effectively stationary value has no direction to follow.
    expect(resolveRowGridDirection(0)).toBe('nearest')
    expect(resolveRowGridDirection(Number.NaN)).toBe('nearest')
  })

  it('still refuses to leave the scrollable range', () => {
    expect(at(99989, { direction: 'forward', maxScrollTopPx: 99990 })).toBe(99970)
  })
})
