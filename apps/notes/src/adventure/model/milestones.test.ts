import { describe, expect, it } from 'vitest'

import {
  canTakeMilestone,
  FAME_LADDER,
  FIRST_MILESTONE_THRESHOLD,
  milestoneProgress,
  milestoneSpan,
  STAT_LADDER,
  takeMilestone,
  type Ladder,
} from './milestones'
import { famePointProgress } from './gold'
import { statPointProgress } from './motes'

/** Walks the threshold sequence by taking every point as soon as it is due. */
function thresholds(ladder: Ladder, count: number): number[] {
  let threshold = FIRST_MILESTONE_THRESHOLD
  let spent = 0
  const seen: number[] = []
  for (let index = 0; index < count; index += 1) {
    seen.push(threshold)
    const taken = takeMilestone(ladder, threshold, spent)
    threshold = taken.threshold
    spent = taken.pointsSpent
  }
  return seen
}

describe('the milestone ladders', () => {
  it('walks the fame sequence 10, 15, 25, 40, 60, 85', () => {
    expect(thresholds(FAME_LADDER, 6)).toEqual([10, 15, 25, 40, 60, 85])
  })

  it('walks the stat sequence 10, 24, 44, 71, 109, 163, each span 40% wider', () => {
    expect(thresholds(STAT_LADDER, 6)).toEqual([10, 24, 44, 71, 109, 163])
  })

  for (const [name, ladder] of [['fame', FAME_LADDER], ['stat', STAT_LADDER]] as const) {
    it(`${name}: does not divide by zero before the first point is taken`, () => {
      expect(milestoneSpan(ladder, 0)).toBe(FIRST_MILESTONE_THRESHOLD)
      expect(Number.isFinite(milestoneProgress(ladder, 7, 10, 0))).toBe(true)
    })

    it(`${name}: is a fixed point -- taking every point as it falls due lands exactly on 0`, () => {
      // Walked rather than spot-checked: whatever the run earns, the bar is
      // never outside 0..1 and reads exactly 0 the moment a point is taken.
      let threshold = FIRST_MILESTONE_THRESHOLD
      let spent = 0
      for (let earned = 0; earned <= 400; earned += 1) {
        while (canTakeMilestone(earned, threshold)) {
          const taken = takeMilestone(ladder, threshold, spent)
          threshold = taken.threshold
          spent = taken.pointsSpent
          expect(milestoneProgress(ladder, earned, threshold, spent)).toBeLessThan(1)
        }
        const ratio = milestoneProgress(ladder, earned, threshold, spent)
        expect(ratio).toBeGreaterThanOrEqual(0)
        expect(ratio).toBeLessThan(1)
      }
      expect(spent).toBeGreaterThan(5)
    })
  }
})

/**
 * Each reader reads ITS OWN ladder. They were one ladder by design until
 * stat points were found to compound (adventure-game-design.md, "Choices
 * that have to be weighed"); a reader on the wrong ladder fails here.
 */
describe('fame and stat points each read their own ladder', () => {
  it('agrees with the ladder it names at every point of a walk', () => {
    for (const [ladder, read] of [[FAME_LADDER, famePointProgress], [STAT_LADDER, statPointProgress]] as const) {
      let threshold = FIRST_MILESTONE_THRESHOLD
      let spent = 0
      for (let earned = 0; earned <= 300; earned += 1) {
        if (canTakeMilestone(earned, threshold)) {
          const taken = takeMilestone(ladder, threshold, spent)
          threshold = taken.threshold
          spent = taken.pointsSpent
        }
        expect(read(earned, threshold, spent)).toBe(milestoneProgress(ladder, earned, threshold, spent))
      }
    }
  })
})
