import { describe, expect, it } from 'vitest'
import { LOOP_01, LOOP_02, LOOP_03, LOOP_04, LOOP_05, LOOP_06, LOOP_07, lastHit } from './beatLoops'

const BEAT_LOOPS = [LOOP_01, LOOP_02, LOOP_03, LOOP_04, LOOP_05, LOOP_06, LOOP_07]

describe('the calibration loops', () => {
  it('fit a whole number of bars into each track, every hit inside its bar', () => {
    for (const loop of BEAT_LOOPS) {
      expect(loop.trackSec / loop.barSec).toBeCloseTo(Math.round(loop.trackSec / loop.barSec), 9)
      for (const hits of Object.values(loop.score)) for (const { sec } of hits) expect(sec >= 0 && sec < loop.barSec).toBe(true)
    }
  })

  it('finds the latest hit, carrying the last one of a bar over into the next', () => {
    const loop = BEAT_LOOPS[1]
    expect(lastHit(loop, 'pierce', 1.05)).toEqual({ strength: 1, agoSec: expect.closeTo(0.05, 9) })
    expect(lastHit(loop, 'pierce', 0.5).agoSec).toBeCloseTo(1.5, 9)
    expect(lastHit(loop, 'thump', 0).agoSec).toBe(0)
  })
})
