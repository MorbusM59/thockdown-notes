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

import { evaluateCurve, warpForSkew } from '@thockdown/interaction/ScrollCurvePlan';
import {
  CURSOR_CLICK_SKEW_MIN,
  CURSOR_CLICK_SKEW_MAX,
  CURSOR_CLICK_WIDEN_MAX_MULTIPLIER,
  CURSOR_CLICK_TIGHTEN_MIN_MULTIPLIER,
} from '@thockdown/look/cursorSettings';

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

// --- the twitch ------------------------------------------------------
//
// A completed HOLD gesture (see shared/holdTiming.ts) fires while the button
// is usually still down, so the click response is sitting in SUSTAIN and the
// orbit is parked at its held radius. The twitch is the acknowledgement: one
// brief excursion in the OPPOSITE direction from wherever the hold put it,
// settling back to that same held state rather than to the base radius.
//
// It is a second, independent channel rather than an interruption of the
// press axis, and that is the whole reason it composes: the press keeps
// sustaining underneath, so "back to where it was" needs no bookkeeping --
// the twitch simply finishes at a factor of 1.
//
// Same ramp and shape as the click response, at HALF its duration, because a
// twitch that takes as long as the press response reads as a second gesture
// rather than as a confirmation of the first.

/**
 * The click response's own duration.
 *
 * It was half of it -- a twitch should read as a spike, and half was the
 * reasoned guess. In the app it read as clipped rather than sharp, so the
 * halving was dropped by FEEL, which is the only instrument that can settle
 * a question like this one.
 *
 * The seam stays even though it now returns its argument: this is where that
 * decision lives, and inlining it would leave the next person to re-derive
 * that the two durations are equal on purpose rather than by omission.
 *
 * Not floored away from zero: the speed slider at its maximum means "no
 * animation", and a twitch of zero length should be exactly that rather than
 * a tenth of a millisecond of one. `normalizedBellHeight` guards its own
 * division, so nothing downstream needs the floor.
 */
export function cursorTwitchDurationSec(clickDurationSec: number): number {
  return Math.max(0, clickDurationSec);
}

/**
 * The twitch's RADIUS factor at `elapsedSec`, to multiply on top of whatever
 * the press axis is already doing. 1 at both ends, and at its apex exactly
 * `1 + maxImpact` expanding or `1 / (1 + maxImpact)` contracting -- so the
 * radius reached is the held radius times or divided by that, and the two
 * polarities are exact mirrors of each other rather than merely similar.
 *
 * Radius only: the click response splits itself between radius and spin by
 * the `balance` slider, but a twitch is a spatial punctuation mark and reads
 * as one whether or not the user has balance pushed toward spin.
 */
export function cursorTwitchRadiusMultiplier(
  direction: -1 | 1,
  elapsedSec: number,
  ramp: number,
  skew: number,
  twitchDurationSec: number,
  maxImpact: number,
): number {
  return Math.pow(1 + Math.max(0, maxImpact), direction * zeroEndedBellHeight(elapsedSec, ramp, skew, twitchDurationSec));
}

// The bell is asymptotic, not zero-ended: at the default ramp it stands at
// ~0.098 of its own peak at t=0 and again at t=duration. The press response
// can live with that (it enters from a press and leaves through a decay that
// is cleared once it is small), but the two HOLD channels below both start
// and end at a state they must return to exactly, and a residual tenth of
// their excursion still standing when they are discarded pops visibly. So
// the floor is subtracted and the remainder rescaled: both ends reach
// exactly 0, the apex still reaches exactly 1, and ramp and shape otherwise
// behave exactly as they do for a click.
//
// The higher of the two ends is the floor, because skew makes them unequal;
// taking the lower one would leave the other end negative, which for a
// multiplicative factor means deforming the WRONG WAY for a frame or two
// right at the end.
function zeroEndedBellHeight(elapsedSec: number, ramp: number, skew: number, durationSec: number): number {
  const floor = Math.max(
    normalizedBellHeight(0, ramp, skew, durationSec),
    normalizedBellHeight(durationSec, ramp, skew, durationSec),
  );
  if (floor >= 1) return 0;
  const height = normalizedBellHeight(elapsedSec, ramp, skew, durationSec);
  return Math.max(0, (height - floor) / (1 - floor));
}

// --- the halo, while a hold is running -------------------------------
//
// A twitch says a hold LANDED. This says one is UNDER WAY: the halo swells
// while the gesture is being held, and returns the moment it resolves --
// completed or abandoned, identically, so a hold let go halfway is a halo
// caught halfway rather than a separate animation to design.
//
// Same ramp and shape as everything else here, but timed off the HOLD rather
// than off the speed slider: the curve is stretched so its apex falls exactly
// on the hold's own threshold, which is what makes full extension mean "now"
// and a partial swell mean "not yet". A `skew` of 0.1 puts the apex at a
// tenth of the curve, so the curve is ten times the hold to put it at the
// end -- the stretch is the whole point, not an implementation detail.
//
// The RETURN is not stretched, because it is not measuring anything: it is
// the ordinary click release, which is what a released hold already feels
// like everywhere else in the cursor.

/**
 * How far into its swell the halo is, in [0, 1] -- 0 at the press, exactly 1
 * at `holdSec`, and pinned there for as long as a hold outlives its own
 * threshold (an abandon that has not arrived yet).
 */
export function sampleCursorHoldLevel(
  elapsedSec: number,
  ramp: number,
  skew: number,
  holdSec: number,
): number {
  const clampedSkew = clampedSkewOf(skew);
  // Apex at exactly holdSec: cursorClickApexTimeSec is duration * skew, so
  // the duration that lands it there is holdSec / skew.
  const stretchedDurationSec = Math.max(0.0001, holdSec) / clampedSkew;
  if (elapsedSec >= holdSec) return 1;
  return zeroEndedBellHeight(elapsedSec, ramp, clampedSkew, stretchedDurationSec);
}

/**
 * The swell decaying back after the hold resolved, from wherever it actually
 * got to -- `initialLevel`, which is below 1 for every abandoned hold.
 */
export function sampleCursorHoldReleaseLevel(
  initialLevel: number,
  elapsedSec: number,
  ramp: number,
  skew: number,
  releaseDurationSec: number,
): number {
  const apexTimeSec = cursorClickApexTimeSec(skew, releaseDurationSec);
  return initialLevel * zeroEndedBellHeight(apexTimeSec + elapsedSec, ramp, skew, releaseDurationSec);
}

/**
 * The halo's radius factor at a given swell level: 1 at rest, and exactly
 * `1 + maxImpact` at full extension -- the same slider and the same reach as
 * the twitch's, so the two read as one vocabulary rather than as two effects
 * that happen to share a setting.
 *
 * Linear in the level, deliberately: the level already carries the curve, so
 * anything other than a straight mapping would bend the shape a second time.
 * (The twitch is exponential in ITS level only because it needs expansion and
 * contraction to be exact reciprocals; there is one direction here.)
 */
export function cursorHoldHaloMultiplier(level: number, maxImpact: number): number {
  return 1 + Math.max(0, level) * Math.max(0, maxImpact);
}
