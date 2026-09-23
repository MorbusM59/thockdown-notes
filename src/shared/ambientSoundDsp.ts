import { buildBellEnvelope } from './smoothCurve';

export interface AmbientTextureProfile {
  modulationDepth: number;
  modulationCycleSec: number;
  chaos: number;
  burstRatePerVoice: number;
}

export function resolveAmbientTextureProfile(texture: number): AmbientTextureProfile {
  const amount = Math.max(0, Math.min(1, Number.isFinite(texture) ? texture : 0));
  return {
    modulationDepth: 0.018 + (amount * 0.24),
    modulationCycleSec: 42 - (amount * 39),
    chaos: amount,
    burstRatePerVoice: 0.015 + (amount * amount * 1),
  };
}

export function buildAmbientEnvelopeBank(texture: number): Float32Array[] {
  const amount = Math.max(0, Math.min(1, Number.isFinite(texture) ? texture : 0));
  const ramps = [0.72, 1.08, 1.54, 2.2, 3.1].map((ramp, index) => ramp + (amount * index * 0.22));
  const skews = [0.35, 0.43, 0.5, 0.57, 0.65];
  return ramps.map((ramp, index) => buildBellEnvelope(ramp, skews[index], 96));
}