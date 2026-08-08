// Shared math for the mouse-cursor "click response" effect (Options > Mouse
// Options > click response sliders): left-click tightens the orbit (smaller
// radius, faster spin) and right-click widens it (larger radius, slower
// spin). Both attributes are driven by a single shared "intent" axis
// (0 = neutral, positive = widening, negative = tightening); radius and spin
// each derive their own multiplier from that shared axis via
// axisToRadiusMultiplier / axisToSpinMultiplier below, weighted by the
// "balance" slider.
//
// Every press is handled identically regardless of how long the button is
// actually down for -- a plain mouse click is far too fast for a human to
// reliably distinguish "tap" from "hold" (they're both a handful of
// milliseconds), so that distinction doesn't exist here. A press always
// ATTACKS toward clickMaxSpeed along the bell curve's rising half, holds
// there (SUSTAIN) for as long as the button stays down, then on release
// DECAYS back to exactly 0 along the bell's falling half. clickMinHoldMs
// enforces a floor on how long the internal press lasts even if the
// physical click was shorter than that, so quick real-world clicks still
// produce a felt pulse instead of an imperceptible flicker.
//
// The axis is NOT a position (an accumulated, persistent offset) -- it's a
// deviation that's fully determined by elapsed time within the current
// phase (attack/sustain/release) and always settles to exactly 0. The
// curve-shape math (ramp/skew/duration/maxSpeed sliders) mirrors the
// smooth-scroll engine in ScrollCurvePlan.ts, reusing its exported
// evaluateCurve/warpForSkew primitives directly, sampled as a raw height
// (not integrated into a position) since that height IS the deviation here.

import { evaluateCurve, warpForSkew } from './ScrollCurvePlan';
import {
  CURSOR_CLICK_SKEW_MIN,
  CURSOR_CLICK_SKEW_MAX,
  CURSOR_CLICK_WIDEN_MAX_MULTIPLIER,
  CURSOR_CLICK_TIGHTEN_MIN_MULTIPLIER,
} from '../shared/cursorSettings';

export function clampAxis(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

// The "click speed" slider is really an animation-DURATION slider in
// disguise: the user drags a plain x in [0, 1] (0 = slowest, 1 = fastest)
// and this maps it to an actual duration via f(x) = maxDurationSec *
// (1-x)^3. maxDurationSec is deliberately internal, not a slider -- only
// the shape (cubic falloff) is exposed. The cubic's derivative flattens out
// as x -> 1 (duration -> 0), so equal slider steps produce increasingly
// small duration changes exactly where "faster" needs the finest control,
// instead of a linear slider's coarse steps near zero.
const CURSOR_CLICK_MAX_DURATION_SEC = 2;

export function resolveCursorClickDurationSec(speedX: number): number {
  const clampedX = Math.max(0, Math.min(1, speedX));
  return CURSOR_CLICK_MAX_DURATION_SEC * Math.pow(1 - clampedX, 2);
}

// axis -> a multiplier in [TIGHTEN_MIN, WIDEN_MAX], 1 at axis=0. axis is
// clamped to [-1, 1] here since that's where the deviation bounds live
// (clickMaxSpeed is bounded to that same range).
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

function clampedSkewOf(skew: number): number {
  return Math.max(CURSOR_CLICK_SKEW_MIN, Math.min(CURSOR_CLICK_SKEW_MAX, skew));
}

// Seconds from press-start to the bell's apex -- also where ATTACK ends and
// SUSTAIN begins.
export function cursorClickApexTimeSec(skew: number, durationSec: number): number {
  return Math.max(0.0001, durationSec) * clampedSkewOf(skew);
}

// Normalized bell height at elapsedSec into the curve, in [0, 1] -- peaks at
// exactly 1 at cursorClickApexTimeSec(skew, durationSec) by construction
// (evaluateCurve's own peak, at its warped midpoint, equals exactly `a`).
function normalizedBellHeight(elapsedSec: number, ramp: number, skew: number, durationSec: number): number {
  const a = Math.max(0.0001, ramp);
  const b = 1 / (2 * a);
  const tSec = Math.max(0.0001, durationSec);
  const clampedSkew = clampedSkewOf(skew);
  const warped = warpForSkew(Math.max(0, Math.min(tSec, elapsedSec)), tSec, clampedSkew);
  return evaluateCurve(warped, a, b, tSec) / a;
}

// ATTACK/SUSTAIN: signed deviation while a press is active (real button down
// or still within the enforced clickMinHoldMs floor). Rises from 0 along the
// bell's rising half, reaches exactly clickMaxSpeed at the apex, and stays
// pinned there for as long as the caller keeps calling with a larger
// elapsedSec -- the plateau isn't time-limited here, the caller decides how
// long the press lasts.
export function sampleCursorPressAxis(
  direction: -1 | 1,
  elapsedSec: number,
  ramp: number,
  skew: number,
  durationSec: number,
  maxSpeed: number,
): number {
  const apexTimeSec = cursorClickApexTimeSec(skew, durationSec);
  if (elapsedSec >= apexTimeSec) {
    return direction * maxSpeed;
  }
  return direction * maxSpeed * normalizedBellHeight(elapsedSec, ramp, skew, durationSec);
}

// RELEASE: signed deviation while decaying back to 0 after the button (or
// the enforced minimum hold) lets go. Follows the bell's falling half
// starting from wherever the axis actually was at the moment of release
// (`initialAxis` -- not necessarily clickMaxSpeed, if released before the
// apex was reached), scaled so the decay begins exactly at initialAxis and
// reaches (approximately) 0 by releaseTailDurationSec -- callers should
// treat elapsedSec >= releaseTailDurationSec as "settled, clamp to exactly
// 0" since the underlying bell is asymptotic rather than exactly zero at
// its edges.
export function sampleCursorReleaseAxis(
  initialAxis: number,
  elapsedSec: number,
  ramp: number,
  skew: number,
  durationSec: number,
): number {
  const apexTimeSec = cursorClickApexTimeSec(skew, durationSec);
  // normalizedBellHeight(apexTimeSec, ...) is exactly 1, so this scales the
  // tail's natural shape to start at initialAxis without discontinuity.
  return initialAxis * normalizedBellHeight(apexTimeSec + elapsedSec, ramp, skew, durationSec);
}

export function cursorClickReleaseTailDurationSec(skew: number, durationSec: number): number {
  return Math.max(0, durationSec - cursorClickApexTimeSec(skew, durationSec));
}
