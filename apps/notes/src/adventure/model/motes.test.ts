import { describe, expect, it } from 'vitest'

import { canAllocateStatPoint, moteBalance, statPointProgress, statPointStanding } from './motes'
import { goldBalance } from './gold'

/**
 * The ladder itself is tested in milestones.test.ts, which is where it now
 * lives. What is left here is the half that is specific to a CURRENCY: that
 * spending it never moves the ladder it feeds.
 */
describe('experience motes', () => {
  it('spends on traits without touching the stat track', () => {
    // The whole reason two numbers are stored rather than one balance.
    expect(moteBalance(30, 12)).toBe(18)
    expect(canAllocateStatPoint(30, 25)).toBe(true)
    // ...and it is still true after spending every last mote.
    expect(moteBalance(30, 30)).toBe(0)
    expect(canAllocateStatPoint(30, 25)).toBe(true)
  })

  it('reports the span it is measuring across, so the words match the bar', () => {
    // Before any point: nought to ten, four of them earned.
    expect(statPointStanding(4, 10, 0)).toEqual({ into: 4, span: 10 })
    expect(statPointProgress(4, 10, 0)).toBeCloseTo(0.4, 10)
    // After two: fifteen to twenty-five, five of them earned.
    expect(statPointStanding(20, 25, 2)).toEqual({ into: 5, span: 10 })
    expect(statPointProgress(20, 25, 2)).toBeCloseTo(0.5, 10)
  })
})

/** Gold is the exact mirror -- one earning stream, spent without cost to the score. */
describe('gold', () => {
  it('spends on items without touching the fame track', () => {
    expect(goldBalance(30, 12)).toBe(18)
    expect(goldBalance(30, 30)).toBe(0)
    // The ladder reads the EARNED total, which spending never reduced.
    expect(goldBalance(30, 30)).not.toBe(30)
  })
})
