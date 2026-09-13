// Experience motes: one earning stream, read two completely different ways.
//
// A mote is BOTH a currency and a milestone, and the two do not interact:
//
//   - As CURRENCY it buys traits. The balance is what has been earned minus
//     what has been spent on them, and stat points never touch it.
//   - As a MILESTONE it measures the run's total. Stat points read
//     `experienceEarned` alone -- which is monotonic -- so spending motes on
//     traits does not slow the character down, and hoarding them does not
//     speed it up. What advances the milestone is the THRESHOLD moving: each
//     stat point taken pushes the next one further away.
//
// That is why `experienceEarned` and `experienceSpentOnTraits` are stored
// separately rather than as one running balance. A single balance cannot
// answer both questions: subtracting a trait purchase from it would silently
// push the next stat point away, and not subtracting it would make the
// currency infinite.
//
// The ladder itself -- the 10, 15, 25, 40 ... sequence and everything that
// reads it -- is NOT here. Gold does exactly this too, one point at a time,
// on the same numbers (fame points, model/gold.ts), so the ladder is written
// once in model/milestones.ts and this module is only the experience half of
// it.

import { milestoneProgress, milestoneSpan, milestoneStanding, milestonesAvailable, takeMilestone, canTakeMilestone } from './milestones'

/** Motes in hand, for buying traits. Nothing about stat points enters this. */
export function moteBalance(experienceEarned: number, experienceSpentOnTraits: number): number {
  return Math.max(0, experienceEarned - experienceSpentOnTraits)
}

/** How many stat points are waiting to be spent. Derived; nothing stores it. */
export function statPointsAvailable(
  experienceEarned: number,
  experienceToNextStatPoint: number,
  statPointsSpent: number,
): number {
  return milestonesAvailable(experienceEarned, experienceToNextStatPoint, statPointsSpent)
}

/** Whether the run has earned enough total experience to take another point. */
export function canAllocateStatPoint(experienceEarned: number, experienceToNextStatPoint: number): boolean {
  return canTakeMilestone(experienceEarned, experienceToNextStatPoint)
}

/** How far past the previous stat point this run is, 0..1. */
export function statPointProgress(
  experienceEarned: number,
  experienceToNextStatPoint: number,
  statPointsSpent: number,
): number {
  return milestoneProgress(experienceEarned, experienceToNextStatPoint, statPointsSpent)
}

/** The current span and how much of it is earned, for the gauge's tooltip. */
export function statPointStanding(
  experienceEarned: number,
  experienceToNextStatPoint: number,
  statPointsSpent: number,
) {
  return milestoneStanding(experienceEarned, experienceToNextStatPoint, statPointsSpent)
}

/** The span to the next stat point, for callers that only need its width. */
export function statPointSpan(statPointsSpent: number): number {
  return milestoneSpan(statPointsSpent)
}

/**
 * Spending a stat point on a stat: one more spent, and the next one pushed
 * further away. See takeMilestone for why the order matters.
 */
export function allocateStatPoint(
  experienceToNextStatPoint: number,
  statPointsSpent: number,
): { experienceToNextStatPoint: number; statPointsSpent: number } {
  const taken = takeMilestone(experienceToNextStatPoint, statPointsSpent)
  return { experienceToNextStatPoint: taken.threshold, statPointsSpent: taken.pointsSpent }
}
