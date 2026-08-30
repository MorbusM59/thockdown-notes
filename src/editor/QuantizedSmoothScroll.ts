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
  /**
   * Re-reads the destination in pixels, once, from underneath the curtain.
   *
   * A jump across a large document is aimed with CM6's ESTIMATED line heights,
   * and arriving is what makes CM6 measure them for real. Measuring the lines
   * ABOVE the destination moves the destination, so the pixel the jump aimed
   * at is not where the text is by the time it gets there.
   *
   * Measured on a 1.1M-character note: a hit aimed at 416,676 was reached
   * exactly -- residual zero -- and the same hit was by then at 399,334. The
   * landing was never inaccurate; the address was stale. A second click, from
   * a document whose heights were now real, went straight to it.
   *
   * So while the pane is fully covered this engine parks on the target, which
   * is what makes CM6 measure the destination, and then asks here for the
   * address those measurements give. Answer from the DOCUMENT POSITION, never
   * from a remembered pixel -- the position is the thing that did not move.
   *
   * The ramp-down keeps its exact shape and duration; only its origin and
   * destination shift, together, and both while there is nothing to see.
   */
  resolveTargetUnderBridge?: () => number | null;
}

/**
 * Frames the parked pane is held for before the destination is re-read.
 *
 * CM6 revises its height map over several frames after a scroll, not on the
 * one that provoked it. Two is what fits inside the shortest curtain there is.
 */
const BRIDGE_MEASURE_FRAMES = 2;

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

  // Refreshed once if the journey re-reads its destination under the curtain:
  // measuring the destination is exactly what changes how tall CM6 believes the
  // document is, and every write after that would otherwise be clamped against
  // a range that no longer exists. Not re-read per frame -- `scrollHeight`
  // forces layout, and this is the scroll path.
  let maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
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

  // Where the journey is actually going. Fixed for everything except a bridged
  // journey that re-reads its destination under the curtain.
  let landingPx = quantizedTargetPx;

  const finish = () => {
    step(landingPx);
    scroller.style.scrollBehavior = previousScrollBehavior;
    activeAnimations.delete(scroller);
  };

  let onCancel: (() => void) | undefined;
  const keepAnimating = (frame: FrameRequestCallback) => {
    activeAnimations.set(scroller, {
      rafId: requestAnimationFrame(frame),
      targetScrollTopPx: landingPx,
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
    let beforeRampDownPx = landingPx - journey.rampDown.signedDistancePx;
    let jumped = false;
    let journeyStartMs: number | null = null;
    onCancel = () => bridge.end();

    // The re-read under the curtain -- park, wait for the measurement, take the
    // answer, resume. Once per journey, and only inside the fully covered
    // stretch, which ends at `sweep - viewport` because the band is a viewport
    // shorter than its own sweep. It refuses to start unless the whole park
    // fits in what remains: a correction that ran out of cover half way would
    // put the snap back on screen, which is what the curtain exists to prevent.
    const coveredEndPx = sweepPx - scroller.clientHeight;
    let parkFramesLeft = -1;
    let parkedAnswerPx: number | null = null;
    let lastFrameMs: number | null = null;
    let retargetSettled = options.resolveTargetUnderBridge === undefined;

    const animateJourney = (nowMs: number): void => {
      if (journeyStartMs === null) journeyStartMs = nowMs;
      const elapsedSec = (nowMs - journeyStartMs) / 1000;
      // Captured BEFORE the overwrite -- the park below needs the interval
      // since the previous frame, not zero.
      const previousFrameMs = lastFrameMs;
      lastFrameMs = nowMs;

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

        if (jumped && !retargetSettled) {
          // How much cover is left, in REAL frames. Deriving this from an
          // assumed 60fps was wrong on the machine it was written for: a
          // journey measured live burned 2 frames of budget per frame and
          // abandoned a park it had already started. The frame the engine
          // actually got is the only honest unit.
          const frameMs = previousFrameMs === null ? 16.7 : Math.max(1, nowMs - previousFrameMs);
          const pxPerFrame = Math.max(1, journey.peakSpeedPxPerSec * (frameMs / 1000));
          const coveredFramesLeft = Math.max(0, coveredEndPx - travelled) / pxPerFrame;
          const coverEnding = !bridge.isCovering(travelled) || coveredFramesLeft < 1;

          if (parkFramesLeft < 0) {
            if (coverEnding) {
              retargetSettled = true;
            } else {
              // Park ON the destination. Nothing short of standing there makes
              // CM6 measure it, and measuring it is the entire point.
              parkFramesLeft = BRIDGE_MEASURE_FRAMES;
              step(landingPx);
              keepAnimating(animateJourney);
              return;
            }
          } else {
            // Once parked, the answer is taken every frame and the best one
            // kept. A park that gave up because it ran out of cover threw away
            // a measurement it had already paid for and landed stale -- an
            // early answer beats no answer, and the whole reason to be here is
            // that the pre-journey address is known to be wrong.
            const answer = options.resolveTargetUnderBridge?.() ?? null;
            if (answer !== null && Number.isFinite(answer)) parkedAnswerPx = answer;
            parkFramesLeft -= 1;

            if (parkFramesLeft > 0 && !coverEnding) {
              keepAnimating(animateJourney);
              return;
            }

            if (parkedAnswerPx !== null) {
              maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
              landingPx = clamp(quantizeScrollTopToRow(parkedAnswerPx, lineHeightPx), 0, maxScrollTopPx);
              beforeRampDownPx = landingPx - journey.rampDown.signedDistancePx;
            }
            retargetSettled = true;
          }
        }

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
