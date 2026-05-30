// Render/menu smooth scroll engine.
//
// Honors the user-specified bell curve:
//   f(x) = 1 / ((1/a) + ((2(x/t) - 1) / b)^2)        for x in [0, t]
//
// UX contract:
//   The distance covered per unit time during the animation is proportional to
//   the curve f(x). Equivalently, the *velocity profile* of the scroll is the
//   normalized curve. Total animation duration = t.
//
// Implementation strategy:
//   We pre-build a normalized cumulative distribution (CDF) by integrating
//   f(x) over [0, t] with the trapezoidal rule. Each animation frame computes
//   its own position from elapsed time via CDF lookup:
//
//     progress = elapsedMs / totalMs            // 0..1
//     scrollTop = startPx + (targetPx - startPx) * CDF(progress)
//
//   This guarantees:
//     - per-frame distance is exactly proportional to f at the corresponding x
//     - no per-step velocity discontinuities (the curve is integrated smoothly)
//     - immune to dropped frames: each frame independently re-derives the
//       correct cumulative position from elapsed time, so a long main-thread
//       block just produces one larger jump rather than a "standstill" pattern
//
// Parameters:
//   a (renderScrollDynamic)         curve peak height
//   b (renderScrollResponsiveness)  curve width
//   t (renderScrollTotalTimeSec)    total animation duration (seconds)
//   d (renderScrollSmoothnessSec)   CDF sampling granularity (seconds)
//                                   smaller d = finer integration (visual cap
//                                   enforced via MIN_CDF_SAMPLE_COUNT)

interface NonQuantizedSmoothScrollOptions {
  onStep?: () => void;
}

export const DEFAULT_RENDER_SCROLL_DYNAMIC = 1.5;
export const DEFAULT_RENDER_SCROLL_RESPONSIVENESS = 0.6;
export const DEFAULT_RENDER_SCROLL_TOTAL_TIME_SEC = 0.4;
export const DEFAULT_RENDER_SCROLL_SMOOTHNESS_SEC = 0.1;

const MIN_CDF_SAMPLE_COUNT = 64;

let renderScrollDynamic = DEFAULT_RENDER_SCROLL_DYNAMIC;
let renderScrollResponsiveness = DEFAULT_RENDER_SCROLL_RESPONSIVENESS;
let renderScrollTotalTimeSec = DEFAULT_RENDER_SCROLL_TOTAL_TIME_SEC;
let renderScrollSmoothnessSec = DEFAULT_RENDER_SCROLL_SMOOTHNESS_SEC;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function setRenderScrollDynamic(nextDynamic: number): void {
  renderScrollDynamic = Number.isFinite(nextDynamic) && nextDynamic > 0
    ? nextDynamic
    : DEFAULT_RENDER_SCROLL_DYNAMIC;
}
export function getRenderScrollDynamic(): number { return renderScrollDynamic; }

export function setRenderScrollResponsiveness(nextResponsiveness: number): void {
  renderScrollResponsiveness = Number.isFinite(nextResponsiveness) && nextResponsiveness > 0
    ? nextResponsiveness
    : DEFAULT_RENDER_SCROLL_RESPONSIVENESS;
}
export function getRenderScrollResponsiveness(): number { return renderScrollResponsiveness; }

export function setRenderScrollTotalTimeSec(nextTotalTimeSec: number): void {
  renderScrollTotalTimeSec = Number.isFinite(nextTotalTimeSec) && nextTotalTimeSec > 0
    ? nextTotalTimeSec
    : DEFAULT_RENDER_SCROLL_TOTAL_TIME_SEC;
}
export function getRenderScrollTotalTimeSec(): number { return renderScrollTotalTimeSec; }

export function setRenderScrollSmoothnessSec(nextSmoothnessSec: number): void {
  renderScrollSmoothnessSec = Number.isFinite(nextSmoothnessSec) && nextSmoothnessSec > 0
    ? nextSmoothnessSec
    : DEFAULT_RENDER_SCROLL_SMOOTHNESS_SEC;
}
export function getRenderScrollSmoothnessSec(): number { return renderScrollSmoothnessSec; }

