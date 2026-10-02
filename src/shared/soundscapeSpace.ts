/**
 * The space the soundscape layers play in, as a stereo impulse response for the
 * mix's convolution (src/sound/soundscapeMix.ts, partitionedConvolver.ts).
 * Pure, and built in the render worker whenever the soundscape's space
 * changes.
 *
 * What makes a synthetic reverb read as a place rather than as an effect:
 * - an EXPONENTIAL decay (energy falls a fixed number of decibels per second;
 *   a linear or quadratic fade is not what any space does), reaching -60 dB
 *   at the decay time `size` sets;
 * - a PRE-DELAY before the first reflection, longer in a larger space;
 * - a diffuse BUILD-UP rather than a tail that starts at full density;
 * - a tail whose HIGHS DIE FASTER than its lows -- air, foliage and soft
 *   surfaces absorb them -- by the ratio `damping` sets. The tail is split at
 *   DAMPING_CROSSOVER_HZ and the upper band decays up to
 *   1 + DAMPING_MAX_RATIO_EXTRA times faster, from the first sample, so the
 *   difference is in the part of the tail that is actually heard. (It used to
 *   be a low-pass gliding to its darkest only at -60 dB, where nobody hears
 *   it: damping was inaudible from end to end of its slider.)
 * - the two sides DECORRELATED, so the tail surrounds rather than sits in the
 *   middle;
 * - and, for walls, buildings or cliffs, a few DISCRETE ECHOES standing out
 *   of the tail. They begin ECHO_MIN_GAP_SEC after the pre-delay and are at
 *   least that far apart, because reflections closer than about 50 ms do not
 *   read as echoes: summed with a steady sound they fuse into a comb filter,
 *   heard as a hollow, wavering colour. Their level is a gain on the sound
 *   sent to the space (ECHO_MAX_GAIN at the slider's top), not a share of the
 *   tail's energy, so the slider means how strong the wall is. An echo is
 *   heard on a sound with an onset -- a drop, a drip, a strike, thunder --
 *   and not on a steady one, which it only colours.
 *
 * LEVEL. The convolution does not normalise. It replaced a ConvolverNode set
 * to `normalize = false`, because the browser's normalisation rescales every
 * response to one power, which
 * turned a darker tail back up and hid damping. The response is calibrated
 * here instead, once, from its UNDAMPED tail: scaled to the power Chromium's
 * normalisation gave it (SPACE_CALIBRATION), so a space at damping 0 with no
 * echoes is as loud as before, and damping and echoes then change what is
 * heard rather than being rebalanced away.
 */
import { logLerp, type SoundscapeSpaceSettings } from './soundscape';

export const SPACE_DECAY_MIN_SEC = 0.35;
export const SPACE_DECAY_MAX_SEC = 7;
export const SPACE_MAX_LENGTH_SEC = 8;
const DAMPING_CROSSOVER_HZ = 1500;
const DAMPING_MAX_RATIO_EXTRA = 5;
const ECHO_COUNT = 7;
const ECHO_MIN_GAP_SEC = 0.06;
const ECHO_GAP_PER_SIZE_SEC = 0.22;
const ECHO_MAX_GAIN = 0.5;
/**
 * Per-sample RMS of a response as Chromium's ConvolverNode normalisation
 * leaves it (Reverb::CalculateNormalizationScale: GainCalibration 0.00125,
 * scaled by 44.1 kHz over the context's rate). Calibrating to it keeps every
 * existing soundscape's undamped space at the level it was tuned at.
 */
const SPACE_CALIBRATION = 0.00125 * 44100;

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

export function buildSoundscapeImpulseResponse(
  space: Pick<SoundscapeSpaceSettings, 'size' | 'damping' | 'echoes'>,
  sampleRate: number,
  seed = 7,
): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const decaySec = spaceDecaySec(space.size);
  const damping = Math.max(0, Math.min(1, space.damping));
  const highDecaySec = decaySec / (1 + (DAMPING_MAX_RATIO_EXTRA * damping));
  const preDelay = Math.round(spacePreDelaySec(space.size) * sampleRate);
  const tailLength = Math.ceil(Math.min(SPACE_MAX_LENGTH_SEC, decaySec * 1.1) * sampleRate);
  const length = preDelay + tailLength;
  const buildUp = Math.max(1, Math.round((0.012 + (0.05 * space.size)) * sampleRate));
  // Per-sample factors reaching -60 dB (x 1/1000) at each band's decay time.
  const lowDecay = Math.exp(-6.9078 / (decaySec * sampleRate));
  const highDecay = Math.exp(-6.9078 / (highDecaySec * sampleRate));
  const crossoverPole = Math.exp((-2 * Math.PI * DAMPING_CROSSOVER_HZ) / sampleRate);
  const random = makeRandom(seed);
  const channels: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(length), new Float32Array(length)];
  let undampedEnergy = 0;
  for (const data of channels) {
    let lowEnvelope = 1;
    let highEnvelope = 1;
    let low = 0;
    for (let index = 0; index < tailLength; index += 1) {
      // White noise split into two complementary bands: `low` + `high` is the
      // noise itself, so at damping 0 (equal envelopes) the tail is unfiltered.
      const white = (random() * 2) - 1;
      low = (crossoverPole * low) + ((1 - crossoverPole) * white);
      const high = white - low;
      const x = Math.min(1, index / buildUp);
      const shape = x * x * (3 - (2 * x));
      data[preDelay + index] = ((low * lowEnvelope) + (high * highEnvelope)) * shape;
      const undamped = white * lowEnvelope * shape;
      undampedEnergy += undamped * undamped;
      lowEnvelope *= lowDecay;
      highEnvelope *= highDecay;
    }
  }
  // See LEVEL above: the undamped tail's power, per channel, is what the
  // browser's normalisation would have produced.
  const targetRms = SPACE_CALIBRATION / sampleRate;
  const scale = undampedEnergy > 0 ? targetRms * Math.sqrt((2 * length) / undampedEnergy) : 0;
  for (const data of channels) {
    for (let index = preDelay; index < length; index += 1) data[index] *= scale;
  }
  const echoes = Math.max(0, Math.min(1, space.echoes));
  if (echoes > 0) {
    // Alternate echoes lean to alternate sides; each is quieter by its order
    // and by the air it crossed (the tail's own low-band decay).
    const gap = (ECHO_MIN_GAP_SEC + (ECHO_GAP_PER_SIZE_SEC * space.size)) * sampleRate;
    for (let order = 0; order < ECHO_COUNT; order += 1) {
      const at = preDelay + Math.round(gap * ((order + 1) ** 1.15) * (0.95 + (0.1 * random())));
      if (at + 2 >= length) break;
      const level = echoes * ECHO_MAX_GAIN * (0.7 ** order) * Math.exp(-6.9078 * ((at - preDelay) / sampleRate) / decaySec);
      const lean = order % 2 === 0 ? [1, 0.55] : [0.55, 1];
      channels.forEach((data, side) => {
        // Softened over three samples: a reflection off a real surface is not a click.
        data[at] += level * lean[side] * 0.25;
        data[at + 1] += level * lean[side] * 0.5;
        data[at + 2] += level * lean[side] * 0.25;
      });
    }
  }
  return channels;
}
