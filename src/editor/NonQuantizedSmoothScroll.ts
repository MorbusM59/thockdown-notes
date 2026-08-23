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
  sampleScrollPlan,
} from './ScrollCurvePlan';

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
}

interface AnimationState {
  rafId: number;
  targetScrollTopPx: number;
  previousScrollBehavior: string;
}

const activeAnimations = new WeakMap<HTMLElement, AnimationState>();

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const cancelExistingAnimation = (scroller: HTMLElement): void => {
  const current = activeAnimations.get(scroller);
  if (!current) return;
  cancelAnimationFrame(current.rafId);
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

export function scrollToNonQuantizedSmooth(
  scroller: HTMLElement,
  targetScrollTopPx: number,
  options?: NonQuantizedSmoothScrollOptions,
): void {
  const maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const startPx = clamp(scroller.scrollTop, 0, maxScrollTopPx);
  const targetPx = clamp(targetScrollTopPx, 0, maxScrollTopPx);

  const existing = activeAnimations.get(scroller);
  if (existing && Math.abs(existing.targetScrollTopPx - targetPx) < 0.01) {
    return;
  }

  cancelExistingAnimation(scroller);

  if (Math.abs(targetPx - startPx) < 0.5) {
    scroller.scrollTop = targetPx;
    options?.onStep?.();
    return;
  }

  const signedDistance = targetPx - startPx;
  const plan = buildScrollPlanFromCurrentParams(signedDistance);
  const totalDurationMs = plan.totalDurationSec * 1000;

  const previousScrollBehavior = scroller.style.scrollBehavior;
  scroller.style.scrollBehavior = 'auto';

  let startTimeMs: number | null = null;

  const animateFrame = (nowMs: number): void => {
    if (startTimeMs === null) {
      startTimeMs = nowMs;
    }

    const elapsedMs = nowMs - startTimeMs;

    if (elapsedMs >= totalDurationMs) {
      scroller.scrollTop = clamp(targetPx, 0, maxScrollTopPx);
      options?.onStep?.();
      scroller.style.scrollBehavior = previousScrollBehavior;
      activeAnimations.delete(scroller);
      return;
    }

    const displacement = sampleScrollPlan(plan, elapsedMs / 1000);
    const nextPx = clamp(startPx + displacement, 0, maxScrollTopPx);

    if (scroller.scrollTop !== nextPx) {
      scroller.scrollTop = nextPx;
      options?.onStep?.();
    }

    const nextRafId = requestAnimationFrame(animateFrame);
    activeAnimations.set(scroller, {
      rafId: nextRafId,
      targetScrollTopPx: targetPx,
      previousScrollBehavior,
    });
  };

  const rafId = requestAnimationFrame(animateFrame);
  activeAnimations.set(scroller, {
    rafId,
    targetScrollTopPx: targetPx,
    previousScrollBehavior,
  });
}
