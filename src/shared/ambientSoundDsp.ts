import { buildBellEnvelope } from './smoothCurve';

export function buildAmbientEnvelope(ramp: number, shape: number, sampleCount = 128): Float32Array {
  return buildBellEnvelope(ramp, shape, sampleCount);
}

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