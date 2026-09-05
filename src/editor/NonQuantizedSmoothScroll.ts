// Render/menu smooth scroll engine (non-quantized, sub-pixel accurate).
//
// Consumes the shared bell-curve / plateau-clamp / skew math from
// ScrollCurvePlan. See that module for the model documentation.
//
// Each rAF frame independently computes its scrollTop from elapsed time:
//   scrollTop = startPx + sampleScrollPlan(plan, elapsedSec)
//
// This is immune to dropped frames and produces no per-step velocity
// discontinuities at 60+ fps.

import {
  buildScrollPlanFromCurrentParams,
  sampleCurveRampPlan,
  sampleScrollPlan,
} from './ScrollCurvePlan';
import { planScrollJourney, type ScrollJourneyTiming } from './scrollJourney';
import { resolveScrollBridge } from './scrollBridge';

/**
 * Whether the reader has asked for less movement.
 *
 * Answered per call rather than cached: it is an OS-level setting that can be
 * changed while the app is open, and a reader who turns it on mid-session
 * means it from that moment, not from the next launch.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export {
  buildReleaseRampDownPlanFromCurrentParams,
  CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER,
  DEFAULT_RENDER_SCROLL_DYNAMIC,
  DEFAULT_RENDER_SCROLL_MAX_SPEED_PX_PER_SEC,
  DEFAULT_RENDER_SCROLL_RESPONSIVENESS,
  DEFAULT_RENDER_SCROLL_SKEW,
  DEFAULT_RENDER_SCROLL_TOTAL_TIME_SEC,
  deriveRenderScrollDynamicFromResponsiveness,
  deriveRenderScrollResponsivenessFromDynamic,
  RENDER_SCROLL_SKEW_MAX,
  RENDER_SCROLL_SKEW_MIN,
  resolveApexSpeedPxPerSecFromCurrentParams,
  getRenderScrollDynamic,
  getRenderScrollMaxSpeedPxPerSec,
  getRenderScrollResponsiveness,
  getRenderScrollSkew,
  getRenderScrollTotalTimeSec,
  sampleReleaseRampDownPlan,
  resolveRampCrossingTimeSecFromCurrentParams,
  setRenderScrollDynamic,
  setRenderScrollMaxSpeedPxPerSec,
  setRenderScrollResponsiveness,
  setRenderScrollSkew,
  setRenderScrollTotalTimeSec,
} from './ScrollCurvePlan';

interface NonQuantizedSmoothScrollOptions {
  onStep?: () => void;
  /**
   * The distance to plan the journey's SHAPE from, when the real one is not a
   * pixel distance in this scroller.
   *
   * The windowed preview (editorSection/previewWindow.ts) mounts only a few
   * screenfuls at a time, so a destination twenty thousand blocks away is
   * simply not in its scroll space -- `targetScrollTopPx` can only be the far
   * edge of the current window. Left to itself this would read that as a short
   * hop and play an uninterrupted curve, when what the reader asked for was a
   * journey across the document. This says how far they actually asked to go.
   * It chooses the curve and the bridge; it never places anything.
   */
  journeyDistancePx?: number;
  /**
   * Called once, at the moment the curtain fully covers the pane.
   *
   * For a caller whose destination does not exist in the scroller's current
   * space and has to put it there -- the windowed preview re-anchors its
   * window here, which is precisely the substitution the bridge exists to
   * hide. Returns the scroll position the journey should now be landing on,
   * or null to keep the original target.
   */
  onBridgeCut?: () => number | null;
}

interface AnimationState {
  rafId: number;
  targetScrollTopPx: number;
  previousScrollBehavior: string;
  /**
   * Torn down whether the animation finishes or is interrupted.
   *
   * A bridged journey puts a curtain in the DOM for the length of the cut, and
   * the reader is allowed to interrupt a journey at any moment -- so the only
   * safe place for that teardown is here, where every exit path already meets.
   */
  onCancel?: () => void;
}

const activeAnimations = new WeakMap<HTMLElement, AnimationState>();

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const cancelExistingAnimation = (scroller: HTMLElement): void => {
  const current = activeAnimations.get(scroller);
  if (!current) return;
  cancelAnimationFrame(current.rafId);
  current.onCancel?.();
  scroller.style.scrollBehavior = current.previousScrollBehavior;
  activeAnimations.delete(scroller);
};

export function cancelNonQuantizedSmoothScroll(scroller: HTMLElement): void {
  cancelExistingAnimation(scroller);
}

/**
 * Whether a curve-driven scroll is currently in flight for `scroller`.
 *
 * Every frame of an in-flight animation recomputes `scrollTop` from the
 * start position and target captured when it was planned, so ANY scroll
 * write from elsewhere is silently discarded on the very next frame and the
 * animation still lands on its own original target. Anything that scrolls
 * this element for its own reasons while a travel animation may be running
 * -- the preview pane's anchor/find landings, which scroll the virtualizer
 * to a block and then correct onto the exact element inside it -- has to
 * wait for this to go false, or its correction is a no-op precisely when it
 * succeeds.
 */
export function isNonQuantizedSmoothScrollActive(scroller: HTMLElement): boolean {
  return activeAnimations.has(scroller);
}

/**
 * Travels to `targetScrollTopPx`.
 *
 * Returns the journey's shape when it was bridged, so a caller that has to
 * move in step with it can -- and null when it was an ordinary curve, an
 * instant landing, or a no-op.
 */
