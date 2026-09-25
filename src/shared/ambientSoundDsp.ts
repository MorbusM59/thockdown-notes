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
      ? {
        ...channel,
        outputIndex: -1,
        cycle: buildNoiseCycle(channel.ramp, channel.shape),
        type: noiseTypeForSlot(index),
        space: resolveAmbientSpace(channel.distance),
      }
      : { ...channel, outputIndex: index - AMBIENT_RAIN_FIRST_INDEX }
  ));
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
