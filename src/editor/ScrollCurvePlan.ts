// Shared scroll curve math used by both render-view smooth scroll
// (NonQuantizedSmoothScroll) and edit-view row-quantized scroll
// (QuantizedSmoothScroll).
//
// Velocity profile:
//   f(x) = 1 / ((1/a) + ((2(x/t) - 1) / b)^2)        for x in [0, t]
//
// A piecewise-linear time warp biases the bell's apex according to `skew`
// while pinning both endpoints (warp(0)=0, warp(t)=t).
//
// A normalized CDF over the warped curve is built by trapezoidal integration.
// Per-frame position is then derived as
//   scrollTop = startPx + signedDistance * CDF(elapsed / t)
//
// A peak-velocity cap (maxSpeed, px/s) is applied via a plateau-clamp: when
// the bell's natural apex velocity would exceed the cap, the engine plays
// the natural ramp-up portion until v = maxSpeed, holds a flat plateau, then
// resumes the bell's natural ramp-down. The plateau length is sized so that
// total distance is preserved EXACTLY.

export const DEFAULT_RENDER_SCROLL_DYNAMIC = 1.5;
export const DEFAULT_RENDER_SCROLL_RESPONSIVENESS = 0.6;
export const DEFAULT_RENDER_SCROLL_TOTAL_TIME_SEC = 0.4;
export const DEFAULT_RENDER_SCROLL_MAX_SPEED_PX_PER_SEC = 6000;
export const DEFAULT_RENDER_SCROLL_SKEW = 0.5;
export const RENDER_SCROLL_SKEW_MIN = 0.1;
export const RENDER_SCROLL_SKEW_MAX = 0.9;
export const CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER = 1.5;

// Fixed internal CDF resolution. Coarse enough to stay cheap, fine enough that
// piecewise-linear sampling never produces visible velocity steps at 60+ fps.
const CDF_SAMPLE_COUNT = 256;

// f(x) = 1 / ((1/a) + ((2(x/t) - 1) / b)^2)
const evaluateCurve = (xSec: number, a: number, b: number, tSec: number): number => {
  const normalized = (2 * (xSec / tSec)) - 1;
  return 1 / ((1 / a) + Math.pow(normalized / b, 2));
};

// Piecewise linear time warp that maps [0, t] -> [0, t] with x = skew*t -> t/2.
// Used to bias the bell's apex while pinning both endpoints (f(0) and f(t)
// remain unchanged because warp(0) = 0 and warp(t) = t).
const warpForSkew = (xSec: number, tSec: number, skew: number): number => {
  const split = skew * tSec;
  const half = tSec * 0.5;
  if (xSec <= split) {
    return split > 0 ? (xSec / split) * half : 0;
  }
  const tail = tSec - split;
  return tail > 0 ? half + ((xSec - split) / tail) * half : tSec;
};

export interface CurvePlan {
  cdf: Float64Array;
  // Per-segment normalized slope. slopes[i] = (cdf[i+1] - cdf[i]) * (N - 1).
  // Equals d(CDF)/dx (with x in [0,1]) within segment i.
  slopes: Float64Array;
  // max(slopes). Peak velocity (px/s) = distance * peakSlope / durationSec.
  peakSlope: number;
}

export const buildCurvePlan = (a: number, b: number, tSec: number, skew: number): CurvePlan => {
  const sampleCount = CDF_SAMPLE_COUNT;
  const weights = new Float64Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    const xSec = (i / (sampleCount - 1)) * tSec;
    const warpedXSec = warpForSkew(xSec, tSec, skew);
    weights[i] = evaluateCurve(warpedXSec, a, b, tSec);
  }

  const cdf = new Float64Array(sampleCount);
  cdf[0] = 0;
  for (let i = 0; i < sampleCount - 1; i += 1) {
    cdf[i + 1] = cdf[i] + ((weights[i] + weights[i + 1]) * 0.5);
  }

  const total = cdf[sampleCount - 1];
  if (!Number.isFinite(total) || total <= 0) {
    for (let i = 0; i < sampleCount; i += 1) {
      cdf[i] = i / (sampleCount - 1);
    }
    const fallbackSlopes = new Float64Array(sampleCount - 1);
    fallbackSlopes.fill(1);
    return { cdf, slopes: fallbackSlopes, peakSlope: 1 };
  }

  for (let i = 0; i < sampleCount; i += 1) {
    cdf[i] = cdf[i] / total;
  }
  cdf[sampleCount - 1] = 1;

  const slopes = new Float64Array(sampleCount - 1);
  let maxStep = 0;
  for (let i = 0; i < sampleCount - 1; i += 1) {
    const step = cdf[i + 1] - cdf[i];
    slopes[i] = step * (sampleCount - 1);
    if (step > maxStep) maxStep = step;
  }
  const peakSlope = maxStep * (sampleCount - 1);
  return { cdf, slopes, peakSlope };
};

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

