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
/**
 * Default peak scroll velocity.
 *
 * This is the value the Options slider offers as its own default, and it has
 * to be the same number here: this constant is what every fallback path lands
 * on -- a fresh install, a state file written before the setting existed, a
 * non-finite value handed to the setter -- and while it was 6000 those paths
 * silently gave a tenth of the intended speed. Symptom: a scrollbar-click
 * journey of 100,000px took 18 seconds instead of under two.
 */
export const DEFAULT_RENDER_SCROLL_MAX_SPEED_PX_PER_SEC = 80000;

/**
 * The dual meaning of "max speed": it also caps how long a scroll may take.
 *
 * A pure velocity cap says nothing about the worst case, and the worst case is
 * what the reader actually feels -- on a large document the end of the
 * scrollbar is far enough away that even a fast cap leaves a journey measured
 * in seconds. So the same slider sets a duration ceiling of
 * `SCROLL_DURATION_CAP_PX / maxSpeed` seconds: the time it would take to
 * travel 200,000px AT the chosen speed. Winding the speed up therefore
 * shortens the longest possible scroll as well as quickening the ordinary one
 * -- 2 seconds at the slider's maximum of 100,000px/s, 2.5s at the default
 * 80,000.
 *
 * A journey longer than the ceiling is time-compressed rather than clipped:
 * the same curve, played faster, so it still eases in and out. That does mean
 * such a scroll exceeds the nominal max speed -- deliberately. The velocity
 * cap shapes ordinary travel; this bounds the extraordinary kind.
 */
export const SCROLL_DURATION_CAP_PX = 200000;
export const DEFAULT_RENDER_SCROLL_SKEW = 0.5;
export const RENDER_SCROLL_SKEW_MIN = 0.1;
export const RENDER_SCROLL_SKEW_MAX = 0.9;
export const CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER = 1.5;
export const RENDER_SCROLL_RAMP_MIN = 0.1;
export const RENDER_SCROLL_RAMP_MAX = 5;

// Fixed internal CDF resolution. Coarse enough to stay cheap, fine enough that
// piecewise-linear sampling never produces visible velocity steps at 60+ fps.
const CDF_SAMPLE_COUNT = 256;

// f(x) = 1 / ((1/a) + ((2(x/t) - 1) / b)^2)
// Exported so other curve-driven interactions (e.g. CursorClickCurve.ts's
// direct-sampled attack/release envelope, rather than an integrated
// position plan) can reuse the exact same bell shape.
export const evaluateCurve = (xSec: number, a: number, b: number, tSec: number): number => {
  const normalized = (2 * (xSec / tSec)) - 1;
  return 1 / ((1 / a) + Math.pow(normalized / b, 2));
};

