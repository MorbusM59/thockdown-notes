/**
 * The space the soundscape layers play in, as a stereo impulse response: the
 * desktop's ConvolverNode (sound/soundscapeLivePlayback.ts) and Android's
 * partitioned convolution (sound/soundscapeMix.ts) both use it. Pure; built
 * whenever the room changes.
 *
 * TWO SLIDERS MAKE THE PLACE (SoundscapeSpaceSettings): SIZE sets the clock
 * and FOLIAGE decides what survives the journey. Their four corners are four
 * real places, and every point between them should be one too:
 * - small, bare: a closed room -- a short bright tail, tight reflections;
 * - small, dense: a room lined with foam -- nearly dry, dark, very short;
 * - large, bare: a mountain valley -- a long gap, then a few distinct,
 *   bright echoes standing out of a sparse tail;
 * - large, dense: a fir forest -- open and wide, but every return scattered
 *   into a soft, dark wash, and distant sounds dull fast.
 *
 * What each does to the response:
 * - SIZE: the PRE-DELAY before the tail, the spacing of the REFLECTIONS
 *   (from REFLECTION_GAP_MIN_SEC, a room's walls, to REFLECTION_GAP_MAX_SEC, a
 *   valley's far side), and the tail's DECAY (to -60 dB at spaceDecaySec).
 * - FOLIAGE, all at once, so it cannot be subtle:
 *   - the tail's highs die up to 1 + FOLIAGE_HIGH_DECAY_EXTRA times faster than
 *     its lows, from the first sample, and the whole tail is shortened by up
 *     to FOLIAGE_DECAY_SHORTENING -- dulled and smoothed far more than cut:
 *     a forest's tail is long and dark, not short;
 *   - the whole response is low-passed, from FOLIAGE_CUTOFF_OPEN_HZ down to
 *     FOLIAGE_CUTOFF_DENSE_HZ, twelve decibels an octave;
 *   - each reflection is SMEARED from a click into a soft burst of noise up
 *     to FOLIAGE_SMEAR_SHARE of its gap long. The burst keeps the click's
 *     energy, so an echo turns into diffusion rather than vanishing -- which
 *     is what keeps a dense large space open rather than dead -- and only
 *     its level comes down, by up to FOLIAGE_REFLECTION_LOSS;
 *   - the diffuse tail grows from TAIL_SPARSE_GAIN (a bare large space is
 *     sparse: little between its echoes) to full as surfaces scatter.
 *   The other half of foliage is not here but in each channel's distance
 *   (soundscapeDsp.ts's resolveSoundscapeSpace): denser foliage dulls
 *   distant sounds faster, and obstructs even near ones slightly.
 * - The two sides are DECORRELATED, so the tail surrounds rather than sits
 *   in the middle, and the reflections lean to alternate sides.
 *
 * LEVEL. The convolution does not normalise (a browser's normalisation
 * rescales every response to one power, which would turn foliage's losses
 * back up). The response is calibrated once, from the tail it would have
 * with NO foliage, to the power Chromium's normalisation gave such a tail
 * (SPACE_CALIBRATION), so foliage takes energy away rather than being
 * rebalanced.
 */
import { logLerp, type SoundscapeSpaceSettings } from './soundscape';

export const SPACE_DECAY_MIN_SEC = 0.35;
export const SPACE_DECAY_MAX_SEC = 7;
export const SPACE_MAX_LENGTH_SEC = 8;
const HIGH_BAND_CROSSOVER_HZ = 1500;
const FOLIAGE_HIGH_DECAY_EXTRA = 9;
const FOLIAGE_DECAY_SHORTENING = 0.5;
const FOLIAGE_CUTOFF_OPEN_HZ = 16000;
const FOLIAGE_CUTOFF_DENSE_HZ = 1500;
const FOLIAGE_SMEAR_SHARE = 0.6;
const FOLIAGE_REFLECTION_LOSS = 0.6;
const TAIL_SPARSE_GAIN = 0.45;
const REFLECTION_COUNT = 7;
const REFLECTION_GAP_MIN_SEC = 0.03;
const REFLECTION_GAP_MAX_SEC = 0.9;
/** A reflection is never a bare click: even a hard wall spreads it a little, which keeps a small room's close reflections from ringing as a comb. */
const REFLECTION_MIN_SMEAR_SEC = 0.002;
const REFLECTION_GAIN = 0.5;
/**
 * Per-sample RMS of a response as Chromium's ConvolverNode normalisation
 * leaves it (Reverb::CalculateNormalizationScale: GainCalibration 0.00125,
 * scaled by 44.1 kHz over the context's rate).
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

/** What decides the impulse response: two spaces with one key share one room (amount and brilliance are applied outside it). */
export function soundscapeRoomKey(space: Pick<SoundscapeSpaceSettings, 'size' | 'foliage'>): string {
  return [space.size, space.foliage].map((value) => value.toFixed(3)).join(':');
}

/** The gap between a space's reflections, in seconds. */
export function spaceReflectionGapSec(size: number): number {
  return logLerp(REFLECTION_GAP_MIN_SEC, REFLECTION_GAP_MAX_SEC, Math.max(0, Math.min(1, size)));
}

