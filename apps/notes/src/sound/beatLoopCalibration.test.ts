import { describe, expect, it } from 'vitest'
import { lastHit, LOOP_BAR_SEC, LOOP_SCORE } from './beatLoopCalibration'

describe('the calibration loop score', () => {
  it('is one bar at 87 BPM, hats on the eighths', () => {
    expect(LOOP_BAR_SEC).toBeCloseTo((4 * 60) / 87, 4)
    LOOP_SCORE.tick.forEach((h, i) => expect(h.sec).toBeCloseTo((i * LOOP_BAR_SEC) / 8, 9))
  })

  it('finds the latest hit, carrying the last one of a bar over into the next', () => {
    const snare = LOOP_BAR_SEC / 4
    expect(lastHit('pierce', snare + 0.05)).toEqual({ strength: 1, agoSec: expect.closeTo(0.05, 9) })
    expect(lastHit('pierce', 0.1).agoSec).toBeCloseTo(LOOP_BAR_SEC / 4 + 0.1, 9)
    expect(lastHit('thump', 0).agoSec).toBe(0)
  })
})