// Piecewise scroll plan built from a curve plan plus distance + maxSpeed.
//
// If the bell's natural peak velocity is below the cap, the plan is a single
// "bell" phase of duration tSec. Otherwise the plan has three phases:
//   A (rampUp):   bell from x=0 to x=x1, where v(x1) ~= maxSpeed
//   B (plateau):  constant velocity maxSpeed
//   C (rampDown): bell from x=x2 to x=1 (mirror tail; x2=1-x1 only when skew=0.5)
export interface ScrollPlan {
  cdf: Float64Array;
  tSec: number;
  totalDurationSec: number;
  rampUpEndSec: number;
  plateauEndSec: number;
  rampUpEndX: number;
  rampDownStartX: number;
  rampUpEndProgress: number;
  rampUpEndDistance: number;
  plateauSpeedPxPerSec: number;
  signedDistance: number;
  hasPlateau: boolean;
}

export const buildScrollPlan = (
  curve: CurvePlan,
  tSec: number,
  signedDistance: number,
  maxSpeedPxPerSec: number,
): ScrollPlan => {
  const absDistance = Math.abs(signedDistance);
  const { cdf, slopes, peakSlope } = curve;
  const sampleCount = cdf.length;

  const naturalPeakSpeed = (absDistance * peakSlope) / tSec;

  if (naturalPeakSpeed <= maxSpeedPxPerSec || absDistance === 0) {
    return {
      cdf,
      tSec,
      totalDurationSec: tSec,
      rampUpEndSec: tSec,
      plateauEndSec: tSec,
      rampUpEndX: 1,
      rampDownStartX: 1,
      rampUpEndProgress: 1,
      rampUpEndDistance: signedDistance,
      plateauSpeedPxPerSec: 0,
      signedDistance,
      hasPlateau: false,
    };
  }

  const thresholdSlope = (maxSpeedPxPerSec * tSec) / absDistance;

  const lastSegment = sampleCount - 2;
  let iLow = -1;
  for (let i = 0; i <= lastSegment; i += 1) {
    if (slopes[i] >= thresholdSlope) {
      iLow = i;
      break;
    }
  }
  let iHigh = -1;
  for (let i = lastSegment; i >= 0; i -= 1) {
    if (slopes[i] >= thresholdSlope) {
      iHigh = i;
      break;
    }
  }

  if (iLow < 0 || iHigh < 0) {
    return {
      cdf,
      tSec,
      totalDurationSec: tSec,
      rampUpEndSec: tSec,
      plateauEndSec: tSec,
      rampUpEndX: 1,
      rampDownStartX: 1,
      rampUpEndProgress: 1,
      rampUpEndDistance: signedDistance,
      plateauSpeedPxPerSec: 0,
      signedDistance,
      hasPlateau: false,
    };
  }

  const lastIndex = sampleCount - 1;
  const x1 = iLow / lastIndex;
  const x2 = (iHigh + 1) / lastIndex;
  const cdf1 = cdf[iLow];
  const cdf2 = cdf[iHigh + 1];

  const tau1Sec = x1 * tSec;
  const rampDownDurationSec = (1 - x2) * tSec;

  const sign = signedDistance >= 0 ? 1 : -1;
  const rampUpEndDistance = sign * absDistance * cdf1;
  const plateauDistance = absDistance * (cdf2 - cdf1);

  // P = D*(cdf2 - cdf1) / maxSpeed  ->  A + plateau + C = D exactly.
  const plateauSec = plateauDistance / maxSpeedPxPerSec;
  const totalDurationSec = tau1Sec + plateauSec + rampDownDurationSec;

  return {
    cdf,
    tSec,
    totalDurationSec,
    rampUpEndSec: tau1Sec,
    plateauEndSec: tau1Sec + plateauSec,
    rampUpEndX: x1,
    rampDownStartX: x2,
    rampUpEndProgress: cdf1,
    rampUpEndDistance,
    plateauSpeedPxPerSec: maxSpeedPxPerSec,
    signedDistance,
    hasPlateau: true,
  };
};

