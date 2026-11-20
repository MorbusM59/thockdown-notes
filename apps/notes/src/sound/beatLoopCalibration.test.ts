import { describe, expect, it } from 'vitest'
import { lastHit, LOOP_BAR_SEC, LOOP_SCORE } from './beatLoopCalibration'

describe('the calibration loop score', () => {
  it('has four kicks, two snares and 24 evenly spaced ticks to the bar', () => {
    expect(LOOP_SCORE.thump).toHaveLength(4)
    expect(LOOP_SCORE.pierce.map((h) => h.sec)).toEqual([1, 3])
    expect(LOOP_SCORE.tick).toHaveLength(24)
    LOOP_SCORE.tick.forEach((h, i) => expect(h.sec).toBeCloseTo((i * LOOP_BAR_SEC) / 24, 9))
  })

  it('finds the latest hit, carrying the last one of a bar over into the next', () => {
    expect(lastHit('pierce', 1.05)).toEqual({ strength: 1, agoSec: expect.closeTo(0.05, 9) })
    expect(lastHit('pierce', 0.5).agoSec).toBeCloseTo(1.5, 9)
    expect(lastHit('thump', 0).agoSec).toBe(0)
  })
})
