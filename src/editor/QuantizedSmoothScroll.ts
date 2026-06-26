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
  sampleScrollPlan,
} from './ScrollCurvePlan';

interface QuantizedSmoothScrollOptions {
  lineHeightPx: number;
  onStep?: () => void;
}

interface AnimationState {
  rafId: number;
  targetScrollTopPx: number;
  previousScrollBehavior: string;
}

const activeAnimations = new WeakMap<HTMLElement, AnimationState>();

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const quantizeToRow = (valuePx: number, lineHeightPx: number) =>
  Math.round(valuePx / lineHeightPx) * lineHeightPx;

const cancelExistingAnimation = (scroller: HTMLElement): void => {
  const current = activeAnimations.get(scroller);
  if (!current) return;
  cancelAnimationFrame(current.rafId);
  scroller.style.scrollBehavior = current.previousScrollBehavior;
  activeAnimations.delete(scroller);
};

export function cancelQuantizedSmoothScroll(scroller: HTMLElement): void {
  cancelExistingAnimation(scroller);
}

export function scrollToQuantizedSmooth(
  scroller: HTMLElement,
  targetScrollTopPx: number,
  options: QuantizedSmoothScrollOptions,
): void {
  const { lineHeightPx, onStep } = options;
  if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0) return;

  const maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const quantizedStartPx = clamp(quantizeToRow(scroller.scrollTop, lineHeightPx), 0, maxScrollTopPx);
  const quantizedTargetPx = clamp(quantizeToRow(targetScrollTopPx, lineHeightPx), 0, maxScrollTopPx);

  const existing = activeAnimations.get(scroller);
  // Same destination already animating: keep current motion to avoid restart jitter.
  if (existing && existing.targetScrollTopPx === quantizedTargetPx) {
    return;
  }

  if (Math.abs(quantizedTargetPx - quantizedStartPx) < 0.01) {
    scroller.scrollTop = quantizedTargetPx;
    onStep?.();
    cancelExistingAnimation(scroller);
    return;
  }

  const distanceRows = Math.abs(quantizedTargetPx - quantizedStartPx) / lineHeightPx;
  if (distanceRows <= 1) {
    // Single-row jumps are snappier as an immediate write than as a curve.
    scroller.scrollTop = quantizedTargetPx;
    onStep?.();
    cancelExistingAnimation(scroller);
    return;
  }

  cancelExistingAnimation(scroller);

  const signedDistance = quantizedTargetPx - quantizedStartPx;
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
      if (scroller.scrollTop !== quantizedTargetPx) {
        scroller.scrollTop = quantizedTargetPx;
        onStep?.();
      }
      scroller.style.scrollBehavior = previousScrollBehavior;
      activeAnimations.delete(scroller);
      return;
    }

    const displacement = sampleScrollPlan(plan, elapsedMs / 1000);
    const quantizedFramePx = clamp(
      quantizeToRow(quantizedStartPx + displacement, lineHeightPx),
      0,
      maxScrollTopPx,
    );

    if (scroller.scrollTop !== quantizedFramePx) {
      scroller.scrollTop = quantizedFramePx;
      onStep?.();
    }

    const nextRafId = requestAnimationFrame(animateFrame);
    activeAnimations.set(scroller, {
      rafId: nextRafId,
      targetScrollTopPx: quantizedTargetPx,
      previousScrollBehavior,
    });
  };

  const rafId = requestAnimationFrame(animateFrame);
  activeAnimations.set(scroller, {
    rafId,
    targetScrollTopPx: quantizedTargetPx,
    previousScrollBehavior,
  });
}
