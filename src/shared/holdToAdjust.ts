/**
 * Hold-a-button-to-change-a-value, on the app's own motion curve.
 *
 * ## The problem this exists to avoid
 * Press-and-hold adjusters are usually one of two failures. A linear ramp
 * ("+1 every 50ms", or a rate proportional to how long you have held) either
 * takes off so fast that landing on a specific value is luck, or crawls so
 * slowly that crossing the range is a chore -- and tuning the constant only
 * trades one complaint for the other. The common improvement, a two-step
 * "slow for a moment, then fast", just moves the discontinuity somewhere the
 * user can feel it. On top of that, most implementations insert a hold
 * threshold before anything moves, so the control feels dead for the first
 * fraction of a second.
 *
 * ## What this does instead
 * The same shape the app already scrolls with: the leading half of the bell
 * curve in `editor/ScrollCurvePlan`, from rest up to a constant speed, then
 * that speed held for as long as the button is down, and a hard stop on
 * release. Nothing accelerates forever, nothing steps, and the slow part at
 * the beginning is what makes small adjustments land -- press briefly for a
 * nudge, keep holding to cover ground.
 *
 * The curve's RAMP and SHAPE come straight from the reader's own animation
 * settings, unmodified, because they describe a feel that should be the same
 * everywhere motion happens in the app. Only speed needs converting, since a
 * scroll's speed is in pixels and a value's is in whatever the value counts:
 * `holdFullTravelSec` restates the setting as "how long a hold takes to cross
 * the entire range", and everything else follows from that.
 *
 * ## Reuse
 * Nothing here knows about audio, or about any particular control. Give it a
 * range and it produces distances over time; `useHoldToAdjust` binds that to
 * pointer events. Any future value that wants press-and-hold should use these
 * two rather than growing its own timer.
 */
import {
  buildScrollRampUpPlanFromCurrentParams,
  getRenderScrollTotalTimeSec,
  sampleCurveRampPlan,
  type CurveRampPlan,
} from '@thockdown/interaction/ScrollCurvePlan';

/**
 * A hold crosses the whole range in `0.5 + animationSpeed * 5` seconds.
 *
 * The constant is a floor so the fastest animation setting (0, "no easing")
 * still leaves a control that can be aimed rather than one that snaps to an
 * end the instant it is touched. The multiplier is what makes the setting
 * audible here at all: the scroll setting's own range (0-2s) is far shorter
 * than any sensible time to walk a hundred steps, so it is a proportion to
 * scale by, not a duration to copy.
 */
export const HOLD_TRAVEL_BASE_SEC = 0.5;
export const HOLD_TRAVEL_ANIMATION_MULTIPLIER = 2.5;

/** How often a held value is recomputed. Fine enough to read as continuous. */
export const HOLD_TICK_MS = 20;

export function holdFullTravelSec(animationSpeedSec: number = getRenderScrollTotalTimeSec()): number {
  const safeSpeed = Number.isFinite(animationSpeedSec) && animationSpeedSec > 0 ? animationSpeedSec : 0;
  return HOLD_TRAVEL_BASE_SEC + safeSpeed * HOLD_TRAVEL_ANIMATION_MULTIPLIER;
}

export interface HoldRampPlan {
  /**
   * The bell's leading half, rest -> `coastSpeedUnitsPerSec`; null when the
   * reader has turned easing off entirely (animation speed 0), in which case
   * the hold is the constant coast alone. That is the right reading of the
   * setting rather than a fallback: someone who has asked for no easing
   * anywhere has asked for none here too.
   */
  ramp: CurveRampPlan | null;
  rampDurationSec: number;
  /** Units the ramp alone covers before the coast begins. */
  rampTravelUnits: number;
  coastSpeedUnitsPerSec: number;
  /** Seconds to cross `rangeUnits` from a standing start. */
  fullTravelSec: number;
  rangeUnits: number;
}

/**
 * Solve for the coast speed that makes a ramp-then-coast cover `rangeUnits`
 * in exactly `fullTravelSec`.
 *
 * The ramp's duration is fixed by the reader's settings, and the distance it
 * covers is exactly proportional to the speed it ramps up to -- so probing the
 * ramp once at unit speed gives the constant that turns the requirement into
 * one linear equation:
 *
 *     coast * rampUnitsPerSpeed + coast * (fullTravel - rampDuration) = range
 *
 * There is no configuration in which the ramp alone outlasts the whole travel:
 * the ramp runs for `skew * t` with skew at most 0.9, while the travel time is
 * `0.5 + 5t`. So the coast phase is never negative in practice, and clamping it
 * at zero is a guard rather than a behaviour.
 */
export function buildHoldRampPlan(rangeUnits: number, fullTravelSec: number): HoldRampPlan | null {
  if (!(rangeUnits > 0) || !(fullTravelSec > 0)) return null;

  // Probing at unit speed: the ramp's distance is exactly proportional to the
  // speed it climbs to, so one probe yields the constant the equation needs.
  const probe = buildScrollRampUpPlanFromCurrentParams(1, 1);
  const rampDurationSec = probe ? probe.durationSec : 0;
  const rampUnitsPerSpeed = probe ? Math.abs(probe.signedDistancePx) : 0;

  const coastSec = Math.max(0, fullTravelSec - rampDurationSec);
  const denominator = rampUnitsPerSpeed + coastSec;
  if (!(denominator > 0)) return null;

  const coastSpeedUnitsPerSec = rangeUnits / denominator;
  const ramp = probe ? buildScrollRampUpPlanFromCurrentParams(1, coastSpeedUnitsPerSec) : null;

  return {
    ramp,
    rampDurationSec: ramp ? rampDurationSec : 0,
    rampTravelUnits: ramp ? Math.abs(ramp.signedDistancePx) : 0,
    coastSpeedUnitsPerSec,
    fullTravelSec,
    rangeUnits,
  };
}

/**
 * How far the value has travelled, in units, `elapsedSec` into a hold.
 *
 * Unclamped by design: the plan describes a motion, and where that motion runs
 * out of range is the caller's business. Note that the travel is measured from
 * the press, NOT from the bottom of the range -- a hold that starts at 60 has
 * the same curve as one starting at 0 and simply reaches the top sooner, which
 * is what makes the control feel identical wherever it is picked up.
 */
export function sampleHoldTravel(plan: HoldRampPlan, elapsedSec: number): number {
  if (elapsedSec <= 0) return 0;
  if (plan.ramp && elapsedSec <= plan.rampDurationSec) {
    return Math.abs(sampleCurveRampPlan(plan.ramp, elapsedSec));
  }
  return plan.rampTravelUnits + plan.coastSpeedUnitsPerSec * (elapsedSec - plan.rampDurationSec);
}

/**
 * Travel quantized to whole steps -- the value actually applied at a moment.
 *
 * Floored rather than rounded so the readout changes when the motion has
 * genuinely covered a step, not half of one; rounding would make the first
 * step appear before the curve had earned it, which is the very thing the slow
 * opening exists to prevent.
 */
export function quantizeHoldTravel(travelUnits: number, stepUnits: number): number {
  if (!(stepUnits > 0)) return travelUnits;
  return Math.floor(travelUnits / stepUnits) * stepUnits;
}
