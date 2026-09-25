import {
  AMBIENT_BELL_RAMP_MAX,
  AMBIENT_BELL_RAMP_MIN,
  AMBIENT_RAIN_FIRST_INDEX,
  type AmbientChannelSettings,
  type AmbientSettings,
} from './ambientSound';
import { buildBellEnvelope, warpForSkew } from './smoothCurve';

/** Samples per noise cycle table; the worklet interpolates between them. */
export const NOISE_CYCLE_SAMPLES = 256;

/**
 * One cycle of a noise layer's level modulation, as a table of values in
 * -1..1 over phase 0..1: -1 at both ends (the trough), +1 at the peak. The
 * worklet plays it on repeat at the layer's period and applies it as
 * `1 + modulationAmplitude * value`.
 *
 * Two curves are overlaid and `ramp` (0-1) weighs them:
 * - 0 to 0.5 crossfades from a sine to the gentlest bell
 *   (AMBIENT_BELL_RAMP_MIN) -- sample by sample, `(1 - w) * sine + w * bell`
 *   with `w = ramp / 0.5`, so the step from one curve to the other has no
 *   seam;
 * - 0.5 to 1 is the bell alone, its steepness swept linearly from
 *   AMBIENT_BELL_RAMP_MIN to AMBIENT_BELL_RAMP_MAX. A steep bell holds low
 *   for most of the cycle and swells briefly, which is what a burst was.
 *
 * `shape` places the peak for both curves the same way: the sine's phase
 * goes through the same skew warp the bell uses (smoothCurve.ts's
 * warpForSkew), so moving the peak does not change which curve is which.
 * The bell is the same one the app's scrolling and cursor motion use.
 */
export function buildNoiseCycle(ramp: number, shape: number, sampleCount = NOISE_CYCLE_SAMPLES): Float32Array {
  const boundedRamp = Number.isFinite(ramp) ? Math.max(0, Math.min(1, ramp)) : 0;
  const sineWeight = boundedRamp < 0.5 ? 1 - (boundedRamp / 0.5) : 0;
  const bellRamp = boundedRamp <= 0.5
    ? AMBIENT_BELL_RAMP_MIN
    : AMBIENT_BELL_RAMP_MIN + (((boundedRamp - 0.5) / 0.5) * (AMBIENT_BELL_RAMP_MAX - AMBIENT_BELL_RAMP_MIN));
  const bell = buildBellEnvelope(bellRamp, shape, sampleCount);
  const cycle = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const phase = index / (sampleCount - 1);
    const sine = -Math.cos(2 * Math.PI * warpForSkew(phase, 1, shape));
    cycle[index] = (sineWeight * sine) + ((1 - sineWeight) * ((2 * bell[index]) - 1));
  }
  return cycle;
}

/** One channel as the worklet (public/ambient-generator.js) receives it. */
export type AmbientWorkletChannel = AmbientChannelSettings & {
  /** Which rain output (0-based, after the noise mix) it goes to; -1 for noise. */
  outputIndex: number;
  /** Precomputed modulation cycle (buildNoiseCycle); noise layers only. */
  cycle?: Float32Array;
};

/**
 * The `configure` message's channel list. This is the one place a rain
 * layer's worklet output is decided -- its position among the rain slots --
 * so the worklet, which cannot import this module, never has to know where
 * the rain slots start.
 */
export function toWorkletChannels(settings: AmbientSettings): AmbientWorkletChannel[] {
  return settings.map((channel, index) => (
    channel.kind === 'noise'
      ? { ...channel, outputIndex: -1, cycle: buildNoiseCycle(channel.ramp, channel.shape) }
      : { ...channel, outputIndex: index - AMBIENT_RAIN_FIRST_INDEX }
  ));
}

/**
 * How far away a rain layer sounds. Distance darkens it (a low-pass swept
 * from 18 kHz down to 2.2 kHz), lowers the direct sound and raises the share
 * sent to the reverb, which is what makes the far layers diffuse rather than
 * merely quiet.
 */
export function resolveAmbientRainSpace(distance: number): {
  cutoffHz: number;
  directGain: number;
  reverbSend: number;
} {
  const boundedDistance = Number.isFinite(distance) ? Math.max(0, Math.min(1, distance)) : 0;
  return {
    cutoffHz: 18000 * ((2200 / 18000) ** boundedDistance),
    directGain: 1 - (0.78 * boundedDistance),
    reverbSend: 0.025 + (0.34 * boundedDistance),
  };
}
