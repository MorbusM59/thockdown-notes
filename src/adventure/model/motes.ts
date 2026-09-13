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
// The threshold sequence is 10, 15, 25, 40, 60, 85 ... -- each step 5 more
// than the last. It is stored rather than recomputed, because the update is
// the rule ("take a point, the next one costs 5 x points more") and a closed
// form would be a second statement of it to keep in step.

/** What the first stat point costs, before any have been taken. */
export const FIRST_STAT_POINT_THRESHOLD = 10

/** How much further away each stat point pushes the next, per point held. */
export const STAT_POINT_STEP = 5

/**
 * The experience between the PREVIOUS stat point and the next one -- the
 * span the progress bar measures across.
 *
 * The general term is `STAT_POINT_STEP * pointsAcquired`, which is zero
 * before the first point is taken and would divide by it. The first span is
 * the first threshold itself: nought to ten. Handled here, once, so no
 * caller has to know the sequence starts differently.
 */
export function statPointSpan(pointsAcquired: number): number {
  const points = Math.max(0, Math.floor(pointsAcquired))
  return points === 0 ? FIRST_STAT_POINT_THRESHOLD : STAT_POINT_STEP * points
}

/**
 * How many stat points this run has SPENT -- allocated into a stat, never to
 * come back. `statPointsAcquired` is that count under an older name: it is
 * incremented by `allocateStatPoint`, which is the spend, not the earn.
 *
 * Named here rather than read off the field at the call site, because the
 * field's name says the opposite of what it counts and a reader of the
 * chrome should not have to know that.
 */
export function statPointsSpent(statPointsAcquired: number): number {
  return Math.max(0, Math.floor(statPointsAcquired))
}

/**
 * How many FAME points this run has spent.
 *
 * Always zero, and honestly so: fame points can be attained and spent by
 * design (the same shape as stat points), and NEITHER half is written --
 * there is no fame-point field on the record, no curve that turns fame into
 * points, and nothing to spend one on. See the open questions in
 * docs/adventure-platform.md.
 *
 * A function rather than a literal at the display, so the day the concept
 * lands there is one place that answers this and the chrome already reads
 * it. Deliberately NOT a stored field: storage with no writer is a rule
 * half-decided, and this is a count that is genuinely zero rather than
 * unknown.
 */
export function famePointsSpent(): number {
  return 0
}

/** Motes in hand, for buying traits. Nothing about stat points enters this. */
export function moteBalance(experienceEarned: number, experienceSpentOnTraits: number): number {
  return Math.max(0, experienceEarned - experienceSpentOnTraits)
}

/** Whether the run has earned enough total experience to take another point. */
export function canAllocateStatPoint(experienceEarned: number, experienceToNextStatPoint: number): boolean {
  return experienceEarned >= experienceToNextStatPoint
}

/**
 * How far past the previous stat point this run is, as a fraction of the
 * span to the next. 0..1, and 1 means a point is waiting to be taken.
 */
export function statPointProgress(
  experienceEarned: number,
  experienceToNextStatPoint: number,
  pointsAcquired: number,
): number {
  const span = statPointSpan(pointsAcquired)
  if (span <= 0) return 0
  const previousThreshold = experienceToNextStatPoint - span
  return Math.max(0, Math.min(1, (experienceEarned - previousThreshold) / span))
}

/**
 * Taking a stat point: one more acquired, and the next one pushed further
 * away by the NEW count. The order matters -- the step uses the count after
 * the increment, which is what makes the spans 10, 5, 10, 15, 20 ... rather
 * than 10, 0, 5, 10.
 */
export function allocateStatPoint(
  experienceToNextStatPoint: number,
  pointsAcquired: number,
): { experienceToNextStatPoint: number; statPointsAcquired: number } {
  const acquired = Math.max(0, Math.floor(pointsAcquired)) + 1
  return {
    experienceToNextStatPoint: experienceToNextStatPoint + STAT_POINT_STEP * acquired,
    statPointsAcquired: acquired,
  }
}
