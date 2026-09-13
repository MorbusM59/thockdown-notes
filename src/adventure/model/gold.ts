// Gold: one earning stream, read two completely different ways -- the exact
// mirror of experience (model/motes.ts), which is why both go through the
// same ladder (model/milestones.ts).
//
//   - As CURRENCY it buys items. The balance is what has been earned minus
//     what has been spent on them, and fame points never touch it.
//   - As a MILESTONE it measures the run's total. Fame points read
//     `goldEarned` alone -- which is monotonic -- so spending gold on an
//     item does not cost the run score, and hoarding it does not earn any.
//     What advances the milestone is the THRESHOLD moving: each fame point
//     taken pushes the next one further away.
//
// That is the whole of "converting power into gold, and gold into score":
// the score is a function of everything the run ever earned, and what you do
// with the gold in hand is a separate decision that cannot cheat it.

import { milestoneProgress, milestoneStanding } from './milestones'

/** Gold in hand, for buying items. Nothing about fame points enters this. */
export function goldBalance(goldEarned: number, goldSpentOnItems: number): number {
  return Math.max(0, goldEarned - goldSpentOnItems)
}

/** How far past the previous fame point this run is, 0..1. */
export function famePointProgress(goldEarned: number, goldToNextFamePoint: number, famePointsSpent: number): number {
  return milestoneProgress(goldEarned, goldToNextFamePoint, famePointsSpent)
}

/** The current span and how much of it is earned, for the gauge's tooltip. */
export function famePointStanding(goldEarned: number, goldToNextFamePoint: number, famePointsSpent: number) {
  return milestoneStanding(goldEarned, goldToNextFamePoint, famePointsSpent)
}