export function scrollToNonQuantizedSmooth(
  scroller: HTMLElement,
  targetScrollTopPx: number,
  options?: NonQuantizedSmoothScrollOptions,
): ScrollJourneyTiming | null {
  // Mutable, because a bridged journey on a windowed pane relocates its own
  // destination at the cut: the scroll space it lands in is not the one it set
  // off from. Everything below reads these rather than capturing them.
  let maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const startPx = clamp(scroller.scrollTop, 0, maxScrollTopPx);
  let targetPx = clamp(targetScrollTopPx, 0, maxScrollTopPx);

  const existing = activeAnimations.get(scroller);
  if (existing && Math.abs(existing.targetScrollTopPx - targetPx) < 0.01) {
    return null;
  }

  cancelExistingAnimation(scroller);

  // How far the reader asked to go, which on a windowed pane is not how far
  // this scroller can carry them -- see `journeyDistancePx`.
  const signedDistance = options?.journeyDistancePx ?? (targetPx - startPx);

  if (Math.abs(signedDistance) < 0.5) {
    scroller.scrollTop = targetPx;
    options?.onStep?.();
    return null;
  }

  if (prefersReducedMotion()) {
    scroller.scrollTop = targetPx;
    options?.onStep?.();
    return null;
  }

  const previousScrollBehavior = scroller.style.scrollBehavior;
  scroller.style.scrollBehavior = 'auto';

  const finish = () => {
    scroller.scrollTop = clamp(targetPx, 0, maxScrollTopPx);
    options?.onStep?.();
    scroller.style.scrollBehavior = previousScrollBehavior;
    activeAnimations.delete(scroller);
  };

  const step = (nextPx: number) => {
    const clamped = clamp(nextPx, 0, maxScrollTopPx);
    if (scroller.scrollTop !== clamped) {
      scroller.scrollTop = clamped;
      options?.onStep?.();
    }
  };

  let onCancel: (() => void) | undefined;
  const keepAnimating = (frame: FrameRequestCallback) => {
    activeAnimations.set(scroller, {
      rafId: requestAnimationFrame(frame),
      targetScrollTopPx: targetPx,
      previousScrollBehavior,
      onCancel,
    });
  };

  // A journey long enough to have a middle worth cutting, on a pane that can
  // cover the cut. Everything else falls through to the plain point-to-point
  // curve below.
  const journey = planScrollJourney(signedDistance);
  const bridge = journey?.kind === 'bridged' ? resolveScrollBridge(scroller) : null;
  const direction: -1 | 1 = signedDistance >= 0 ? 1 : -1;
  const sweepPx = journey?.kind === 'bridged' && bridge
    ? bridge.begin(Math.abs(journey.bridgeDistancePx), direction)
    : null;

  if (journey?.kind === 'bridged' && bridge && sweepPx !== null) {
    // The curtain may sweep further than the plan asked -- it has to be at
    // least a few viewports to cover anything -- so the bridge's own duration
    // comes from what it actually does, not from what it was asked for.
    const bridgeSec = sweepPx / journey.peakSpeedPxPerSec;
    const rampUpSec = journey.rampUp.durationSec;
    const bridgeEndSec = rampUpSec + bridgeSec;
    const totalSec = bridgeEndSec + journey.rampDown.durationSec;

    const afterRampUpPx = startPx + journey.rampUp.signedDistancePx;
    let beforeRampDownPx = targetPx - journey.rampDown.signedDistancePx;
    let jumped = false;
    let startTimeMs: number | null = null;
    onCancel = () => bridge.end();

    const animateJourney = (nowMs: number): void => {
      if (startTimeMs === null) startTimeMs = nowMs;
      const elapsedSec = (nowMs - startTimeMs) / 1000;

      if (elapsedSec >= totalSec) {
        bridge.end();
        finish();
        return;
      }

      if (elapsedSec < rampUpSec) {
        step(startPx + sampleCurveRampPlan(journey.rampUp, elapsedSec));
      } else if (elapsedSec < bridgeEndSec) {
        const travelled = (elapsedSec - rampUpSec) * journey.peakSpeedPxPerSec;
        bridge.advance(travelled);
        // Before the cut the pane is only partly covered, so the real content
        // has to keep moving at the same speed the curtain is -- a frozen
        // strip beside a moving one is more obviously wrong than the cut this
        // is hiding. After the cut the same rule runs backwards from the far
        // end, so the ramp-down starts from exactly where it expects to.
        if (!jumped && bridge.isCovering(travelled)) {
          jumped = true;
          // The pane is fully covered: the one moment a caller may put its
          // destination somewhere else entirely. Re-read the geometry
          // afterwards -- a windowed pane's scroll space is a different size
          // now, and every clamp below depends on it.
          const relocated = options?.onBridgeCut?.();
          if (relocated !== null && relocated !== undefined) {
            maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
            targetPx = clamp(relocated, 0, maxScrollTopPx);
            beforeRampDownPx = targetPx - journey.rampDown.signedDistancePx;
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
  // right here: with the duration ceiling gone, playing the whole distance out
  // would be a scroll measured in seconds, and seconds of unreadable blur.
  // Arriving is the honest answer.
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

    step(startPx + sampleScrollPlan(plan, elapsedMs / 1000));
    keepAnimating(animateFrame);
  };

  keepAnimating(animateFrame);
  return null;
}
