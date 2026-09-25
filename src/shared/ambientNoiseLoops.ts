/**
 * The noise the ambient noise layers are made of, rendered once on the main
 * thread and handed to the AudioWorklet when it is created
 * (src/sound/AmbientSoundEngine.ts, public/ambient-generator.js).
 *
 * A noise layer reads one of these loops rather than generating noise per
 * sample: noise has no features for an ear to recognise, each layer reads
 * from its own offset under its own level cycle, sway and filter, and
 * reading a table is a fraction of the cost of generating it. They are made
 * here rather than in the worklet because the worklet runs on the audio
 * thread, where rendering a few million samples at once would stall
 * everything that thread plays -- the music included -- for longer than a
 * block lasts.
 */
import { AMBIENT_NOISE_TYPES, type AmbientNoiseType } from './ambientSound';

export const NOISE_LOOP_SECONDS = 10;
/** The loop's ends are crossfaded over this long so the loop has no seam. */
export const NOISE_LOOP_CROSSFADE_SECONDS = 0.25;

export type NoiseLoops = Record<AmbientNoiseType, Float32Array>;

/** A seeded linear congruential generator, returning values in 0..1. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Brown noise's corner: below it the leaky integrator is flat, above it
 * falls 6 dB an octave. It is what the original fixed pole of 0.997 gave at
 * 48 kHz; stated as a frequency so the noise is the same at every sample
 * rate -- the fixed pole put it at 4 Hz at 8 kHz, and a test at that rate
 * measured six times the sub-bass the app plays.
 */
const BROWN_CORNER_HZ = 22.9;
/** The original brown step's gain and pole, at 48 kHz; the level is held to theirs. */
const BROWN_REFERENCE = { gain: 0.055, pole: 0.997 };

/**
 * A live noise generator at `sampleRate`: white, pink (Paul Kellet's
 * filter, whose coefficients are for 44.1 kHz and are not rescaled) or
 * brown (a leaky integrator of white with its corner at BROWN_CORNER_HZ,
 * its gain set so its level is the same at every rate).
 */
export function createNoiseSource(type: AmbientNoiseType, random: () => number, sampleRate: number): () => number {
  const pink = [0, 0, 0, 0, 0, 0, 0];
  let brown = 0;
  const brownPole = Math.exp((-2 * Math.PI * BROWN_CORNER_HZ) / sampleRate);
  // A leaky integrator's output power is gain^2 / (1 - pole^2).
  const brownGain = BROWN_REFERENCE.gain * Math.sqrt((1 - (brownPole ** 2)) / (1 - (BROWN_REFERENCE.pole ** 2)));
  return () => {
    const white = (random() * 2) - 1;
    if (type === 'white') return white;
    if (type === 'brown') {
      brown = (brownPole * brown) + (white * brownGain);
      return brown;
    }
    pink[0] = (0.99886 * pink[0]) + (white * 0.0555179);
    pink[1] = (0.99332 * pink[1]) + (white * 0.0750759);
    pink[2] = (0.969 * pink[2]) + (white * 0.153852);
    pink[3] = (0.8665 * pink[3]) + (white * 0.3104856);
    pink[4] = (0.55 * pink[4]) + (white * 0.5329522);
    pink[5] = (-0.7616 * pink[5]) - (white * 0.016898);
    const value = (pink[0] + pink[1] + pink[2] + pink[3] + pink[4] + pink[5] + pink[6] + (white * 0.5362)) * 0.11;
    pink[6] = white * 0.115926;
    return value;
  };
}

/**
 * One seamless loop: NOISE_LOOP_SECONDS of noise whose head is crossfaded,
 * equal-power (the two are unrelated noise), with what follows its tail -- so
 * reading on past the last sample into the first continues the sound it was
 * making. Brown noise is a slow random walk, so a hard seam there would be a
 * step; the crossfade makes the seam one more ordinary step.
 */
export function buildNoiseLoop(type: AmbientNoiseType, sampleRate: number, seed: number): Float32Array {
  const length = Math.round(NOISE_LOOP_SECONDS * sampleRate);
  const fade = Math.round(NOISE_LOOP_CROSSFADE_SECONDS * sampleRate);
  const next = createNoiseSource(type, makeRandom(seed), sampleRate);
  const raw = new Float32Array(length + fade);
  for (let index = 0; index < raw.length; index += 1) raw[index] = next();
  const loop = raw.slice(0, length);
  for (let index = 0; index < fade; index += 1) {
    const t = (index + 0.5) / fade;
    loop[index] = (raw[length + index] * Math.cos(t * Math.PI / 2)) + (raw[index] * Math.sin(t * Math.PI / 2));
  }
  return loop;
}

/** All three loops, each from its own seed. */
export function buildNoiseLoops(sampleRate: number, seed = 1): NoiseLoops {
  return Object.fromEntries(AMBIENT_NOISE_TYPES.map((type, index) => (
    [type, buildNoiseLoop(type, sampleRate, (seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0)]
  ))) as NoiseLoops;
}
