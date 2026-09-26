/**
 * The shape of a noise layer's level over one cycle (its `curve` and `skew`),
 * as a table the worklet plays on repeat. Depends only on smoothCurve.ts.
 */
import { buildBellEnvelope, warpForSkew } from './smoothCurve';

/**
 * The bell's own steepness range (smoothCurve.ts's buildBellEnvelope): the
 * two ends of a noise layer's `ramp`.
 */
export const AMBIENT_BELL_RAMP_MIN = 0.1;
export const AMBIENT_BELL_RAMP_MAX = 5;

/** Samples per noise cycle table; the worklet interpolates between them. */
export const NOISE_CYCLE_SAMPLES = 256;

function sineCycle(sampleCount: number, shape: number): Float32Array {
  const cycle = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const phase = index / (sampleCount - 1);
    cycle[index] = -Math.cos(2 * Math.PI * warpForSkew(phase, 1, shape));
  }
  return cycle;
}

function bellCycle(bellRamp: number, shape: number, sampleCount: number): Float32Array {
  return buildBellEnvelope(bellRamp, shape, sampleCount).map((value) => (2 * value) - 1);
}

/** Geometric interpolation, so equal slider travel is an equal RATIO of steepness. */
function logLerp(from: number, to: number, t: number): number {
  return from * ((to / from) ** t);
}

/**
 * The bell steepness whose cycle is closest to a sine (smallest largest
 * difference, centred shape), found once by search rather than written down,
 * so it follows the bell if smoothCurve.ts's formula ever changes. It is where
 * the two halves of `ramp` meet a sine without a seam. Around 0.75 today.
 */
export const AMBIENT_BELL_RAMP_NEAREST_SINE: number = (() => {
  const sine = sineCycle(NOISE_CYCLE_SAMPLES, 0.5);
  let best = AMBIENT_BELL_RAMP_MIN;
  let bestDistance = Infinity;
  for (let step = 0; step <= 400; step += 1) {
    const candidate = logLerp(AMBIENT_BELL_RAMP_MIN, AMBIENT_BELL_RAMP_MAX, step / 400);
    const bell = bellCycle(candidate, 0.5, NOISE_CYCLE_SAMPLES);
    const distance = Math.max(...Array.from(bell, (value, index) => Math.abs(value - sine[index])));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
})();

/**
 * One cycle of a noise layer's level modulation, as a table of values in
 * -1..1 over phase 0..1: -1 at both ends (the trough), +1 at the peak. The
 * worklet plays it on repeat at the layer's period and applies it as
 * `1 + modulationAmplitude * value`.
 *
 * `ramp` (the layer's `curve`, 0-1) decides how much of the cycle is spent near the top, in one
 * direction across the whole slider, with an exact sine at the middle:
 * - 0 is the broadest bell (AMBIENT_BELL_RAMP_MIN): a plateau that stays
 *   loud and dips briefly;
 * - 0.5 is a sine;
 * - 1 is the steepest bell (AMBIENT_BELL_RAMP_MAX): quiet for most of the
 *   cycle with a short swell, which is what a burst used to be.
 * Each half overlays a bell and the sine, sample by sample, with the sine's
 * weight rising to 1 at the middle while the bell's steepness moves
 * (geometrically) toward the one nearest a sine. Because that bell is almost a
 * sine already, the handover at the middle has no audible seam.
 *
 * `shape` (the layer's `skew`) places the peak for both curves the same way: the sine's phase goes
 * through the bell's own skew warp (smoothCurve.ts's warpForSkew), so moving
 * the peak never changes which curve is playing, and moving `ramp` never
 * moves the peak.
 */
export function buildNoiseCycle(ramp: number, shape: number, sampleCount = NOISE_CYCLE_SAMPLES): Float32Array {
  const bounded = Number.isFinite(ramp) ? Math.max(0, Math.min(1, ramp)) : 0.5;
  const towardSine = bounded <= 0.5 ? bounded / 0.5 : (1 - bounded) / 0.5;
  const bellRamp = bounded <= 0.5
    ? logLerp(AMBIENT_BELL_RAMP_MIN, AMBIENT_BELL_RAMP_NEAREST_SINE, towardSine)
    : logLerp(AMBIENT_BELL_RAMP_MAX, AMBIENT_BELL_RAMP_NEAREST_SINE, towardSine);
  const bell = bellCycle(bellRamp, shape, sampleCount);
  const sine = sineCycle(sampleCount, shape);
  return bell.map((value, index) => ((1 - towardSine) * value) + (towardSine * sine[index]));
}