interface AnimationState {
  rafId: number;
  targetScrollTopPx: number;
  previousScrollBehavior: string;
}

const activeAnimations = new WeakMap<HTMLElement, AnimationState>();

let loadFingerprintLogged = false;

// f(x) = 1 / ((1/a) + ((2(x/t) - 1) / b)^2)
const evaluateCurve = (xSec: number, a: number, b: number, tSec: number): number => {
  const normalized = (2 * (xSec / tSec)) - 1;
  return 1 / ((1 / a) + Math.pow(normalized / b, 2));
};

// Build a normalized CDF over x in [0, t]. cdf[0] = 0, cdf[last] = 1.
// Uses the trapezoidal rule for integration. Sample count is the larger of
// MIN_CDF_SAMPLE_COUNT and floor(t/d) + 1, so d acts as a coarser cap.
const buildCurveCdf = (a: number, b: number, tSec: number, dSec: number): Float64Array => {
  const samplesFromD = Math.max(2, Math.floor(tSec / dSec) + 1);
  const sampleCount = Math.max(MIN_CDF_SAMPLE_COUNT, samplesFromD);

  const weights = new Float64Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    const xSec = (i / (sampleCount - 1)) * tSec;
    weights[i] = evaluateCurve(xSec, a, b, tSec);
  }

  const cdf = new Float64Array(sampleCount);
  cdf[0] = 0;
  for (let i = 0; i < sampleCount - 1; i += 1) {
    // Trapezoid area between weights[i] and weights[i+1]; the (1/(n-1))
    // width factor cancels out during normalization, so we omit it.
    cdf[i + 1] = cdf[i] + ((weights[i] + weights[i + 1]) * 0.5);
  }

  const total = cdf[sampleCount - 1];
  if (!Number.isFinite(total) || total <= 0) {
    // Degenerate curve — fall back to linear.
    for (let i = 0; i < sampleCount; i += 1) {
      cdf[i] = i / (sampleCount - 1);
    }
    return cdf;
  }

  for (let i = 0; i < sampleCount; i += 1) {
    cdf[i] = cdf[i] / total;
  }
  cdf[sampleCount - 1] = 1;
  return cdf;
};

// Linear interpolation between adjacent CDF samples.
const sampleCdf = (cdf: Float64Array, progress: number): number => {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const lastIndex = cdf.length - 1;
  const positionF = progress * lastIndex;
  const loIndex = Math.floor(positionF);
  const hiIndex = Math.min(lastIndex, loIndex + 1);
  const frac = positionF - loIndex;
  return cdf[loIndex] + ((cdf[hiIndex] - cdf[loIndex]) * frac);
};

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
    // One-time fingerprint so you can verify the running bundle includes the
    // CDF-integration engine. Remove this line once the issue is resolved.
    console.log('[NonQuantizedSmoothScroll] CDF-integration engine active', {
      a: renderScrollDynamic,
      b: renderScrollResponsiveness,
      t: renderScrollTotalTimeSec,
      d: renderScrollSmoothnessSec,
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

  const a = Math.max(0.0001, renderScrollDynamic);
  const b = Math.max(0.0001, renderScrollResponsiveness);
  const tSec = Math.max(0.0001, renderScrollTotalTimeSec);
  const dSec = Math.max(0.0001, renderScrollSmoothnessSec);

  const cdf = buildCurveCdf(a, b, tSec, dSec);
  const totalDistance = targetPx - startPx;
  const totalDurationMs = tSec * 1000;

  // Defeat any CSS scroll-behavior:smooth on the scroller for the duration of
  // the animation; otherwise the browser re-animates every scrollTop write and
  // overrides our per-frame velocity profile.
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

    const progress = elapsedMs / totalDurationMs;
    const cdfValue = sampleCdf(cdf, progress);
    const nextPx = clamp(startPx + (totalDistance * cdfValue), 0, maxScrollTopPx);

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
