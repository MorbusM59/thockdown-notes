import { describe, expect, it } from 'vitest'

import { LUCKINESS_INITIAL, LUCKINESS_INITIAL_DECAY, guardianLuckiness } from './guardian'
import { DEFAULT_SETTINGS } from './gameState'
import { runTuning } from './gameState'

describe('the guardian angel', () => {
  it('starts at the initial share and gives it back one decay per level', () => {
    // Read off the constants rather than written out, so tuning the pair does
    // not make this test lie about what the pair says.
    for (let level = 1; level <= 8; level += 1) {
      const expected = Math.max(0, LUCKINESS_INITIAL - LUCKINESS_INITIAL_DECAY * (level - 1)) / 100
      expect(guardianLuckiness(level)).toBeCloseTo(expected, 10)
    }
  })

  it('reaches exactly zero and never goes below it', () => {
    // The level it runs out on is the pair's own arithmetic, not a number
    // written here: at 60 and 20 that is the fourth.
    const spent = Math.ceil(LUCKINESS_INITIAL / LUCKINESS_INITIAL_DECAY) + 1
    expect(guardianLuckiness(spent)).toBe(0)
    for (const level of [spent, spent + 1, 50, 1000]) expect(guardianLuckiness(level)).toBe(0)
    // A level below the first reads as the first rather than as more than it.
    expect(guardianLuckiness(0)).toBe(guardianLuckiness(1))
    expect(guardianLuckiness(-5)).toBe(guardianLuckiness(1))
  })

  it('is a FLOOR under the reader\'s slider, never an addend', () => {
    // The property, both ways: a slider under the floor is lifted to it, and
    // a slider above it is left exactly where the reader put it. Adding would
    // make the early game harder for somebody who deliberately set a high
    // number, which is the opposite of what a floor is for.
    const run = { progression: 1.01, successAdjust: 0, level: 1 }
    const under = runTuning(run, { ...DEFAULT_SETTINGS, successAdjust: 0.1 })
    expect(under.successAdjust).toBe(guardianLuckiness(1))

    const over = runTuning(run, { ...DEFAULT_SETTINGS, successAdjust: 0.9 })
    expect(over.successAdjust).toBe(0.9)
  })

  it('holds in TRUE mode too, because it is not a setting', () => {
    // True mode freezes what the reader chose. The floor is not something
    // they chose, so it is not something true mode can freeze away.
    const run = { progression: 1.2, successAdjust: 0, level: 1 }
    const strict = runTuning(run, { ...DEFAULT_SETTINGS, trueMode: true, successAdjust: 0 })
    expect(strict.successAdjust).toBe(guardianLuckiness(1))
    expect(strict.progression).toBe(1.2)
  })

  it('is out of the way once the run can carry itself', () => {
    const late = { progression: 1.01, successAdjust: 0.15, level: 6 }
    expect(runTuning(late, { ...DEFAULT_SETTINGS, successAdjust: 0.15 }).successAdjust).toBe(0.15)
  })
})
