// Shared math for the mouse-cursor "click response" effect (Options > Mouse
// Options > click response sliders): left-click tightens the orbit (smaller
// radius, faster spin) and right-click widens it (larger radius, slower
// spin). Both attributes are driven by a single shared "intent" axis
// (0 = neutral, positive = widening, negative = tightening); radius and spin
// each derive their own multiplier from that shared axis via
// axisToRadiusMultiplier / axisToSpinMultiplier below, weighted by the
// "balance" slider.
//
// Critical distinction from smooth scrolling: the axis is NOT a position
// (an accumulated, persistent offset) -- it's a velocity-shaped *deviation*
// that always returns to exactly 0 once the current gesture settles, the
// same way a scroll animation's CURRENT SPEED (not its resulting scrollTop)
// rises from 0, peaks, and falls back to 0 over the course of one scroll.
// Concretely: a tap's deviation follows the bell curve's raw height over
// elapsed time (rise then fall, back to 0 by durationSec); holding past the
// point the bell would reach clickMaxSpeed pins the deviation at exactly
// clickMaxSpeed for as long as the button stays down; releasing during that
// hold decays smoothly from clickMaxSpeed back to 0 via the bell's natural
// tail shape. Nothing here ever leaves the cursor permanently offset.
//
// The curve-shape math (ramp/skew/duration/maxSpeed sliders) deliberately
// mirrors the smooth-scroll engine in ScrollCurvePlan.ts, reusing its
// exported generic curve-plan primitives directly -- but where scroll
// integrates the bell into a *position* plan and samples displacement, this
// module samples the same plans' instantaneous *velocity* instead (the
// bell's height, not its area), since that's what "deviation" means here.
// buildCursorReleaseRampDownPlan and resolveCursorRampCrossingTimeSec
// duplicate a small amount of logic from NonQuantizedSmoothScroll/
// ScrollCurvePlan's "FromCurrentParams" variants because those read from
// module-level scroll globals -- this module needs the same shapes driven
// by its own (ramp, skew, durationSec) parameters instead of a shared global.

import {
  buildCurvePlan,
  buildScrollPlan,
  type CurvePlan,
  type ScrollPlan,
} from './ScrollCurvePlan';
import {
  CURSOR_CLICK_SKEW_MIN,
  CURSOR_CLICK_SKEW_MAX,
  CURSOR_CLICK_WIDEN_MAX_MULTIPLIER,
  CURSOR_CLICK_TIGHTEN_MIN_MULTIPLIER,
} from '../shared/cursorSettings';

