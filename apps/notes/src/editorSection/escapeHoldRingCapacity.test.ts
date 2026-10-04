import { describe, expect, it } from 'vitest'
import { computeEscapeHoldRingPoints } from './escapeHoldRingLayout'
import { MAX_STAGE_CHOICES } from '../adventure/core/screen'
import {
  BORDER_RADIUS_REGULAR_MAX_PX,
  BORDER_RADIUS_REGULAR_MIN_PX,
  SPACING_REGULAR_MAX_PX,
  SPACING_REGULAR_MIN_PX,
} from '../shared/uiBounds'

/**
 * How many cells the ring can actually hold.
 *
 * `MAX_STAGE_CHOICES` was chosen in a design conversation and carried a
 * PROVISIONAL note saying it had never been checked against the rendered
 * dial. Checking it is arithmetic, not a screenshot: cells sit at equal
 * ANGULAR intervals on a rounded square, so their centre-to-centre spacing
 * varies around the perimeter, and the tightest pair is what decides whether
 * the ring is legible.
 *
 * The check runs over the whole supported shape range rather than at the
 * defaults, because both inputs are sliders the reader can move
 * (`uiBounds.ts`). A cap that holds only at the shipped defaults is a cap
 * that fails in someone's settings.
 */

/** Mirrors the ring's own button size -- see escapeHoldRingLayout.ts. */
const BUTTON_SIZE_PX = 44

function tightestGapPx(count: number, borderRadiusRegularPx: number, spacingRegularPx: number): number {
  const points = computeEscapeHoldRingPoints(count, { borderRadiusRegularPx, spacingRegularPx })
  let tightest = Infinity
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]
    const b = points[(index + 1) % points.length]
    tightest = Math.min(tightest, Math.hypot(a.x - b.x, a.y - b.y))
  }
  return tightest
}

/** The tightest gap anywhere in the reader's own settings range. */
function worstCaseGapPx(count: number): { gapPx: number; borderRadiusRegularPx: number; spacingRegularPx: number } {
  let worst = { gapPx: Infinity, borderRadiusRegularPx: 0, spacingRegularPx: 0 }
  for (let radius = BORDER_RADIUS_REGULAR_MIN_PX; radius <= BORDER_RADIUS_REGULAR_MAX_PX; radius += 1) {
    for (let spacing = SPACING_REGULAR_MIN_PX; spacing <= SPACING_REGULAR_MAX_PX; spacing += 1) {
      const gapPx = tightestGapPx(count, radius, spacing)
      if (gapPx < worst.gapPx) worst = { gapPx, borderRadiusRegularPx: radius, spacingRegularPx: spacing }
    }
  }
  return worst
}

/** The largest count whose tightest pair still clears a button, anywhere in range. */
function ringCapacity(): number {
  for (let count = 20; count >= 1; count -= 1) {
    if (worstCaseGapPx(count).gapPx >= BUTTON_SIZE_PX) return count
  }
  return 0
}

describe('the escape ring', () => {
  it('holds ten cells, and that is a fact about its geometry', () => {
    // At maximum rounding the rounded square degenerates to a circle of
    // radius 72px; twelve 44px buttons need radius 84 to sit apart on one.
    // Nothing tunable closes that -- the panel and button sizes are static
    // CSS tokens.
    expect(ringCapacity()).toBe(10)
  })

  it('is comfortable at the shipped defaults and tightest at maximum spacing and rounding', () => {
    expect(tightestGapPx(10, 6, 4)).toBeGreaterThan(BUTTON_SIZE_PX)
    const worst = worstCaseGapPx(10)
    expect(worst.borderRadiusRegularPx).toBe(12)
    expect(worst.spacingRegularPx).toBe(SPACING_REGULAR_MAX_PX)
  })

  it('would overlap at the cap a stage may currently ask for', () => {
    // MAX_STAGE_CHOICES is 12 and the ring holds 10. Documented here rather
    // than asserted as correct: which way to close the gap -- fewer choices,
    // smaller cells, a bigger panel -- is a design decision, and this test
    // is what will fail the day someone assumes it was already settled.
    expect(MAX_STAGE_CHOICES).toBeGreaterThan(ringCapacity())
    expect(worstCaseGapPx(MAX_STAGE_CHOICES).gapPx).toBeLessThan(BUTTON_SIZE_PX)
  })
})
