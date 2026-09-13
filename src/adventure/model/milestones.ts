// A milestone ladder: an earning stream that hands out a point each time it
// crosses a threshold, and pushes the threshold further away every time one
// of those points is spent.
//
// There are TWO of these and they are the same ladder, which is why it is
// written once here rather than twice under two names:
//
//   experience earned -> STAT POINTS, spent on stats   (model/motes.ts)
//   gold      earned  -> FAME POINTS, spent on ...     (model/gold.ts)
//
// The sequence is 10, 15, 25, 40, 60, 85 ... -- each step 5 more than the
// last. It is STORED on the record rather than recomputed, because the
// update is the rule ("take a point, the next one costs 5 x points more")
// and a closed form would be a second statement of it to keep in step.
//
// The threshold advances on the SPEND, not on the attainment. That is
// deliberate and it is what makes an unspent point cost something: hoard one
// and the ladder does not move, so the next is no closer. It is also why
// every function here is parameterised by points SPENT rather than points
// attained.
//
// Each stream's own EARNED total is monotonic and is never reduced by
// spending the currency, because the same number is both the currency's
// source and the ladder's position. Spending on an item must not push the
// next fame point away, exactly as spending on a trait must not push the
// next stat point away -- see model/motes.ts for the full argument, which
// was written for experience first and turned out to be about both.

/** What the first point on any ladder costs, before any have been spent. */
export const FIRST_MILESTONE_THRESHOLD = 10

/** How much further away each spent point pushes the next, per point spent. */
export const MILESTONE_STEP = 5

/**
 * The earnings between the PREVIOUS point and the next one -- the span the
 * progress bar measures across.
 *
 * The general term is `MILESTONE_STEP * pointsSpent`, which is zero before
 * the first point is spent and would divide by it. The first span is the
 * first threshold itself: nought to ten. Handled here, once, so no caller
 * has to know the sequence starts differently.
 */
export function milestoneSpan(pointsSpent: number): number {
  const spent = Math.max(0, Math.floor(pointsSpent))
  return spent === 0 ? FIRST_MILESTONE_THRESHOLD : MILESTONE_STEP * spent
}

/** Whether the run has earned enough in total to take another point. */
export function canTakeMilestone(earned: number, threshold: number): boolean {
  return earned >= threshold
}

/**
 * How far past the previous point this run is, as a fraction of the span to
 * the next. 0..1, and 1 means a point is waiting to be taken.
 */
export function milestoneProgress(earned: number, threshold: number, pointsSpent: number): number {
  const span = milestoneSpan(pointsSpent)
  if (span <= 0) return 0
  const previousThreshold = threshold - span
  return Math.max(0, Math.min(1, (earned - previousThreshold) / span))
}

/**
 * How much of the current span has been earned, and how wide that span is --
 * the two numbers a tooltip says in words where the bar says them as a
 * length. Derived from the same three inputs as the progress, so the words
 * and the bar cannot disagree.
 */
export function milestoneStanding(earned: number, threshold: number, pointsSpent: number): { into: number; span: number } {
  const span = milestoneSpan(pointsSpent)
  return { into: Math.max(0, earned - (threshold - span)), span }
}

/**
 * Spending a point: one more spent, and the next one pushed further away by
 * the NEW count. The order matters -- the step uses the count after the
 * increment, which is what makes the spans 10, 5, 10, 15, 20 ... rather than
 * 10, 0, 5, 10.
 */
export function takeMilestone(threshold: number, pointsSpent: number): { threshold: number; pointsSpent: number } {
  const spent = Math.max(0, Math.floor(pointsSpent)) + 1
  return { threshold: threshold + MILESTONE_STEP * spent, pointsSpent: spent }
}
