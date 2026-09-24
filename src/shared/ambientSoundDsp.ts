import { buildBellEnvelope } from './smoothCurve';

export function buildAmbientEnvelope(ramp: number, shape: number, sampleCount = 128): Float32Array {
  return buildBellEnvelope(ramp, shape, sampleCount);
}