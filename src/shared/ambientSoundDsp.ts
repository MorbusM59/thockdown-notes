import {
  AMBIENT_RAIN_FIRST_INDEX,
  noiseTypeForSlot,
  type AmbientChannelSettings,
  type AmbientNoiseType,
  type AmbientSettings,
} from './ambientSound';
import { buildNoiseCycle } from './ambientNoiseCycle';

/** One channel as the worklet (public/ambient-generator.js) receives it. */
export type AmbientWorkletChannel = AmbientChannelSettings & {
  /** Which rain output (0-based, after the noise mix) it goes to; -1 for noise. */
  outputIndex: number;
  /** Precomputed modulation cycle (buildNoiseCycle); noise layers only. */
  cycle?: Float32Array;
  /** The noise type, from the slot (noiseTypeForSlot); noise layers only. */
  type?: AmbientNoiseType;
  /** The layer's distance resolved (resolveAmbientSpace); noise layers only. */
  space?: AmbientSpace;
  /** The layer's tone slider resolved (resolveNoiseTone); noise layers only. */
  tone?: NoiseTone;
};

/**
 * The `configure` message's channel list. This is the one place a rain
 * layer's worklet output is decided -- its position among the rain slots --
 * so the worklet, which cannot import this module, never has to know where
 * the rain slots start.
 */
export function toWorkletChannels(settings: AmbientSettings): AmbientWorkletChannel[] {
  return settings.map((channel, index): AmbientWorkletChannel => {
    if (channel.kind === 'noise') {
      return {
        ...channel,
        outputIndex: -1,
        cycle: buildNoiseCycle(channel.ramp, channel.shape),
        type: noiseTypeForSlot(index),
        space: resolveAmbientSpace(channel.distance),
        tone: resolveNoiseTone(channel.filter, noiseTypeForSlot(index)),
      };
    }
    if (channel.kind === 'thunder') {
      // Thunder mixes into the noise layers' stereo bus and reverb send, so
      // it has no output of its own; its distance resolves the same way.
      return { ...channel, outputIndex: -1, space: resolveAmbientSpace(channel.distance) };
    }
    return { ...channel, outputIndex: index - AMBIENT_RAIN_FIRST_INDEX };
  });
}

export interface AmbientSpace {
  cutoffHz: number;
  directGain: number;
  reverbSend: number;
}

/**
 * How far away a layer sounds, for rain and noise layers alike. Distance
 * darkens it (a low-pass swept from 18 kHz down to 2.2 kHz), lowers the
 * direct sound and raises the share sent to the reverb, which is what makes
 * the far layers diffuse rather than merely quiet.
 */
export function resolveAmbientSpace(distance: number): AmbientSpace {
  const boundedDistance = Number.isFinite(distance) ? Math.max(0, Math.min(1, distance)) : 0;
  return {
    cutoffHz: 18000 * ((2200 / 18000) ** boundedDistance),
    directGain: 1 - (0.78 * boundedDistance),
    reverbSend: 0.025 + (0.34 * boundedDistance),
  };
}

/**
 * A noise layer's tone slider (`filter`, 0-1), resolved into the filter the
 * worklet runs: a two-pole state-variable filter, low-pass left of centre and
 * high-pass right of it, bypassed at exactly 0.5.
 *
 * Only the audible range is swept, logarithmically, so each step moves the
 * cutoff by the same musical interval: the low-pass from TONE_LOWPASS_FROM_HZ
 * (just below where noise starts to lose air) down to TONE_LOWPASS_TO_HZ,
 * the high-pass from TONE_HIGHPASS_FROM_HZ up to TONE_HIGHPASS_TO_HZ. The old
 * one-pole sweep spent most of its travel where nothing audible happened.
 *
 * Resonance rises with the distance from centre, quadratically, from Q 0.707
 * (flat, no peak) to TONE_RESONANCE_MAX_Q at the ends: the first half of each
 * side only darkens or thins, and the far ends whistle (low-pass) or turn to
 * an airy hiss (high-pass). One slider, and no way to reach a harsh peak on
 * a gentle cutoff.
 *
 * `gain` holds the layer's loudness through the sweep: the power the filter
 * takes out of this noise type's own spectrum, put back (capped at
 * TONE_MAX_GAIN_DB), so the slider changes the colour and not the volume.
 */
export interface NoiseTone {
  mode: 'none' | 'lowpass' | 'highpass';
  cutoffHz: number;
  q: number;
  gain: number;
}

export const TONE_LOWPASS_FROM_HZ = 16000;
export const TONE_LOWPASS_TO_HZ = 150;
export const TONE_HIGHPASS_FROM_HZ = 30;
export const TONE_HIGHPASS_TO_HZ = 3000;
export const TONE_RESONANCE_MAX_Q = 3;
export const TONE_MAX_GAIN_DB = 18;

const FLAT_Q = Math.SQRT1_2;

export function resolveNoiseTone(filter: number, type: AmbientNoiseType): NoiseTone {
  const amount = Number.isFinite(filter) ? Math.max(0, Math.min(1, filter)) : 0.5;
  if (amount === 0.5) return { mode: 'none', cutoffHz: 0, q: FLAT_Q, gain: 1 };
  const reach = Math.abs(amount - 0.5) * 2;
  const mode = amount < 0.5 ? 'lowpass' : 'highpass';
  const cutoffHz = mode === 'lowpass'
    ? TONE_LOWPASS_FROM_HZ * ((TONE_LOWPASS_TO_HZ / TONE_LOWPASS_FROM_HZ) ** reach)
    : TONE_HIGHPASS_FROM_HZ * ((TONE_HIGHPASS_TO_HZ / TONE_HIGHPASS_FROM_HZ) ** reach);
  const q = FLAT_Q + ((TONE_RESONANCE_MAX_Q - FLAT_Q) * reach * reach);
  const kept = filteredPowerShare(mode, cutoffHz, q, type);
  const maxGain = 10 ** (TONE_MAX_GAIN_DB / 20);
  return { mode, cutoffHz, q, gain: Math.min(maxGain, 1 / Math.sqrt(Math.max(1e-12, kept))) };
}

/**
 * The share of a noise type's power a two-pole filter keeps, from its
 * analogue response |H|^2 = 1 / ((1 - x^2)^2 + (x/Q)^2), x = f / cutoff
 * (times x^4 for the high-pass), weighted by the type's spectrum -- white
 * flat, pink 1/f, brown 1/f^2 -- and summed on a log grid over 20 Hz-20 kHz.
 */
function filteredPowerShare(mode: 'lowpass' | 'highpass', cutoffHz: number, q: number, type: AmbientNoiseType): number {
  const steps = 240;
  let total = 0;
  let kept = 0;
  for (let step = 0; step < steps; step += 1) {
    const frequency = 20 * (1000 ** ((step + 0.5) / steps));
    // Power per log-frequency step is spectrum x f: white f, pink 1, brown 1/f.
    const weight = type === 'white' ? frequency : type === 'pink' ? 1 : 1 / frequency;
    const x = frequency / cutoffHz;
    const denominator = ((1 - (x * x)) ** 2) + ((x / q) ** 2);
    const response = mode === 'lowpass' ? 1 / denominator : (x ** 4) / denominator;
    total += weight;
    kept += weight * response;
  }
  return kept / total;
}