// Piecewise linear time warp that maps [0, t] -> [0, t] with x = skew*t -> t/2.
// Used to bias the bell's apex while pinning both endpoints (f(0) and f(t)
// remain unchanged because warp(0) = 0 and warp(t) = t).
export const warpForSkew = (xSec: number, tSec: number, skew: number): number => {
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

// Exported so other curve-driven interactions (e.g. CursorClickCurve.ts)
// can build their own release-ramp-down sampling without duplicating this.
export const sampleCdf = (cdf: Float64Array, progress: number): number => {
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
/**
 * Plays the same plan faster, so it finishes within `capSec`.
 *
 * A uniform scaling of every time in the plan, which sampleScrollPlan below
 * reads back exactly: each of its three branches divides an elapsed time by a
 * plan time, so scaling both leaves the sampled position identical -- the
 * curve's shape, its easing, and its endpoints all survive. Only the plateau
 * speed has to move the other way, since it covers the same distance in less
 * time. Anything here that changes must be checked against that sampler.
 */
export const compressScrollPlanToDuration = (plan: ScrollPlan, capSec: number): ScrollPlan => {
  if (!Number.isFinite(capSec) || capSec <= 0) return plan;
  if (plan.totalDurationSec <= capSec) return plan;

  const scale = capSec / plan.totalDurationSec;
  return {
    ...plan,
    tSec: plan.tSec * scale,
    totalDurationSec: capSec,
    rampUpEndSec: plan.rampUpEndSec * scale,
    plateauEndSec: plan.plateauEndSec * scale,
    plateauSpeedPxPerSec: plan.plateauSpeedPxPerSec / scale,
  };
};

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
let renderScrollTotalTimeSec = DEFAULT_RENDER_SCROLL_TOTAL_TIME_SEC;
let renderScrollMaxSpeedPxPerSec = DEFAULT_RENDER_SCROLL_MAX_SPEED_PX_PER_SEC;
let renderScrollSkew = DEFAULT_RENDER_SCROLL_SKEW;

export function deriveRenderScrollResponsivenessFromDynamic(ramp: number): number {
  const safeRamp = Number.isFinite(ramp) && ramp > 0
    ? Math.max(RENDER_SCROLL_RAMP_MIN, Math.min(RENDER_SCROLL_RAMP_MAX, ramp))
    : DEFAULT_RENDER_SCROLL_DYNAMIC;
  return 1 / (2 * safeRamp);
}

export function deriveRenderScrollDynamicFromResponsiveness(response: number): number {
  const safeResponse = Number.isFinite(response) && response > 0
    ? Math.max(RENDER_SCROLL_RAMP_MIN, Math.min(RENDER_SCROLL_RAMP_MAX, response))
    : DEFAULT_RENDER_SCROLL_RESPONSIVENESS;
  return Math.max(
    RENDER_SCROLL_RAMP_MIN,
    Math.min(RENDER_SCROLL_RAMP_MAX, 1 / (2 * safeResponse)),
  );
}

export function setRenderScrollDynamic(next: number): void {
  if (!Number.isFinite(next) || next <= 0) return;
  renderScrollDynamic = Math.max(RENDER_SCROLL_RAMP_MIN, Math.min(RENDER_SCROLL_RAMP_MAX, next));
}
export function getRenderScrollDynamic(): number { return renderScrollDynamic; }

export function setRenderScrollResponsiveness(next: number): void {
  if (!Number.isFinite(next) || next <= 0) return;
  renderScrollDynamic = deriveRenderScrollDynamicFromResponsiveness(next);
}
export function getRenderScrollResponsiveness(): number {
  return deriveRenderScrollResponsivenessFromDynamic(renderScrollDynamic);
}

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
  const b = Math.max(0.0001, getRenderScrollResponsiveness());
  const tSec = Math.max(0.0001, renderScrollTotalTimeSec);
  const maxSpeedPxPerSec = Math.max(1, renderScrollMaxSpeedPxPerSec);
  const skew = Math.max(
    RENDER_SCROLL_SKEW_MIN,
    Math.min(RENDER_SCROLL_SKEW_MAX, renderScrollSkew),
  );
  const curve = buildCurvePlan(a, b, tSec, skew);
  const plan = buildScrollPlan(curve, tSec, signedDistance, maxSpeedPxPerSec);
  return compressScrollPlanToDuration(plan, SCROLL_DURATION_CAP_PX / maxSpeedPxPerSec);
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
  const b = Math.max(0.0001, getRenderScrollResponsiveness());
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
  const b = Math.max(0.0001, getRenderScrollResponsiveness());
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
  const b = Math.max(0.0001, getRenderScrollResponsiveness());
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

// Velocity/acceleration-continuous continuation curve.
//
// buildScrollPlan above always starts from rest (implicitly, by the bell
// shape) and is built for a single point-to-point hop. When a fresh target
// arrives mid-animation, restarting a fresh bell curve from rest discards
// whatever velocity (and acceleration) the interrupted motion already had,
// which reads as a stutter. A quintic Hermite polynomial instead lets a NEW
// curve start from an arbitrary snapshotted velocity/acceleration and still
// land exactly at a new target, at rest (velocity AND acceleration both
// zero) again, after a fixed duration -- the standard "minimum-jerk" style
// point-to-point blend used for exactly this kind of mid-flight retargeting.
//
// Boundary conditions (t in [0, T], s = t/T in [0,1]):
//   p(0)=0, p(T)=signedDistance, p'(0)=initialVelocity, p'(T)=0,
//   p''(0)=initialAcceleration, p''(T)=0
// solved via the standard quintic Hermite basis functions H0..H5(s), each
// of which is 1 for exactly one of (value, velocity, acceleration) at
// exactly one endpoint and 0 for the other five conditions:
//   H0 = 1-10s^3+15s^4-6s^5   (value @ s=0)
//   H1 = s-6s^3+8s^4-3s^5     (velocity @ s=0)
//   H2 = 0.5s^2-1.5s^3+1.5s^4-0.5s^5   (acceleration @ s=0)
//   H3 = 10s^3-15s^4+6s^5     (value @ s=1)
//   H4 = -4s^3+7s^4-3s^5      (velocity @ s=1)
//   H5 = 0.5s^3-s^4+0.5s^5    (acceleration @ s=1)
// Our boundary values are P0=0, m1=0, c1=0 (value @0, velocity @1,
// acceleration @1 all zero), so only H1, H2, H3 survive: p(t) =
// H1(s)*T*v0 + H2(s)*T^2*a0 + H3(s)*d (the T/T^2 factors convert the
// Hermite tangents, which are derivatives with respect to s, back to real
// derivatives with respect to t).
export interface ContinuationPlan {
  totalDurationSec: number;
  signedDistance: number;
  initialVelocity: number;
  initialAcceleration: number;
}

export const buildContinuationPlan = (
  signedDistance: number,
  initialVelocity: number,
  initialAcceleration: number,
  totalDurationSec: number,
): ContinuationPlan => ({
  totalDurationSec: Math.max(0.0001, totalDurationSec),
  signedDistance,
  initialVelocity,
  initialAcceleration,
});

export const sampleContinuationPlan = (plan: ContinuationPlan, elapsedSec: number): number => {
  const T = plan.totalDurationSec;
  if (elapsedSec <= 0) return 0;
  if (elapsedSec >= T) return plan.signedDistance;

  const s = elapsedSec / T;
  const s2 = s * s;
  const s3 = s2 * s;
  const s4 = s3 * s;
  const s5 = s4 * s;

  const h1 = s - (6 * s3) + (8 * s4) - (3 * s5);
  const h2 = (0.5 * s2) - (1.5 * s3) + (1.5 * s4) - (0.5 * s5);
  const h3 = (10 * s3) - (15 * s4) + (6 * s5);

  return (h1 * T * plan.initialVelocity)
    + (h2 * T * T * plan.initialAcceleration)
    + (h3 * plan.signedDistance);
};

// Central finite-difference estimate of a smooth position sampler's
// instantaneous velocity and acceleration at a point in time -- used to
// snapshot an in-flight animation's motion the instant it's interrupted, so
// buildContinuationPlan above can pick up from it smoothly. Generic over
// any `(elapsedSec) => position` sampler, so it works the same whether the
// interrupted leg was itself a bell-curve step (sampleScrollPlan) or an
// earlier continuation (sampleContinuationPlan) -- splicing composes.
const VELOCITY_ESTIMATE_EPSILON_SEC = 0.001;

export const estimateVelocityAndAcceleration = (
  sample: (elapsedSec: number) => number,
  atElapsedSec: number,
): { velocity: number; acceleration: number } => {
  const h = VELOCITY_ESTIMATE_EPSILON_SEC;
  const pPrev = sample(atElapsedSec - h);
  const pCurr = sample(atElapsedSec);
  const pNext = sample(atElapsedSec + h);
  return {
    velocity: (pNext - pPrev) / (2 * h),
    acceleration: (pNext - (2 * pCurr) + pPrev) / (h * h),
  };
};
