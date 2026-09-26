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
 * Pink noise is Paul Kellet's filter: white, plus five one-pole low-pass
 * stages whose corners are spread over the band, plus a correction stage
 * with a negative pole near the top of it, plus white one sample late.
 * Its coefficients were fitted at PINK_REFERENCE_RATE. So the noise is the
 * same at every rate:
 * - each low stage's corner is kept in hertz (read off its pole at the
 *   reference rate), its pole recomputed for the rate, and its gain scaled
 *   to keep its low-frequency level g / (1 - p);
 * - the correction stage and the two white terms act relative to the top
 *   of the band, so they are kept as they are;
 * - the whole is scaled to the output power the filter has at the
 *   reference rate, computed from its impulse response (pinkPower).
 */
const PINK_REFERENCE_RATE = 44100;
const PINK_LOW_STAGES: ReadonlyArray<readonly [pole: number, gain: number]> = [
  [0.99886, 0.0555179],
  [0.99332, 0.0750759],
  [0.969, 0.153852],
  [0.8665, 0.3104856],
  [0.55, 0.5329522],
];
const PINK_CORRECTION = { pole: -0.7616, gain: -0.016898 };
const PINK_WHITE_GAIN = 0.5362;
const PINK_LATE_WHITE_GAIN = 0.115926;
const PINK_OUTPUT_GAIN = 0.11;

/** Kellet's low stages at `sampleRate` (see PINK_LOW_STAGES). */
function pinkLowStagesAt(sampleRate: number): Array<[number, number]> {
  return PINK_LOW_STAGES.map(([pole, gain]) => {
    const cornerHz = (-Math.log(pole) * PINK_REFERENCE_RATE) / (2 * Math.PI);
    const scaledPole = Math.exp((-2 * Math.PI * cornerHz) / sampleRate);
    return [scaledPole, gain * ((1 - scaledPole) / (1 - pole))];
  });
}

/**
 * The output power of the pink filter for unit-power white input: the sum
 * of its squared impulse response, run until the slowest stage has decayed
 * past any effect on the result.
 */
function pinkPower(stages: ReadonlyArray<readonly [number, number]>): number {
  const slowest = Math.max(...stages.map(([pole]) => pole));
  const length = Math.ceil(Math.log(1e-9) / Math.log(slowest));
  let power = 0;
  for (let n = 0; n < length; n += 1) {
    let h = PINK_CORRECTION.gain * (PINK_CORRECTION.pole ** n);
    for (const [pole, gain] of stages) h += gain * (pole ** n);
    if (n === 0) h += PINK_WHITE_GAIN;
    if (n === 1) h += PINK_LATE_WHITE_GAIN;
    power += h * h;
  }
  return power;
}

const PINK_REFERENCE_POWER = pinkPower(PINK_LOW_STAGES);

/**
 * A live noise generator at `sampleRate`: white, pink (see PINK_LOW_STAGES)
 * or brown (a leaky integrator of white with its corner at BROWN_CORNER_HZ,
 * its gain set so its level is the same at every rate).
 */
export function createNoiseSource(type: AmbientNoiseType, random: () => number, sampleRate: number): () => number {
  const pinkStages = pinkLowStagesAt(sampleRate);
  const pinkState = [0, 0, 0, 0, 0];
  let pinkCorrection = 0;
  let pinkLateWhite = 0;
  const pinkGain = PINK_OUTPUT_GAIN * Math.sqrt(PINK_REFERENCE_POWER / pinkPower(pinkStages));
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
    let sum = (white * PINK_WHITE_GAIN) + pinkLateWhite;
    for (let stage = 0; stage < pinkStages.length; stage += 1) {
      pinkState[stage] = (pinkStages[stage][0] * pinkState[stage]) + (white * pinkStages[stage][1]);
      sum += pinkState[stage];
    }
    pinkCorrection = (PINK_CORRECTION.pole * pinkCorrection) + (white * PINK_CORRECTION.gain);
    pinkLateWhite = white * PINK_LATE_WHITE_GAIN;
    return (sum + pinkCorrection) * pinkGain;
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

/** The RMS every noise layer's loop is brought to before its colour is mixed (noiseLoopGains). */
export const NOISE_LOOP_REFERENCE_RMS = 0.25;

/**
 * The gain that brings each loop's AUDIBLE power -- above 20 Hz, by a
 * one-pole high-pass -- to NOISE_LOOP_REFERENCE_RMS. Brown noise keeps much
 * of its power below hearing, so equalising the raw RMS would leave it
 * quieter than the others; equalised above 20 Hz, a noise layer's colour can
 * move between the three without its loudness jumping. Thunder reads the raw
 * brown loop and does not use these.
 */
export function noiseLoopGains(loops: NoiseLoops, sampleRate: number): Record<AmbientNoiseType, number> {
  const pole = Math.exp((-2 * Math.PI * 20) / sampleRate);
  return Object.fromEntries(AMBIENT_NOISE_TYPES.map((type) => {
    const loop = loops[type];
    let low = 0;
    let power = 0;
    for (let index = 0; index < loop.length; index += 1) {
      low = (pole * low) + ((1 - pole) * loop[index]);
      const high = loop[index] - low;
      power += high * high;
    }
    const rms = Math.sqrt(power / Math.max(1, loop.length));
    return [type, rms > 0 ? NOISE_LOOP_REFERENCE_RMS / rms : 0];
  })) as Record<AmbientNoiseType, number>;
}