export function buildSoundscapeImpulseResponse(
  space: Pick<SoundscapeSpaceSettings, 'size' | 'foliage'>,
  sampleRate: number,
  seed = 7,
): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const size = Math.max(0, Math.min(1, space.size));
  const foliage = Math.max(0, Math.min(1, space.foliage));
  const openDecaySec = spaceDecaySec(size);
  const decaySec = openDecaySec * (1 - (FOLIAGE_DECAY_SHORTENING * foliage));
  const highDecaySec = decaySec / (1 + (FOLIAGE_HIGH_DECAY_EXTRA * foliage));
  const preDelay = Math.round(spacePreDelaySec(size) * sampleRate);
  const tailLength = Math.ceil(Math.min(SPACE_MAX_LENGTH_SEC, openDecaySec * 1.1) * sampleRate);
  const length = preDelay + tailLength;
  const buildUp = Math.max(1, Math.round((0.012 + (0.05 * size)) * sampleRate));
  // Per-sample factors reaching -60 dB (x 1/1000) at each decay time.
  const openDecay = Math.exp(-6.9078 / (openDecaySec * sampleRate));
  const lowDecay = Math.exp(-6.9078 / (decaySec * sampleRate));
  const highDecay = Math.exp(-6.9078 / (highDecaySec * sampleRate));
  const crossoverPole = Math.exp((-2 * Math.PI * HIGH_BAND_CROSSOVER_HZ) / sampleRate);
  const tailGain = 1 - ((1 - TAIL_SPARSE_GAIN) * (1 - foliage) * size);
  const random = makeRandom(seed);
  const channels: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(length), new Float32Array(length)];
  let openEnergy = 0;
  for (const data of channels) {
    let openEnvelope = 1;
    let lowEnvelope = 1;
    let highEnvelope = 1;
    let low = 0;
    for (let index = 0; index < tailLength; index += 1) {
      // White noise split into two complementary bands: `low` + `high` is the
      // noise itself, so with no foliage (equal envelopes) the tail is unfiltered.
      const white = (random() * 2) - 1;
      low = (crossoverPole * low) + ((1 - crossoverPole) * white);
      const high = white - low;
      const x = Math.min(1, index / buildUp);
      const shape = x * x * (3 - (2 * x));
      data[preDelay + index] = ((low * lowEnvelope) + (high * highEnvelope)) * shape * tailGain;
      const open = white * openEnvelope * shape;
      openEnergy += open * open;
      openEnvelope *= openDecay;
      lowEnvelope *= lowDecay;
      highEnvelope *= highDecay;
    }
  }
  // See LEVEL above: calibrated from the tail with no foliage.
  const targetRms = SPACE_CALIBRATION / sampleRate;
  const scale = openEnergy > 0 ? targetRms * Math.sqrt((2 * length) / openEnergy) : 0;
  for (const data of channels) {
    for (let index = preDelay; index < length; index += 1) data[index] *= scale;
  }

  // Reflections: alternate sides, each quieter by its order and by the air
  // it crossed (the tail's own decay), smeared by foliage into a burst that
  // keeps its energy. Their level is a gain on what is sent to the space.
  const gap = spaceReflectionGapSec(size) * sampleRate;
  const smear = Math.max(REFLECTION_MIN_SMEAR_SEC * sampleRate, FOLIAGE_SMEAR_SHARE * foliage * gap);
  const burstLength = Math.max(3, Math.round(smear));
  const burst = new Float32Array(burstLength);
  for (let order = 0; order < REFLECTION_COUNT; order += 1) {
    const at = preDelay + Math.round(gap * ((order + 1) ** 1.15) * (0.95 + (0.1 * random())));
    if (at + burstLength >= length) break;
    const level = REFLECTION_GAIN * (1 - (FOLIAGE_REFLECTION_LOSS * foliage)) * (0.7 ** order)
      * Math.exp(-6.9078 * ((at - preDelay) / sampleRate) / decaySec);
    // A Hann-windowed noise burst of unit energy: at the minimum smear it is
    // nearly a click, at full foliage a soft swell.
    let energy = 0;
    for (let index = 0; index < burstLength; index += 1) {
      const window = 0.5 - (0.5 * Math.cos((2 * Math.PI * (index + 0.5)) / burstLength));
      burst[index] = ((random() * 2) - 1) * window;
      energy += burst[index] * burst[index];
    }
    const norm = energy > 0 ? 1 / Math.sqrt(energy) : 0;
    const lean = order % 2 === 0 ? [1, 0.55] : [0.55, 1];
    channels.forEach((data, side) => {
      for (let index = 0; index < burstLength; index += 1) data[at + index] += level * lean[side] * burst[index] * norm;
    });
  }

  // The whole response low-passed by foliage: two one-pole stages.
  const cutoff = logLerp(FOLIAGE_CUTOFF_OPEN_HZ, FOLIAGE_CUTOFF_DENSE_HZ, foliage);
  const pole = Math.exp((-2 * Math.PI * Math.min(cutoff, sampleRate * 0.45)) / sampleRate);
  for (const data of channels) {
    let first = 0;
    let second = 0;
    for (let index = 0; index < length; index += 1) {
      first = (pole * first) + ((1 - pole) * data[index]);
      second = (pole * second) + ((1 - pole) * first);
      data[index] = second;
    }
  }
  return channels;
}