// Returns signed displacement (px) from the scroll start, given elapsed seconds.
export const sampleScrollPlan = (plan: ScrollPlan, elapsedSec: number): number => {
  if (elapsedSec <= 0) return 0;
  if (elapsedSec >= plan.totalDurationSec) return plan.signedDistance;

  if (!plan.hasPlateau) {
    const progress = sampleCdf(plan.cdf, elapsedSec / plan.tSec);
    return plan.signedDistance * progress;
  }

  if (elapsedSec <= plan.rampUpEndSec) {
    const xNorm = elapsedSec / plan.tSec;
    const progress = sampleCdf(plan.cdf, xNorm);
    return plan.signedDistance * progress;
  }

  if (elapsedSec <= plan.plateauEndSec) {
    const sign = plan.signedDistance >= 0 ? 1 : -1;
    const plateauElapsed = elapsedSec - plan.rampUpEndSec;
    return plan.rampUpEndDistance + sign * plan.plateauSpeedPxPerSec * plateauElapsed;
  }

  const localSec = elapsedSec - plan.plateauEndSec;
  const xNorm = plan.rampDownStartX + (localSec / plan.tSec);
  const progress = sampleCdf(plan.cdf, xNorm);
  return plan.signedDistance * progress;
};

// Shared parameter storage. Both engines read from the same source of truth so
// that bell-curve UX is identical between render and edit views.
let renderScrollDynamic = DEFAULT_RENDER_SCROLL_DYNAMIC;
let renderScrollResponsiveness = DEFAULT_RENDER_SCROLL_RESPONSIVENESS;
let renderScrollTotalTimeSec = DEFAULT_RENDER_SCROLL_TOTAL_TIME_SEC;
let renderScrollMaxSpeedPxPerSec = DEFAULT_RENDER_SCROLL_MAX_SPEED_PX_PER_SEC;
let renderScrollSkew = DEFAULT_RENDER_SCROLL_SKEW;

export function setRenderScrollDynamic(next: number): void {
  renderScrollDynamic = Number.isFinite(next) && next > 0 ? next : DEFAULT_RENDER_SCROLL_DYNAMIC;
}
export function getRenderScrollDynamic(): number { return renderScrollDynamic; }

export function setRenderScrollResponsiveness(next: number): void {
  renderScrollResponsiveness = Number.isFinite(next) && next > 0 ? next : DEFAULT_RENDER_SCROLL_RESPONSIVENESS;
}
export function getRenderScrollResponsiveness(): number { return renderScrollResponsiveness; }

export function setRenderScrollTotalTimeSec(next: number): void {
  renderScrollTotalTimeSec = Number.isFinite(next) && next >= 0 ? next : DEFAULT_RENDER_SCROLL_TOTAL_TIME_SEC;
}
export function getRenderScrollTotalTimeSec(): number { return renderScrollTotalTimeSec; }

export function setRenderScrollMaxSpeedPxPerSec(next: number): void {
  renderScrollMaxSpeedPxPerSec = Number.isFinite(next) && next > 0 ? next : DEFAULT_RENDER_SCROLL_MAX_SPEED_PX_PER_SEC;
}
export function getRenderScrollMaxSpeedPxPerSec(): number { return renderScrollMaxSpeedPxPerSec; }

export function setRenderScrollSkew(next: number): void {
  renderScrollSkew = Number.isFinite(next)
    ? Math.max(RENDER_SCROLL_SKEW_MIN, Math.min(RENDER_SCROLL_SKEW_MAX, next))
    : DEFAULT_RENDER_SCROLL_SKEW;
}
export function getRenderScrollSkew(): number { return renderScrollSkew; }

// Build a plan straight from the current parameter values.
export const buildScrollPlanFromCurrentParams = (signedDistance: number): ScrollPlan => {
  const a = Math.max(0.0001, renderScrollDynamic);
  const b = Math.max(0.0001, renderScrollResponsiveness);
  const tSec = Math.max(0.0001, renderScrollTotalTimeSec);
  const maxSpeedPxPerSec = Math.max(1, renderScrollMaxSpeedPxPerSec);
  const skew = Math.max(
    RENDER_SCROLL_SKEW_MIN,
    Math.min(RENDER_SCROLL_SKEW_MAX, renderScrollSkew),
  );
  const curve = buildCurvePlan(a, b, tSec, skew);
  return buildScrollPlan(curve, tSec, signedDistance, maxSpeedPxPerSec);
};