export function clampAxis(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

// axis -> a multiplier in [TIGHTEN_MIN, WIDEN_MAX], 1 at axis=0. axis is
// clamped to [-1, 1] here since that's where the deviation bounds live
// (clickMaxSpeed/clickStep are bounded to that same range), even though the
// raw sampled velocity is mathematically unbounded.
function axisToMultiplier(axis: number): number {
  const clamped = clampAxis(axis);
  return clamped >= 0
    ? 1 + clamped * (CURSOR_CLICK_WIDEN_MAX_MULTIPLIER - 1)
    : 1 + clamped * (1 - CURSOR_CLICK_TIGHTEN_MIN_MULTIPLIER);
}

export interface CursorClickWeights {
  radiusWeight: number;
  spinWeight: number;
}

// balance in [-1, 1]: -1 = radius only, 0 = both fully ("equally"), +1 =
// spin only. Each weight independently fades from 1 (full effect) to 0 as
// balance moves toward the OTHER attribute's extreme -- it does not stay at
// a fixed 0.5/0.5 split at center, both get the full effect there.
export function resolveCursorClickWeights(balance: number): CursorClickWeights {
  const b = clampAxis(balance);
  return {
    radiusWeight: Math.max(0, Math.min(1, 1 - b)),
    spinWeight: Math.max(0, Math.min(1, 1 + b)),
  };
}

export function axisToRadiusMultiplier(axis: number, radiusWeight: number): number {
  return axisToMultiplier(axis * radiusWeight);
}

// Spin's polarity is inverted relative to radius: widening (axis > 0) slows
// the spin down, tightening (axis < 0) speeds it up.
export function axisToSpinMultiplier(axis: number, spinWeight: number): number {
  return axisToMultiplier(-axis * spinWeight);
}

export function buildCursorCurvePlan(ramp: number, skew: number, durationSec: number): CurvePlan {
  const a = Math.max(0.0001, ramp);
  const b = 1 / (2 * a);
  const tSec = Math.max(0.0001, durationSec);
  const clampedSkew = Math.max(CURSOR_CLICK_SKEW_MIN, Math.min(CURSOR_CLICK_SKEW_MAX, skew));
  return buildCurvePlan(a, b, tSec, clampedSkew);
}

// signedAxisDistance/maxSpeedUnitsPerSec play exactly the role signedDistance/
// maxSpeedPxPerSec do for scroll: they shape how HIGH the tap's velocity
// naturally peaks (proportional to clickStep) and, if that would exceed
// clickMaxSpeed, clip it into a ramp-up/plateau/ramp-down shape that peaks
// at exactly clickMaxSpeed instead -- reusing buildScrollPlan completely
// unmodified. Only the *sampling* differs (velocity, not displacement).
export function buildCursorStepPlan(
  curve: CurvePlan,
  durationSec: number,
  signedAxisDistance: number,
  maxSpeedUnitsPerSec: number,
): ScrollPlan {
  const tSec = Math.max(0.0001, durationSec);
  const maxSpeed = Math.max(0.0001, maxSpeedUnitsPerSec);
  return buildScrollPlan(curve, tSec, signedAxisDistance, maxSpeed);
}

function slopeAtNormalizedX(curve: CurvePlan, xNorm: number): number {
  const lastIndex = curve.slopes.length - 1;
  if (lastIndex < 0) return 0;
  const clampedX = Math.max(0, Math.min(1, xNorm));
  const idx = Math.min(lastIndex, Math.floor(clampedX * curve.slopes.length));
  return curve.slopes[idx];
}

// Instantaneous signed velocity (deviation) at elapsedSec into the plan --
// the bell's height at that instant, not its accumulated area. Rises from 0,
// optionally plateaus at maxSpeed (see buildCursorStepPlan), falls back to
// exactly 0 by plan.totalDurationSec. Needs `curve` (the same CurvePlan
// buildCursorStepPlan was built from) because ScrollPlan itself only retains
// the normalized cdf, not the per-segment slopes this needs.
export function sampleCursorStepPlanVelocity(curve: CurvePlan, plan: ScrollPlan, elapsedSec: number): number {
  if (elapsedSec <= 0 || elapsedSec >= plan.totalDurationSec) return 0;

  const sign = plan.signedDistance >= 0 ? 1 : -1;
  const absDistance = Math.abs(plan.signedDistance);
  if (absDistance <= 0) return 0;

  if (!plan.hasPlateau || elapsedSec <= plan.rampUpEndSec) {
    const xNorm = elapsedSec / plan.tSec;
    return sign * absDistance * slopeAtNormalizedX(curve, xNorm) / plan.tSec;
  }
  if (elapsedSec <= plan.plateauEndSec) {
    return sign * plan.plateauSpeedPxPerSec;
  }
  const localSec = elapsedSec - plan.plateauEndSec;
  const xNorm = plan.rampDownStartX + (localSec / plan.tSec);
  return sign * absDistance * slopeAtNormalizedX(curve, xNorm) / plan.tSec;
}

// Elapsed seconds from tap start to the point where the bell ramp's
// instantaneous speed first reaches targetSpeedUnitsPerSec -- used to
// schedule the handoff from the one-shot tap animation to the continuous
// (pinned-at-clickMaxSpeed) hold, exactly like
// resolveRampCrossingTimeSecFromCurrentParams does for scroll's
// PageUp/PageDown hold. Returns null if the distance is ~0.
export function resolveCursorRampCrossingTimeSec(
  ramp: number,
  skew: number,
  durationSec: number,
  signedAxisDistance: number,
  targetSpeedUnitsPerSec: number,
): number | null {
  const absDistance = Math.abs(signedAxisDistance);
  if (absDistance <= 0.0001) return null;

  const clampedSkew = Math.max(CURSOR_CLICK_SKEW_MIN, Math.min(CURSOR_CLICK_SKEW_MAX, skew));
  const tSec = Math.max(0.0001, durationSec);
  const apexTimeSec = tSec * clampedSkew;
  const curve = buildCursorCurvePlan(ramp, clampedSkew, tSec);

  const effectiveTargetSpeed = Math.max(0, targetSpeedUnitsPerSec);
  if (effectiveTargetSpeed <= 0) return 0;

  const naturalPeakSpeed = (absDistance * curve.peakSlope) / tSec;
  if (naturalPeakSpeed < effectiveTargetSpeed) {
    return apexTimeSec;
  }

  const thresholdSlope = (effectiveTargetSpeed * tSec) / absDistance;
  let iLow = -1;
  for (let i = 0; i < curve.slopes.length; i += 1) {
    if (curve.slopes[i] >= thresholdSlope) {
      iLow = i;
      break;
    }
  }
  if (iLow < 0) return apexTimeSec;

  const lastIndex = curve.cdf.length - 1;
  const x = iLow / Math.max(1, lastIndex);
  return x * tSec;
}

// Post-apex-only decay plan that starts at the bell apex (current hold
// speed) and follows the natural bell tail down to zero, for the release
// (mouseup during continuous hold) ramp-down -- mirrors
// buildReleaseRampDownPlanFromCurrentParams but parameterized instead of
// reading module-level scroll globals, and returns the CurvePlan alongside
// it (needed by sampleCursorReleaseRampDownPlanVelocity below) since the
// scroll version's ReleaseRampDownPlan shape only carries the cdf.
export interface CursorReleaseRampDownPlan {
  curve: CurvePlan;
  tSec: number;
  apexX: number;
  tailDurationSec: number;
  signedDistanceForFullCurve: number;
}

export function buildCursorReleaseRampDownPlan(
  ramp: number,
  skew: number,
  durationSec: number,
  direction: -1 | 1,
  initialSpeedUnitsPerSec: number,
): CursorReleaseRampDownPlan | null {
  const speed = Math.max(0, initialSpeedUnitsPerSec);
  if (speed <= 0) return null;

  const clampedSkew = Math.max(CURSOR_CLICK_SKEW_MIN, Math.min(CURSOR_CLICK_SKEW_MAX, skew));
  const tSec = Math.max(0.0001, durationSec);
  const curve = buildCursorCurvePlan(ramp, clampedSkew, tSec);

  const apexX = clampedSkew;
  const tailDurationSec = Math.max(0, (1 - apexX) * tSec);
  if (tailDurationSec <= 0.0001) return null;

  const slopeIndex = Math.max(0, Math.min(curve.slopes.length - 1, Math.floor(apexX * curve.slopes.length)));
  const slopeAtApex = Math.max(0.0001, curve.slopes[slopeIndex]);
  // Sized so that velocity at elapsedSec=0 (the release instant) equals
  // exactly `speed` -- see sampleCursorReleaseRampDownPlanVelocity.
  const signedDistanceForFullCurve = direction * ((speed * tSec) / slopeAtApex);

  return { curve, tSec, apexX, tailDurationSec, signedDistanceForFullCurve };
}

// Instantaneous signed velocity at elapsedSec since release -- starts at
// exactly the initialSpeedUnitsPerSec the plan was built with, decays along
// the bell's natural tail, reaches exactly 0 by plan.tailDurationSec.
export function sampleCursorReleaseRampDownPlanVelocity(
  plan: CursorReleaseRampDownPlan,
  elapsedSec: number,
): number {
  if (elapsedSec <= 0 || elapsedSec >= plan.tailDurationSec) return 0;

  const sign = plan.signedDistanceForFullCurve >= 0 ? 1 : -1;
  const absDistanceForFullCurve = Math.abs(plan.signedDistanceForFullCurve);
  const xNorm = plan.apexX + (elapsedSec / plan.tSec);
  return sign * absDistanceForFullCurve * slopeAtNormalizedX(plan.curve, xNorm) / plan.tSec;
}

export type { ScrollPlan as CursorClickStepPlan };
