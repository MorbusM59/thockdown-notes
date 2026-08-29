// How a scrollbar-click journey is shaped.
//
// ## The problem with going a long way
//
// A journey across a large document is tens or hundreds of thousands of
// pixels. Travelling all of it means either taking seconds over it, or moving
// so fast that everything between the two ends is an unreadable smear anyway.
// The old answer was a velocity plateau with a duration cap on top, and it had
// a worse failure than either: past 200,000px the plateau swallowed the whole
// curve, so the longest journeys had no easing at all -- they began at full
// speed and stopped dead.
//
// ## What happens instead
//
// The middle is cut, and the cut is covered.
//
//   ramp-up          bridge              ramp-down
//   real scroll      spoof text          real scroll
//   rest -> peak     peak                peak -> rest
//
// The reader sets off, travels through something plausible, and arrives --
// which is what a long journey feels like from the inside. What they never
// see is the part in between, because the scroller does its jump underneath a
// curtain of spoof text moving at the same speed (see the bridge module).
//
// Two things fall out of this that the plateau could not give:
//
//   * the total is ~0.45s whether the jump is 20,000px or 1,200,000px, so
//     nothing needs a duration cap and `maxSpeed` goes back to meaning peak
//     velocity and nothing else;
//   * there is no coasting through geometry nobody has measured. The only
//     scrolling that happens for real is the two ends, and both of those are
//     near a place the reader already is or is about to be.
//
// ## Where the threshold comes from
//
// It is not a tuned number. A journey shorter than ramp-up plus ramp-down has
// no middle to cut, so it is played as an ordinary uninterrupted bell -- which
// is exactly what the existing engine already does well. Longer than that, and
// there is something to cover.

import {
  buildReleaseRampDownPlanFromCurrentParams,
  buildScrollRampUpPlanFromCurrentParams,
  getRenderScrollMaxSpeedPxPerSec,
  type CurveRampPlan,
} from './ScrollCurvePlan';

/**
 * How long the bridge lasts, at its shortest and longest.
 *
 * The floor is what it takes to read as travel rather than as a cut. The
 * ceiling is what it takes before a reader starts waiting rather than
 * arriving. Between them it grows with the logarithm of the distance, so that
 * crossing a whole document feels longer than crossing a fifth of one without
 * ever growing in proportion to it.
 */
export const SCROLL_BRIDGE_MIN_MS = 80;
export const SCROLL_BRIDGE_MAX_MS = 250;

/**
 * The distance, as a multiple of the cut threshold, at which the bridge
 * reaches its longest. Chosen so the growth is spread across the range of
 * journeys that actually occur rather than saturating on the first long one.
 */
export const SCROLL_BRIDGE_FULL_AT_MULTIPLE = 200;

export interface DirectJourney {
  kind: 'direct';
  signedDistancePx: number;
}

export interface BridgedJourney {
  kind: 'bridged';
  signedDistancePx: number;
  /** Played for real, from where the reader is. */
  rampUp: CurveRampPlan;
  /** Played for real, arriving exactly on the target. */
  rampDown: CurveRampPlan;
  /** How long the curtain covers the cut. */
  bridgeDurationSec: number;
  /** How far the curtain travels while it does, at peak speed. */
  bridgeDistancePx: number;
  peakSpeedPxPerSec: number;
}

export type ScrollJourney = DirectJourney | BridgedJourney;

/**
 * What a bridged journey actually did, handed back to whoever asked for it.
 *
 * The bridge's duration is the engine's to report rather than the planner's:
 * a curtain has to sweep at least a few viewports to cover anything, so what
 * it really takes is only known once a pane has been asked. Anything wanting
 * to move in step with the journey -- the scrollbar thumb -- needs the number
 * that happened, not the one that was planned.
 */
export interface ScrollJourneyTiming {
  rampUp: CurveRampPlan;
  rampDown: CurveRampPlan;
  bridgeDurationSec: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * The bridge's duration for a journey `distancePx` long, where `thresholdPx`
 * is the shortest journey that gets one.
 */
export function resolveBridgeDurationMs(distancePx: number, thresholdPx: number): number {
  if (!(thresholdPx > 0) || !(distancePx > thresholdPx)) return SCROLL_BRIDGE_MIN_MS;
  const growth = (SCROLL_BRIDGE_MAX_MS - SCROLL_BRIDGE_MIN_MS) / Math.log2(SCROLL_BRIDGE_FULL_AT_MULTIPLE);
  return clamp(
    SCROLL_BRIDGE_MIN_MS + (growth * Math.log2(distancePx / thresholdPx)),
    SCROLL_BRIDGE_MIN_MS,
    SCROLL_BRIDGE_MAX_MS,
  );
}

/**
 * Shapes a journey of `signedDistancePx`, using the current curve settings.
 *
 * Returns a direct journey when there is no middle worth cutting, in which
 * case the caller should use the ordinary point-to-point engine. Returns null
 * only when the curve settings cannot produce a ramp at all, which the caller
 * should also treat as "travel it directly".
 */
export function planScrollJourney(signedDistancePx: number): ScrollJourney | null {
  const distancePx = Math.abs(signedDistancePx);
  if (!(distancePx > 0)) return { kind: 'direct', signedDistancePx };

  const direction: -1 | 1 = signedDistancePx >= 0 ? 1 : -1;
  const peakSpeedPxPerSec = Math.max(1, getRenderScrollMaxSpeedPxPerSec());

  const rampUp = buildScrollRampUpPlanFromCurrentParams(direction, peakSpeedPxPerSec);
  const rampDownPlan = buildReleaseRampDownPlanFromCurrentParams(direction, peakSpeedPxPerSec);
  if (!rampUp || !rampDownPlan) return null;

  const rampDown: CurveRampPlan = {
    cdf: rampDownPlan.cdf,
    tSec: rampDownPlan.tSec,
    fromX: rampDownPlan.apexX,
    fromProgress: rampDownPlan.apexProgress,
    durationSec: rampDownPlan.tailDurationSec,
    signedDistanceForFullCurve: rampDownPlan.signedDistanceForFullCurve,
    signedDistancePx: rampDownPlan.signedDistanceForFullCurve * (1 - rampDownPlan.apexProgress),
  };

  const thresholdPx = Math.abs(rampUp.signedDistancePx) + Math.abs(rampDown.signedDistancePx);
  if (!(distancePx > thresholdPx)) return { kind: 'direct', signedDistancePx };

  const bridgeDurationSec = resolveBridgeDurationMs(distancePx, thresholdPx) / 1000;

  return {
    kind: 'bridged',
    signedDistancePx,
    rampUp,
    rampDown,
    bridgeDurationSec,
    bridgeDistancePx: direction * peakSpeedPxPerSec * bridgeDurationSec,
    peakSpeedPxPerSec,
  };
}

/**
 * The scroll position the cut lands on: the target, backed off by exactly the
 * ramp-down's own distance, so the ramp-down arrives on the target rather than
 * near it.
 */
export function resolveBridgeLandingPx(journey: BridgedJourney, targetScrollTopPx: number): number {
  return targetScrollTopPx - journey.rampDown.signedDistancePx;
}
