// Edit-view row-quantized smooth scroll engine.
//
// Consumes the same bell-curve / plateau-clamp / skew math used by the
// render-view engine (see ScrollCurvePlan). The only difference is that each
// rAF frame's scrollTop is snapped to the nearest row boundary before being
// written. The final frame always snaps to the exact quantized target so that
// the visible row alignment is preserved regardless of float accumulation.
//
// Distance preservation: the plateau-clamp guarantees the *continuous*
// displacement plan sums to D exactly. Row-quantized output is the nearest
// integer-row sample of that plan, so the arrival row is exact by construction.

import {
  buildScrollPlanFromCurrentParams,
  sampleCurveRampPlan,
  sampleScrollPlan,
} from './ScrollCurvePlan';
import { planScrollJourney, type ScrollJourneyTiming } from './scrollJourney';
import { resolveScrollBridge } from './scrollBridge';

/** See NonQuantizedSmoothScroll's own note: answered per call, not cached. */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface QuantizedSmoothScrollOptions {
  lineHeightPx: number;
  onStep?: () => void;
}

interface AnimationState {
  rafId: number;
  targetScrollTopPx: number;
  previousScrollBehavior: string;
  /** Torn down however the animation ends -- see the render engine's own note. */
  onCancel?: () => void;
}

const activeAnimations = new WeakMap<HTMLElement, AnimationState>();

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Snaps a scroll position onto the row grid.
 *
 * Exported because an instant scroll (the scrollbar's hold-to-snap gesture)
 * has to land on exactly the same grid this module's animations do -- a snap
 * that stopped half a row off would be visibly different from the travel it
 * replaces.
 */
export const quantizeScrollTopToRow = (valuePx: number, lineHeightPx: number) =>
  Math.round(valuePx / lineHeightPx) * lineHeightPx;

const cancelExistingAnimation = (scroller: HTMLElement): void => {
  const current = activeAnimations.get(scroller);
  if (!current) return;
  cancelAnimationFrame(current.rafId);
  current.onCancel?.();
  scroller.style.scrollBehavior = current.previousScrollBehavior;
  activeAnimations.delete(scroller);
};

export function cancelQuantizedSmoothScroll(scroller: HTMLElement): void {
  cancelExistingAnimation(scroller);
}

/** Whether a curve-driven scroll is in flight -- the render engine's twin. */
export function isQuantizedSmoothScrollActive(scroller: HTMLElement): boolean {
  return activeAnimations.has(scroller);
}

/**
 * Travels to `targetScrollTopPx`, on the row grid the whole way.
 *
 * Returns a bridged journey's shape so a caller moving in step with it can --
 * the same contract the render engine's own version has.
 */
export function scrollToQuantizedSmooth(
  scroller: HTMLElement,
  targetScrollTopPx: number,
  options: QuantizedSmoothScrollOptions,
): ScrollJourneyTiming | null {
  const { lineHeightPx, onStep } = options;
  if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0) return null;

  const maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const quantizedStartPx = clamp(quantizeScrollTopToRow(scroller.scrollTop, lineHeightPx), 0, maxScrollTopPx);
  const quantizedTargetPx = clamp(quantizeScrollTopToRow(targetScrollTopPx, lineHeightPx), 0, maxScrollTopPx);

  const existing = activeAnimations.get(scroller);
  // Same destination already animating: keep current motion to avoid restart jitter.
  if (existing && existing.targetScrollTopPx === quantizedTargetPx) {
    return null;
  }

  if (Math.abs(quantizedTargetPx - quantizedStartPx) < 0.01) {
    scroller.scrollTop = quantizedTargetPx;
    onStep?.();
    cancelExistingAnimation(scroller);
    return null;
  }

  const distanceRows = Math.abs(quantizedTargetPx - quantizedStartPx) / lineHeightPx;
  if (distanceRows <= 1) {
    // Single-row jumps are snappier as an immediate write than as a curve.
    scroller.scrollTop = quantizedTargetPx;
    onStep?.();
    cancelExistingAnimation(scroller);
    return null;
  }

  cancelExistingAnimation(scroller);

  if (prefersReducedMotion()) {
    scroller.scrollTop = quantizedTargetPx;
    onStep?.();
    return null;
  }

  const signedDistance = quantizedTargetPx - quantizedStartPx;

  const previousScrollBehavior = scroller.style.scrollBehavior;
  scroller.style.scrollBehavior = 'auto';

  // Every write in this engine goes through here. The row grid is the whole
  // point of the edit view (see editor/rowGridGuard.ts), and a bridged journey
  // writes from three different places -- it would be a matter of time before
  // one of them forgot.
  const step = (nextPx: number) => {
    const onGridPx = clamp(quantizeScrollTopToRow(nextPx, lineHeightPx), 0, maxScrollTopPx);
    if (scroller.scrollTop !== onGridPx) {
      scroller.scrollTop = onGridPx;
      onStep?.();
    }
  };

  const finish = () => {
    step(quantizedTargetPx);
    scroller.style.scrollBehavior = previousScrollBehavior;
    activeAnimations.delete(scroller);
  };

  let onCancel: (() => void) | undefined;
  const keepAnimating = (frame: FrameRequestCallback) => {
    activeAnimations.set(scroller, {
      rafId: requestAnimationFrame(frame),
      targetScrollTopPx: quantizedTargetPx,
      previousScrollBehavior,
      onCancel,
    });
  };

  // The same three-phase journey the render view runs -- see
  // editor/scrollJourney.ts. Nothing about the cut is specific to how the text
  // is laid out; only the grid every write lands on is.
  const journey = planScrollJourney(signedDistance);
  const bridge = journey?.kind === 'bridged' ? resolveScrollBridge(scroller) : null;
  const direction: -1 | 1 = signedDistance >= 0 ? 1 : -1;
  const sweepPx = journey?.kind === 'bridged' && bridge
    ? bridge.begin(Math.abs(journey.bridgeDistancePx), direction)
    : null;

  if (journey?.kind === 'bridged' && bridge && sweepPx !== null) {
    const bridgeSec = sweepPx / journey.peakSpeedPxPerSec;
    const rampUpSec = journey.rampUp.durationSec;
    const bridgeEndSec = rampUpSec + bridgeSec;
    const totalSec = bridgeEndSec + journey.rampDown.durationSec;

    const afterRampUpPx = quantizedStartPx + journey.rampUp.signedDistancePx;
    const beforeRampDownPx = quantizedTargetPx - journey.rampDown.signedDistancePx;
    let jumped = false;
    let journeyStartMs: number | null = null;
    onCancel = () => bridge.end();

    const animateJourney = (nowMs: number): void => {
      if (journeyStartMs === null) journeyStartMs = nowMs;
      const elapsedSec = (nowMs - journeyStartMs) / 1000;

      if (elapsedSec >= totalSec) {
        bridge.end();
        finish();
        return;
      }

      if (elapsedSec < rampUpSec) {
        step(quantizedStartPx + sampleCurveRampPlan(journey.rampUp, elapsedSec));
      } else if (elapsedSec < bridgeEndSec) {
        const travelled = (elapsedSec - rampUpSec) * journey.peakSpeedPxPerSec;
        bridge.advance(travelled);
        if (!jumped && bridge.isCovering(travelled)) jumped = true;
        step(jumped
          ? beforeRampDownPx - (direction * (sweepPx - travelled))
          : afterRampUpPx + (direction * travelled));
      } else {
        bridge.advance(sweepPx);
        step(beforeRampDownPx + sampleCurveRampPlan(journey.rampDown, elapsedSec - bridgeEndSec));
      }

      keepAnimating(animateJourney);
    };

    keepAnimating(animateJourney);
    return {
      rampUp: journey.rampUp,
      rampDown: journey.rampDown,
      bridgeDurationSec: bridgeSec,
    };
  }

  bridge?.end();

  // Planned as bridged, but this pane cannot raise a curtain. No curve is
  // right here: playing the whole distance out would be a scroll measured in
  // seconds, and seconds of unreadable blur. Arriving is the honest answer.
  if (journey?.kind === 'bridged') {
    finish();
    return null;
  }

  const plan = buildScrollPlanFromCurrentParams(signedDistance);
  const totalDurationMs = plan.totalDurationSec * 1000;

  let startTimeMs: number | null = null;

  const animateFrame = (nowMs: number): void => {
    if (startTimeMs === null) {
      startTimeMs = nowMs;
    }

    const elapsedMs = nowMs - startTimeMs;

    if (elapsedMs >= totalDurationMs) {
      finish();
      return;
    }

    step(quantizedStartPx + sampleScrollPlan(plan, elapsedMs / 1000));
    keepAnimating(animateFrame);
  };

  keepAnimating(animateFrame);
  return null;
}
