/**
 * The space the ambient layers play in, as a stereo impulse response for the
 * engine's ConvolverNode (src/sound/AmbientSoundEngine.ts). Pure, and built
 * on the main thread whenever the soundscape's space changes.
 *
 * What makes a synthetic reverb read as a place rather than as an effect:
 * - an EXPONENTIAL decay (energy falls a fixed number of decibels per second;
 *   a linear or quadratic fade is not what any space does), reaching -60 dB
 *   at the decay time `size` sets;
 * - a PRE-DELAY before the first reflection, longer in a larger space;
 * - a diffuse BUILD-UP rather than a tail that starts at full density;
 * - a tail that DARKENS as it decays -- air, foliage and soft surfaces absorb
 *   the highs faster than the lows -- set by `damping`;
 * - the two sides DECORRELATED, so the tail surrounds rather than sits in the
 *   middle;
 * - and, for walls, buildings or cliffs, a few DISCRETE ECHOES standing out
 *   of the tail, spaced further apart in a larger space.
 */
import { logLerp, type AmbientSpaceSettings } from './ambientSound';

export const SPACE_DECAY_MIN_SEC = 0.35;
export const SPACE_DECAY_MAX_SEC = 7;
export const SPACE_MAX_LENGTH_SEC = 8;
const TAIL_START_HZ = 14000;
const TAIL_END_BRIGHT_HZ = 12000;
const TAIL_END_DARK_HZ = 350;
const ECHO_COUNT = 7;

/** The decay time (to -60 dB) a space's size gives. */
export function spaceDecaySec(size: number): number {
  return logLerp(SPACE_DECAY_MIN_SEC, SPACE_DECAY_MAX_SEC, Math.max(0, Math.min(1, size)));
}

/** The gap before the first reflection, in seconds. */
export function spacePreDelaySec(size: number): number {
  return 0.003 + (0.045 * Math.max(0, Math.min(1, size)));
}

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function buildAmbientImpulseResponse(
  space: Pick<AmbientSpaceSettings, 'size' | 'damping' | 'echoes'>,
  sampleRate: number,
  seed = 7,
): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const decaySec = spaceDecaySec(space.size);
  const preDelay = Math.round(spacePreDelaySec(space.size) * sampleRate);
  const tailLength = Math.ceil(Math.min(SPACE_MAX_LENGTH_SEC, decaySec * 1.1) * sampleRate);
  const length = preDelay + tailLength;
  const buildUp = Math.max(1, Math.round((0.012 + (0.05 * space.size)) * sampleRate));
  const endHz = logLerp(TAIL_END_BRIGHT_HZ, TAIL_END_DARK_HZ, Math.max(0, Math.min(1, space.damping)));
  const decayPerSample = Math.exp(-6.9078 / (decaySec * sampleRate));
  const random = makeRandom(seed);
  const channels: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(length), new Float32Array(length)];
  let tailEnergy = 0;
  for (const data of channels) {
    let envelope = 1;
    let low = 0;
    let pole = 0;
    for (let index = 0; index < tailLength; index += 1) {
      // The damping low-pass's cutoff falls geometrically over the decay;
      // re-derived every 64 samples, far finer than the change is heard.
      if ((index & 63) === 0) {
        const cutoff = TAIL_START_HZ * ((endHz / TAIL_START_HZ) ** Math.min(1, index / (decaySec * sampleRate)));
        pole = Math.exp((-2 * Math.PI * Math.min(cutoff, sampleRate * 0.45)) / sampleRate);
      }
      low = (pole * low) + ((1 - pole) * ((random() * 2) - 1));
      const x = Math.min(1, index / buildUp);
      const value = low * envelope * x * x * (3 - (2 * x));
      data[preDelay + index] = value;
      tailEnergy += value * value;
      envelope *= decayPerSample;
    }
  }
  const echoes = Math.max(0, Math.min(1, space.echoes));
  if (echoes > 0) {
    // Each echo carries a share of the tail's energy, falling off with its
    // order; alternate echoes lean to alternate sides.
    const spacing = (0.018 + (0.24 * space.size)) * sampleRate;
    const base = echoes * Math.sqrt((tailEnergy / 2) * 0.12);
    for (let order = 0; order < ECHO_COUNT; order += 1) {
      const at = preDelay + Math.round(spacing * ((order + 1) ** 1.25) * (0.85 + (0.3 * random())));
      if (at + 2 >= length) break;
      const level = base * (0.72 ** order) * Math.exp(-6.9078 * ((at - preDelay) / sampleRate) / decaySec);
      const lean = order % 2 === 0 ? [1, 0.55] : [0.55, 1];
      channels.forEach((data, side) => {
        // Softened over three samples: a reflection off a real surface is not a click.
        data[at] += level * lean[side] * 0.5;
        data[at + 1] += level * lean[side];
        data[at + 2] += level * lean[side] * 0.5;
      });
    }
  }
  return channels;
}
