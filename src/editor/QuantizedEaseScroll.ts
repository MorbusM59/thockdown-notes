interface QuantizedEaseScrollOptions {
  lineHeightPx: number;
  durationMs?: number;
  onStep?: () => void;
}

export const DEFAULT_SCROLL_EASE_MULTIPLIER = 1.5;
let scrollEaseMultiplier = DEFAULT_SCROLL_EASE_MULTIPLIER;

export const DEFAULT_SCROLL_DISTANCE_TIME_INFLUENCE = 0.2;
let scrollDistanceTimeInfluence = DEFAULT_SCROLL_DISTANCE_TIME_INFLUENCE;

export const DEFAULT_SCROLL_BASE_DISTANCE_ROWS = 15;
let scrollBaseDistanceRows = DEFAULT_SCROLL_BASE_DISTANCE_ROWS;

export const DEFAULT_SCROLL_MAX_DURATION_MULTIPLIER = 3;
let scrollMaxDurationMultiplier = DEFAULT_SCROLL_MAX_DURATION_MULTIPLIER;

export function setScrollEaseMultiplier(nextMultiplier: number): void {
  if (!Number.isFinite(nextMultiplier) || nextMultiplier <= 0) {
    scrollEaseMultiplier = DEFAULT_SCROLL_EASE_MULTIPLIER;
    return;
  }
  scrollEaseMultiplier = nextMultiplier;
}

export function getScrollEaseMultiplier(): number {
  return scrollEaseMultiplier;
}

export function setScrollDistanceTimeInfluence(nextInfluence: number): void {
  if (!Number.isFinite(nextInfluence)) {
    scrollDistanceTimeInfluence = DEFAULT_SCROLL_DISTANCE_TIME_INFLUENCE;
    return;
  }
  scrollDistanceTimeInfluence = clamp(nextInfluence, 0, 1);
}

export function getScrollDistanceTimeInfluence(): number {
  return scrollDistanceTimeInfluence;
}

export function setScrollBaseDistanceRows(nextBaseDistanceRows: number): void {
  if (!Number.isFinite(nextBaseDistanceRows) || nextBaseDistanceRows <= 0) {
    scrollBaseDistanceRows = DEFAULT_SCROLL_BASE_DISTANCE_ROWS;
    return;
  }
  scrollBaseDistanceRows = nextBaseDistanceRows;
}

export function getScrollBaseDistanceRows(): number {
  return scrollBaseDistanceRows;
}

export function setScrollMaxDurationMultiplier(nextMaxMultiplier: number): void {
  if (!Number.isFinite(nextMaxMultiplier) || nextMaxMultiplier <= 0) {
    scrollMaxDurationMultiplier = DEFAULT_SCROLL_MAX_DURATION_MULTIPLIER;
    return;
  }
  scrollMaxDurationMultiplier = nextMaxMultiplier;
}

export function getScrollMaxDurationMultiplier(): number {
  return scrollMaxDurationMultiplier;
}

const resolveDistanceScaleFactor = (distanceRows: number) => {
  const safeBaseDistanceRows = Math.max(0.0001, scrollBaseDistanceRows);
  const distanceRatio = Math.max(0, distanceRows) / safeBaseDistanceRows;
  const blendedScaleFactor = ((1 - scrollDistanceTimeInfluence) * 1) + (scrollDistanceTimeInfluence * distanceRatio);
  return Math.min(blendedScaleFactor, scrollMaxDurationMultiplier);
};

interface ActiveAnimationState {
  rafId: number;
  targetScrollTopPx: number;
}

const activeAnimations = new WeakMap<HTMLElement, ActiveAnimationState>();

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const quantizeToRow = (valuePx: number, lineHeightPx: number) => (
  Math.round(valuePx / lineHeightPx) * lineHeightPx
);

const easeInOutCubic = (t: number) => (
  t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2
);

const cancelExistingAnimation = (scroller: HTMLElement) => {
  const current = activeAnimations.get(scroller);
  if (!current) return;
  cancelAnimationFrame(current.rafId);
  activeAnimations.delete(scroller);
};

