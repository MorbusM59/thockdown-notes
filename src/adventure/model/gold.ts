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

import { canTakeMilestone, milestoneProgress, milestoneStanding, milestonesAvailable } from './milestones'

/** Gold in hand, for buying items. Nothing about fame points enters this. */
export function goldBalance(goldEarned: number, goldSpentOnItems: number): number {
  return Math.max(0, goldEarned - goldSpentOnItems)
}

/**
 * How many fame points are waiting to be spent. Derived; nothing stores it.
 *
 * The exact mirror of `statPointsAvailable`, and it arrived for the same
 * reason: there WAS a `famePoints` counter on the record, granted by an
 * effect nothing ever emitted, and `allocateFamePoint` refused to do
 * anything while it was zero -- so a fame point could be earned and never
 * taken, by construction. That is the defect model/milestones.ts already
 * describes for stat points, in the sibling that was not fixed with it,
 * which is this codebase's characteristic failure exactly (CLAUDE.md's
 * rule 4).
 */
export function famePointsAvailable(
  goldEarned: number,
  goldToNextFamePoint: number,
  famePointsSpent: number,
): number {
  return milestonesAvailable(goldEarned, goldToNextFamePoint, famePointsSpent)
}

/** Whether the run has earned enough total gold to take another fame point. */
export function canAllocateFamePoint(goldEarned: number, goldToNextFamePoint: number): boolean {
  return canTakeMilestone(goldEarned, goldToNextFamePoint)
}

/**
 * The run's SCORE: every fame point the ladder has handed out, spent or not.
 *
 * Spent plus waiting rather than either alone -- the ladder only moves when a
 * point is spent, so a run that hoards them has still reached those
 * milestones and must not score less for sitting on them.
 */
export function fameReached(
  goldEarned: number,
  goldToNextFamePoint: number,
  famePointsSpent: number,
): number {
  return famePointsSpent + famePointsAvailable(goldEarned, goldToNextFamePoint, famePointsSpent)
}

/** How far past the previous fame point this run is, 0..1. */
export function famePointProgress(goldEarned: number, goldToNextFamePoint: number, famePointsSpent: number): number {
  return milestoneProgress(goldEarned, goldToNextFamePoint, famePointsSpent)
}

/** The current span and how much of it is earned, for the gauge's tooltip. */
export function famePointStanding(goldEarned: number, goldToNextFamePoint: number, famePointsSpent: number) {
  return milestoneStanding(goldEarned, goldToNextFamePoint, famePointsSpent)
}
