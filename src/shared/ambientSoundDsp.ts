/**
 * What the worklet (public/ambient-generator.js) is told about each layer:
 * the stored settings plus everything cheaper to derive once on the main
 * thread than per block on the audio thread -- gains, the distance rule, the
 * noise cycle and filter-gain tables, the chimes' tuning.
 */
import {
  AMBIENT_NOISE_SWEEP_OCTAVES,
  AMBIENT_RAIN_DROPS_MAX_PER_SEC,
  AMBIENT_RAIN_DROPS_MIN_PER_SEC,
  AMBIENT_THUNDER_JITTER,
  AMBIENT_THUNDER_LENGTH_MAX_SEC,
  AMBIENT_THUNDER_LENGTH_MIN_SEC,
  AMBIENT_CHIME_RATE_MAX_PER_SEC,
  AMBIENT_CHIME_RATE_MIN_PER_SEC,
  AMBIENT_MARK_TREE_SWEEP_RATE_MAX_PER_SEC,
  AMBIENT_MARK_TREE_SWEEP_RATE_MIN_PER_SEC,
  ambientFaderGain,
  type AmbientChannelKind,
  type AmbientChannelSettings,
  type AmbientSettings,
} from './ambientSound';
import { buildNoiseCycle } from './ambientNoiseCycle';
import { chimeScaleCents } from './ambientChimeScales';

/**
 * Each kind's level at a fader of 1, relative to the others: set so that
 * layers of different kinds at the same fader sit at a comparable loudness
 * (measured as the RMS of a default layer rendered on its own at fader 1:
 * about 0.2 for the steady kinds, a little under for the ones made of
 * transients, whose peaks carry them). The engine's bus limiter catches the
 * sum of several near full scale.
 */
export const AMBIENT_KIND_GAIN: Record<AmbientChannelKind, number> = {
  noise: 0.8,
  rain: 3,
  thunder: 4.4,
  water: 2.7,
  fire: 1.3,
  chimes: 1.45,
  marktree: 0.35,
};

export interface AmbientSpace {
  cutoffHz: number;
  directGain: number;
  reverbSend: number;
}

/**
 * How far away a layer sounds, for every kind. Distance darkens it (a
 * low-pass swept from 18 kHz down to 2.2 kHz), lowers the direct sound and
 * raises the share sent to the space's reverb, which is what makes far layers
 * diffuse rather than merely quiet.
 */
export function resolveAmbientSpace(distance: number): AmbientSpace {
  const bounded = Number.isFinite(distance) ? Math.max(0, Math.min(1, distance)) : 0;
  return {
    cutoffHz: 18000 * ((2200 / 18000) ** bounded),
    directGain: 1 - (0.78 * bounded),
    reverbSend: 0.06 + (0.6 * bounded),
  };
}

// ---------------------------------------------------------------------------
// Noise colour and filter.

/**
 * A noise layer's colour (0 brown, 0.5 pink, 1 white) as the three loops'
 * gains: an equal-power crossfade between the two neighbours, so the noises
 * (unrelated to each other) sum to the same power at every colour.
 */
export function noiseColourWeights(colour: number): [brown: number, pink: number, white: number] {
  const c = Number.isFinite(colour) ? Math.max(0, Math.min(1, colour)) : 0.5;
  const t = c <= 0.5 ? c / 0.5 : (c - 0.5) / 0.5;
  const a = Math.cos(t * Math.PI / 2);
  const b = Math.sin(t * Math.PI / 2);
  return c <= 0.5 ? [a, b, 0] : [0, a, b];
}

export const NOISE_FOCUS_MAX_Q = 12;
const FLAT_Q = Math.SQRT1_2;

/** The filter's resonance at a focus: flat at 0, rising geometrically to NOISE_FOCUS_MAX_Q. */
export function noiseFocusQ(focus: number): number {
  const f = Number.isFinite(focus) ? Math.max(0, Math.min(1, focus)) : 0;
  return FLAT_Q * ((NOISE_FOCUS_MAX_Q / FLAT_Q) ** f);
}

/**
 * The cutoffs the filter-gain table is sampled at, log-spaced: the worklet
 * reads it by the log of the cutoff (the sweep moves the cutoff every few
 * milliseconds, too often to integrate a spectrum each time).
 */