export function cancelQuantizedEaseScroll(scroller: HTMLElement): void {
  cancelExistingAnimation(scroller);
}

const resolveDurationMs = (distanceRows: number, requestedDurationMs?: number) => {
  const applyScaling = (durationMs: number) => {
    const distanceScaleFactor = resolveDistanceScaleFactor(distanceRows);
    const scaledDuration = durationMs * scrollEaseMultiplier * distanceScaleFactor;
    return clamp(Math.round(scaledDuration), 100, 10000);
  };

  if (typeof requestedDurationMs === 'number' && Number.isFinite(requestedDurationMs)) {
    return applyScaling(clamp(Math.round(requestedDurationMs), 100, 1000));
  }

  const baseDurationMs = 220;
  return applyScaling(baseDurationMs);
};

export function scrollToQuantizedEase(
  scroller: HTMLElement,
  targetScrollTopPx: number,
  options: QuantizedEaseScrollOptions,
): void {
  const { lineHeightPx, durationMs, onStep } = options;

  if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0) {
    return;
  }

  const maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const quantizedStartPx = clamp(quantizeToRow(scroller.scrollTop, lineHeightPx), 0, maxScrollTopPx);
  const quantizedTargetPx = clamp(quantizeToRow(targetScrollTopPx, lineHeightPx), 0, maxScrollTopPx);

  const existingAnimation = activeAnimations.get(scroller);
  // If the same quantized destination is already animating, keep that motion.
  // Restarting the same target each update causes visible scrollbar jitter/flicker.
  if (
    existingAnimation &&
    existingAnimation.targetScrollTopPx === quantizedTargetPx
  ) {
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
    scroller.scrollTop = quantizedTargetPx;
    onStep?.();
    cancelExistingAnimation(scroller);
    return;
  }

  cancelExistingAnimation(scroller);

  const direction = quantizedTargetPx > quantizedStartPx ? 1 : -1;
  const immediateKickPx = clamp(
    quantizedStartPx + (direction * lineHeightPx),
    Math.min(quantizedStartPx, quantizedTargetPx),
    Math.max(quantizedStartPx, quantizedTargetPx),
  );

  if (immediateKickPx !== scroller.scrollTop) {
    scroller.scrollTop = immediateKickPx;
    onStep?.();
  }

  if (Math.abs(quantizedTargetPx - immediateKickPx) < 0.01) {
    activeAnimations.delete(scroller);
    return;
  }

  const animationStartPx = immediateKickPx;
  const animatedDistanceRows = Math.abs(quantizedTargetPx - animationStartPx) / lineHeightPx;
  const finalDurationMs = resolveDurationMs(animatedDistanceRows, durationMs);
  let startTimeMs: number | null = null;

  const step = (nowMs: number) => {
    if (startTimeMs === null) {
      startTimeMs = nowMs;
    }

    const elapsedMs = nowMs - startTimeMs;
    const progress = clamp(elapsedMs / finalDurationMs, 0, 1);
    const easedProgress = easeInOutCubic(progress);
    const interpolatedPx = animationStartPx + ((quantizedTargetPx - animationStartPx) * easedProgress);
    const quantizedFramePx = clamp(quantizeToRow(interpolatedPx, lineHeightPx), 0, maxScrollTopPx);

    if (scroller.scrollTop !== quantizedFramePx) {
      scroller.scrollTop = quantizedFramePx;
      onStep?.();
    }

    if (progress >= 1) {
      if (scroller.scrollTop !== quantizedTargetPx) {
        scroller.scrollTop = quantizedTargetPx;
        onStep?.();
      }
      activeAnimations.delete(scroller);
      return;
    }

    const nextRafId = requestAnimationFrame(step);
    activeAnimations.set(scroller, {
      rafId: nextRafId,
      targetScrollTopPx: quantizedTargetPx,
    });
  };

  const rafId = requestAnimationFrame(step);
  activeAnimations.set(scroller, {
    rafId,
    targetScrollTopPx: quantizedTargetPx,
  });
}