// Returns elapsed seconds from animation start to the first point where the
// bell ramp reaches targetSpeedPxPerSec, using current params. If the target
// speed is never reached for this distance/curve, falls back to the bell apex
// timing (tSec * skew), i.e. handoff at max natural speed.
export const resolveRampCrossingTimeSecFromCurrentParams = (
  signedDistance: number,
  targetSpeedPxPerSec: number,
): number | null => {
  const absDistance = Math.abs(signedDistance);
  if (absDistance <= 0.0001) return null;

  const a = Math.max(0.0001, renderScrollDynamic);
  const b = Math.max(0.0001, renderScrollResponsiveness);
  const tSec = Math.max(0.0001, renderScrollTotalTimeSec);
  const skew = Math.max(
    RENDER_SCROLL_SKEW_MIN,
    Math.min(RENDER_SCROLL_SKEW_MAX, renderScrollSkew),
  );
  const apexTimeSec = tSec * skew;
  const curve = buildCurvePlan(a, b, tSec, skew);

  const effectiveTargetSpeed = Math.max(0, targetSpeedPxPerSec);
  if (effectiveTargetSpeed <= 0) return 0;

  const naturalPeakSpeed = (absDistance * curve.peakSlope) / tSec;
  if (naturalPeakSpeed < effectiveTargetSpeed) {
    return apexTimeSec;
  }

  const thresholdSlope = (effectiveTargetSpeed * tSec) / absDistance;
  let iLow = -1;
  for (let i = 0; i < curve.slopes.length; i += 1) {
    if (curve.slopes[i] >= thresholdSlope) {
      iLow = i;
      break;
    }
  }

  if (iLow < 0) return apexTimeSec;

  const lastIndex = curve.cdf.length - 1;
  const x = iLow / Math.max(1, lastIndex);
  return x * tSec;
};

// Returns the natural (unclamped) bell apex speed for this distance using
// current curve parameters.
export const resolveApexSpeedPxPerSecFromCurrentParams = (signedDistance: number): number => {
  const absDistance = Math.abs(signedDistance);
  if (absDistance <= 0.0001) return 0;

  const a = Math.max(0.0001, renderScrollDynamic);
  const b = Math.max(0.0001, renderScrollResponsiveness);
  const tSec = Math.max(0.0001, renderScrollTotalTimeSec);
  const skew = Math.max(
    RENDER_SCROLL_SKEW_MIN,
    Math.min(RENDER_SCROLL_SKEW_MAX, renderScrollSkew),
  );

  const curve = buildCurvePlan(a, b, tSec, skew);
  return (absDistance * curve.peakSlope) / tSec;
};

export interface ReleaseRampDownPlan {
  cdf: Float64Array;
  tSec: number;
  apexX: number;
  apexProgress: number;
  signedDistanceForFullCurve: number;
  tailDurationSec: number;
}

// Build a post-apex-only decay plan that starts at the bell apex and follows
// the natural bell tail down to zero velocity.
export const buildReleaseRampDownPlanFromCurrentParams = (
  direction: -1 | 1,
  initialSpeedPxPerSec: number,
): ReleaseRampDownPlan | null => {
  const speed = Math.max(0, initialSpeedPxPerSec);
  if (speed <= 0) return null;

  const a = Math.max(0.0001, renderScrollDynamic);
  const b = Math.max(0.0001, renderScrollResponsiveness);
  const tSec = Math.max(0.0001, renderScrollTotalTimeSec);
  const skew = Math.max(
    RENDER_SCROLL_SKEW_MIN,
    Math.min(RENDER_SCROLL_SKEW_MAX, renderScrollSkew),
  );

  const curve = buildCurvePlan(a, b, tSec, skew);
  const apexX = skew;
  const apexProgress = sampleCdf(curve.cdf, apexX);
  const tailDurationSec = Math.max(0, (1 - apexX) * tSec);
  if (tailDurationSec <= 0.0001) return null;

  const slopeIndex = Math.max(0, Math.min(curve.slopes.length - 1, Math.floor(apexX * curve.slopes.length)));
  const slopeAtApex = Math.max(0.0001, curve.slopes[slopeIndex]);
  const signedDistanceForFullCurve = direction * ((speed * tSec) / slopeAtApex);

  return {
    cdf: curve.cdf,
    tSec,
    apexX,
    apexProgress,
    signedDistanceForFullCurve,
    tailDurationSec,
  };
};

// Returns signed displacement from the release point for the decay plan.
export const sampleReleaseRampDownPlan = (
  plan: ReleaseRampDownPlan,
  elapsedSec: number,
): number => {
  if (elapsedSec <= 0) return 0;

  if (elapsedSec >= plan.tailDurationSec) {
    return plan.signedDistanceForFullCurve * (1 - plan.apexProgress);
  }

  const xNorm = plan.apexX + (elapsedSec / plan.tSec);
  const progress = sampleCdf(plan.cdf, xNorm) - plan.apexProgress;
  return plan.signedDistanceForFullCurve * progress;
};