export const NOISE_TONE_TABLE_MIN_HZ = 40;
export const NOISE_TONE_TABLE_MAX_HZ = 20000;
export const NOISE_TONE_TABLE_POINTS = 64;
export const NOISE_TONE_MAX_GAIN_DB = 24;

/**
 * The filter's response power at `x` = f / cutoff: a blend of the state-
 * variable filter's low-pass and its unity-peak band-pass, (1 - focus) of
 * one and focus of the other, both at the focus's Q. At focus 0 a
 * Butterworth low-pass; at 1 a narrow band.
 */
export function noiseFilterPower(x: number, focus: number): number {
  const k = 1 / noiseFocusQ(focus);
  const numerator = ((1 - focus) ** 2) + ((focus * k * x) ** 2);
  const denominator = ((1 - (x * x)) ** 2) + ((k * x) ** 2);
  return numerator / denominator;
}

/**
 * The gain that holds a noise layer's loudness wherever its filter sits: the
 * power the filter takes out of this colour's spectrum, put back (capped at
 * NOISE_TONE_MAX_GAIN_DB), at each of the table's cutoffs. The colour's
 * spectrum per log-frequency step is brown 1/f, pink flat, white f, each
 * normalised (the loops are, see noiseLoopGains), blended by the colour's
 * crossfade weights squared.
 */
export function buildNoiseToneTable(colour: number, focus: number): Float32Array {
  const [brown, pink, white] = noiseColourWeights(colour).map((weight) => weight * weight);
  const steps = 200;
  const frequencies: number[] = [];
  const shapes = { brown: [] as number[], pink: [] as number[], white: [] as number[] };
  for (let step = 0; step < steps; step += 1) {
    const f = 20 * (1000 ** ((step + 0.5) / steps));
    frequencies.push(f);
    shapes.brown.push(1 / f);
    shapes.pink.push(1);
    shapes.white.push(f);
  }
  const normalise = (values: number[]) => {
    const total = values.reduce((sum, value) => sum + value, 0);
    return values.map((value) => value / total);
  };
  const b = normalise(shapes.brown);
  const p = normalise(shapes.pink);
  const w = normalise(shapes.white);
  const weight = frequencies.map((_, index) => (brown * b[index]) + (pink * p[index]) + (white * w[index]));
  const maxGain = 10 ** (NOISE_TONE_MAX_GAIN_DB / 20);
  const table = new Float32Array(NOISE_TONE_TABLE_POINTS);
  for (let point = 0; point < NOISE_TONE_TABLE_POINTS; point += 1) {
    const cutoff = NOISE_TONE_TABLE_MIN_HZ * ((NOISE_TONE_TABLE_MAX_HZ / NOISE_TONE_TABLE_MIN_HZ) ** (point / (NOISE_TONE_TABLE_POINTS - 1)));
    let kept = 0;
    let total = 0;
    for (let index = 0; index < frequencies.length; index += 1) {
      kept += weight[index] * noiseFilterPower(frequencies[index] / cutoff, focus);
      total += weight[index];
    }
    table[point] = Math.min(maxGain, 1 / Math.sqrt(Math.max(1e-12, kept / total)));
  }
  return table;
}

// ---------------------------------------------------------------------------
// Chimes.

/** The fundamental of each tube, lowest first, on the layer's scale (ambientChimeScales.ts). */
export function chimeTubeFrequencies(pitchHz: number, tubes: number, scale = 0): number[] {
  return chimeScaleCents(scale, tubes).map((value) => pitchHz * (2 ** (value / 1200)));
}

/**
 * A mark tree's bar pitches, lowest first. Its bars are cut to lengths that
 * shorten by an equal step from one to the next, and a free bar's pitch
 * goes as 1 / length^2, so the pitches crowd together toward the top rather
 * than climbing evenly -- the sound of a real mark tree's sweep. The
 * shortest is `spanOctaves` above the longest.
 */
export function markTreeBarFrequencies(pitchHz: number, spanOctaves: number, bars: number): number[] {
  const shortest = 2 ** (-spanOctaves / 2);
  return Array.from({ length: bars }, (_, index) => {
    const length = 1 - ((1 - shortest) * (index / Math.max(1, bars - 1)));
    return pitchHz / (length * length);
  });
}

// ---------------------------------------------------------------------------
// The configure message.

