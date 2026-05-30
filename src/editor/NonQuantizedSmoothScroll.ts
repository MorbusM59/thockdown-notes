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
  getRenderScrollDynamic,
  getRenderScrollMaxSpeedPxPerSec,
  getRenderScrollResponsiveness,
  getRenderScrollSkew,
  getRenderScrollTotalTimeSec,
  sampleScrollPlan,
} from './ScrollCurvePlan';

export {
  CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER,
  DEFAULT_RENDER_SCROLL_DYNAMIC,
  DEFAULT_RENDER_SCROLL_MAX_SPEED_PX_PER_SEC,
  DEFAULT_RENDER_SCROLL_RESPONSIVENESS,
  DEFAULT_RENDER_SCROLL_SKEW,
  DEFAULT_RENDER_SCROLL_TOTAL_TIME_SEC,
  RENDER_SCROLL_SKEW_MAX,
  RENDER_SCROLL_SKEW_MIN,
  resolveApexSpeedPxPerSecFromCurrentParams,
  getRenderScrollDynamic,
  getRenderScrollMaxSpeedPxPerSec,
  getRenderScrollResponsiveness,
  getRenderScrollSkew,
  getRenderScrollTotalTimeSec,
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
let loadFingerprintLogged = false;

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

export function scrollToNonQuantizedSmooth(
  scroller: HTMLElement,
  targetScrollTopPx: number,
  options?: NonQuantizedSmoothScrollOptions,
): void {
  if (!loadFingerprintLogged) {
    loadFingerprintLogged = true;
    console.log('[NonQuantizedSmoothScroll] CDF + plateau-clamp + skew engine active', {
      a: getRenderScrollDynamic(),
      b: getRenderScrollResponsiveness(),
      t: getRenderScrollTotalTimeSec(),
      maxSpeedPxPerSec: getRenderScrollMaxSpeedPxPerSec(),
      skew: getRenderScrollSkew(),
    });
  }

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
