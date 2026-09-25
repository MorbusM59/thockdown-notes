// Pure bell-curve math shared by scrolling, cursor response, and other
// time-shaped interactions. Callers own parameter values; this module has no
// connection to persisted scroll settings.

// Fixed internal CDF resolution. Coarse enough to stay cheap, fine enough that
// piecewise-linear sampling never produces visible velocity steps at 60+ fps.
const CDF_SAMPLE_COUNT = 256;

// f(x) = 1 / ((1/a) + ((2(x/t) - 1) / b)^2)
// Shared so every curve-driven interaction (scroll plans, CursorClickCurve.ts's
// directly sampled attack/release envelope, the ambient noise cycle's bell)
// uses exactly the same bell shape.
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

// Linear interpolation into a CurvePlan's CDF at `progress` in [0, 1].
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

/**
 * The bell sampled as an amplitude envelope over one event: 0 at both ends,
 * 1 at the apex, which `skew` places (0.5 is centred) and `ramp` sharpens.
 * The raw bell is rescaled from its start value to its peak and smoothstepped
 * so it leaves and returns to its floor with zero slope -- an ambient noise
 * cycle whose level turned a corner at the trough would be heard as a kink.
 */
export function buildBellEnvelope(
  ramp: number,
  skew: number,
  sampleCount = 128,
): Float32Array {
  const a = Math.max(0.0001, ramp);
  const b = 1 / (2 * a);
  const durationSec = 1;
  const start = evaluateCurve(warpForSkew(0, durationSec, skew), a, b, durationSec);
  const peak = evaluateCurve(warpForSkew(skew, durationSec, skew), a, b, durationSec);
  const span = Math.max(Number.EPSILON, peak - start);
  const envelope = new Float32Array(sampleCount);

  for (let i = 0; i < sampleCount; i += 1) {
    const progress = i / (sampleCount - 1);
    const warped = warpForSkew(progress * durationSec, durationSec, skew);
    const raw = evaluateCurve(warped, a, b, durationSec);
    const normalized = Math.max(0, Math.min(1, (raw - start) / span));
    envelope[i] = normalized * normalized * (3 - (2 * normalized));
  }

  envelope[0] = 0;
  envelope[sampleCount - 1] = 0;
  return envelope;
}