/** One channel as the worklet receives it. */
export type AmbientWorkletChannel = AmbientChannelSettings & {
  /** The fader and the kind's level, as one gain. */
  gain: number;
  /** The distance resolved; every kind but thunder, which resolves each peal's own. */
  space?: AmbientSpace;
  cycle?: Float32Array;
  colourWeights?: [number, number, number];
  q?: number;
  toneTable?: Float32Array;
  toneTableRangeHz?: readonly [number, number];
  sweepOctaves?: number;
  dropsRange?: readonly [number, number];
  spaceTable?: readonly AmbientSpace[];
  lengthRangeSec?: readonly [number, number];
  jitter?: number;
  /** The kind's level alone, for thunder, which applies each peal's own fader. */
  kindGain?: number;
  tubeHz?: number[];
  strikeRange?: readonly [number, number];
};

export interface AmbientWorkletConfiguration {
  channels: AmbientWorkletChannel[];
  weather: AmbientSettings['weather'];
}

/** The `configure` message's payload. */
export function toWorkletConfiguration(settings: AmbientSettings): AmbientWorkletConfiguration {
  return {
    weather: { ...settings.weather },
    channels: settings.channels.map((channel) => toWorkletChannel(channel)),
  };
}

export function toWorkletChannel(channel: AmbientChannelSettings): AmbientWorkletChannel {
  const gain = ambientFaderGain(channel.volume) * AMBIENT_KIND_GAIN[channel.kind];
  switch (channel.kind) {
    case 'noise':
      return {
        ...channel,
        gain,
        space: resolveAmbientSpace(channel.distance),
        cycle: buildNoiseCycle(channel.curve, channel.skew),
        colourWeights: noiseColourWeights(channel.colour),
        q: noiseFocusQ(channel.focus),
        toneTable: buildNoiseToneTable(channel.colour, channel.focus),
        toneTableRangeHz: TONE_TABLE_RANGE_HZ,
        sweepOctaves: channel.sweep * AMBIENT_NOISE_SWEEP_OCTAVES,
      };
    case 'rain':
      return { ...channel, gain, space: resolveAmbientSpace(channel.distance), dropsRange: RAIN_DROPS_RANGE };
    case 'thunder':
      return { ...channel, gain, kindGain: AMBIENT_KIND_GAIN.thunder, spaceTable: THUNDER_SPACE_TABLE, lengthRangeSec: THUNDER_LENGTH_RANGE_SEC, jitter: AMBIENT_THUNDER_JITTER };
    case 'chimes':
      return {
        ...channel,
        gain,
        space: resolveAmbientSpace(channel.distance),
        tubeHz: chimeTubeFrequencies(channel.pitchHz, channel.tubes, channel.scale),
        strikeRange: CHIME_STRIKE_RANGE,
      };
    case 'marktree':
      return {
        ...channel,
        gain,
        space: resolveAmbientSpace(channel.distance),
        tubeHz: markTreeBarFrequencies(channel.pitchHz, channel.spanOctaves, channel.bars),
        strikeRange: MARK_TREE_SWEEP_RANGE,
      };
    default:
      return { ...channel, gain, space: resolveAmbientSpace(channel.distance) };
  }
}

const TONE_TABLE_RANGE_HZ = [NOISE_TONE_TABLE_MIN_HZ, NOISE_TONE_TABLE_MAX_HZ] as const;
const RAIN_DROPS_RANGE = [AMBIENT_RAIN_DROPS_MIN_PER_SEC, AMBIENT_RAIN_DROPS_MAX_PER_SEC] as const;
const CHIME_STRIKE_RANGE = [AMBIENT_CHIME_RATE_MIN_PER_SEC, AMBIENT_CHIME_RATE_MAX_PER_SEC] as const;
const MARK_TREE_SWEEP_RANGE = [AMBIENT_MARK_TREE_SWEEP_RATE_MIN_PER_SEC, AMBIENT_MARK_TREE_SWEEP_RATE_MAX_PER_SEC] as const;

/** Steps in a thunder layer's distance table: finer than the slider moves. */
const THUNDER_SPACE_STEPS = 100;
const THUNDER_SPACE_TABLE: readonly AmbientSpace[] = Array.from(
  { length: THUNDER_SPACE_STEPS + 1 },
  (_, index) => resolveAmbientSpace(index / THUNDER_SPACE_STEPS),
);
const THUNDER_LENGTH_RANGE_SEC = [AMBIENT_THUNDER_LENGTH_MIN_SEC, AMBIENT_THUNDER_LENGTH_MAX_SEC] as const;
