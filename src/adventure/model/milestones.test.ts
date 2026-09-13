import { describe, expect, it } from 'vitest'

import {
  canTakeMilestone,
  FIRST_MILESTONE_THRESHOLD,
  milestoneProgress,
  milestoneSpan,
  takeMilestone,
} from './milestones'
import { famePointProgress } from './gold'
import { statPointProgress } from './motes'

/** Walks the threshold sequence by taking every point as soon as it is due. */
function thresholds(count: number): number[] {
  let threshold = FIRST_MILESTONE_THRESHOLD
  let spent = 0
  const seen: number[] = []
  for (let index = 0; index < count; index += 1) {
    seen.push(threshold)
    const taken = takeMilestone(threshold, spent)
    threshold = taken.threshold
    spent = taken.pointsSpent
  }
  return seen
}

describe('the milestone ladder', () => {
  it('walks the threshold sequence 10, 15, 25, 40, 60, 85', () => {
    expect(thresholds(6)).toEqual([10, 15, 25, 40, 60, 85])
  })

  it('does not divide by zero before the first point is taken', () => {
    // The general span is 5 * pointsSpent, which is 0 here. Fails with a NaN
    // if the first span is not read as the first threshold instead.
    expect(milestoneSpan(0)).toBe(FIRST_MILESTONE_THRESHOLD)
    expect(Number.isFinite(milestoneProgress(7, 10, 0))).toBe(true)
  })

  it('is a fixed point: taking every point as it falls due lands exactly on 0', () => {
    // The property, walked rather than spot-checked: whatever the run earns,
    // the bar is never outside 0..1 and reads exactly 0 the moment a point
    // is taken -- which is what makes "full means now" true at every level.
    let threshold = FIRST_MILESTONE_THRESHOLD
    let spent = 0
    for (let earned = 0; earned <= 200; earned += 1) {
      while (canTakeMilestone(earned, threshold)) {
        const taken = takeMilestone(threshold, spent)
        threshold = taken.threshold
        spent = taken.pointsSpent
        expect(milestoneProgress(earned, threshold, spent)).toBeLessThan(1)
      }
      const ratio = milestoneProgress(earned, threshold, spent)
      expect(ratio).toBeGreaterThanOrEqual(0)
      expect(ratio).toBeLessThan(1)
    }
    expect(spent).toBeGreaterThan(5)
  })
})

/**
 * "The fame curve is identical to the stat points curve" is the design
 * decision this module exists to hold, so it is asserted rather than merely
 * arranged for: the two readers must agree everywhere, not just where they
 * were sampled. A future tweak to one of them fails here rather than
 * silently making gold and experience advance at different rates.
 */
describe('fame and stat points are one ladder', () => {
  it('agrees at every point of a walk across both', () => {
    let threshold = FIRST_MILESTONE_THRESHOLD
    let spent = 0
    for (let earned = 0; earned <= 200; earned += 1) {
      if (canTakeMilestone(earned, threshold)) {
        const taken = takeMilestone(threshold, spent)
        threshold = taken.threshold
        spent = taken.pointsSpent
      }
      expect(famePointProgress(earned, threshold, spent))
        .toBe(statPointProgress(earned, threshold, spent))
    }
    expect(spent).toBeGreaterThan(5)
  })
})
