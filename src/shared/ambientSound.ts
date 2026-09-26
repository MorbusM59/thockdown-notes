/**
 * Procedural ambient sound: the persisted model, its defaults, the factory
 * soundscapes and the sanitizer every stored value passes through.
 *
 * A soundscape is a fixed ROSTER of channels (AMBIENT_CHANNEL_ROSTER) plus
 * two scene-wide settings: the SPACE every layer plays in (the shared reverb)
 * and the WEATHER (one slow gust signal that layers may follow, so a gust
 * lifts the wind, the rain and the chimes together rather than each on its
 * own random clock).
 *
 * A channel is identified by its roster `id`, never by its position, and its
 * kind is the roster's, never stored: the sanitizer looks each saved channel
 * up by id and discards anything the roster does not name. A new kind of
 * layer is therefore new roster entries and nothing else -- a save made
 * before it simply finds those channels at their disabled defaults.
 *
 * The synthesis lives in public/ambient-generator.js (an AudioWorklet, which
 * cannot import from here); the per-layer values it needs that are cheaper to
 * derive on the main thread are resolved in ambientSoundDsp.ts. The rain
 * surfaces are named in both places, and ambient-generator.test.ts asserts
 * that every surface named here has a profile there.
 */

import { CHIME_SCALE_COUNT } from './ambientChimeScales';

/**
 * What chimes can be made of, and where each sits on the material slider;
 * mirrored by CHIME_MATERIALS in public/ambient-generator.js, which
 * ambient-generator.test.ts holds to these.
 */
export const AMBIENT_CHIME_MATERIALS = [
  { name: 'wood', at: 0 },
  { name: 'metal', at: 1 / 3 },
  { name: 'glass', at: 2 / 3 },
  { name: 'veil', at: 1 },
] as const;

export const AMBIENT_NOISE_TYPES = ['brown', 'pink', 'white'] as const;
export type AmbientNoiseType = (typeof AMBIENT_NOISE_TYPES)[number];

/**
 * What a rain layer's drops land on, one number from 0 (softest) to 1
 * (hardest). Every drop is the same model, its parameters blended between
 * these anchors (public/ambient-generator.js's surfaceProfile), each a
 * different kind of impact rather than a different filter over one sound:
 * - forest (0): a soft, low pat on leaves with a small thud underneath.
 * - canvas (0.25): a taut membrane -- a tent, an awning, an umbrella -- a
 *   dull thump with almost no brightness.
 * - street (0.5): a short band-passed tick on a hard surface.
 * - tin (0.75): a thin metal sheet -- a shed or a car roof -- a bright tick
 *   and a cluster of ringing modes.
 * - glass (1): a white-noise click and many long-ringing modes, like hail on
 *   glass or on metal pipes.
 */
export const AMBIENT_RAIN_SURFACE_ANCHORS = [
  { name: 'forest', at: 0 },
  { name: 'canvas', at: 0.25 },
  { name: 'street', at: 0.5 },
  { name: 'tin', at: 0.75 },
  { name: 'glass', at: 1 },
] as const;
export type AmbientRainSurfaceName = (typeof AMBIENT_RAIN_SURFACE_ANCHORS)[number]['name'];

/** The position of a named anchor on the surface scale. */
export function rainSurfaceAt(name: AmbientRainSurfaceName): number {
  return AMBIENT_RAIN_SURFACE_ANCHORS.find((anchor) => anchor.name === name)!.at;
}

/**
 * Every layer's common state. `volume` is a FADER position, 0-1, not a gain:
 * ambientFaderGain turns it into one on a decibel law, so equal travel is an
 * equal change in loudness and the top half of the slider is not wasted.
 */
export interface AmbientChannelBaseSettings {
  id: string;
  enabled: boolean;
  solo: boolean;
  volume: number;
  /**
   * How far away the layer sounds, 0-1: darker, less direct, more of it in
   * the space's reverb (ambientSoundDsp.ts's resolveAmbientSpace). One rule
   * for every kind.
   */
  distance: number;
}

/**
 * A noise layer: noise of any colour through one filter, its level rising
 * and falling in a repeating cycle -- surf, wind, a steady wash.
 */
export interface AmbientNoiseChannelSettings extends AmbientChannelBaseSettings {
  kind: 'noise';
  /** The noise's spectral slope: 0 brown, 0.5 pink, 1 white, blended between. */
  colour: number;
  /**
   * The filter's cutoff in Hz: a low-pass at `focus` 0, the centre of a
   * resonant band at 1. At the top of its range it lets everything through.
   */
  brightnessHz: number;
  /** 0 a gentle low-pass, 1 a narrow resonant band -- a whistle. */
  focus: number;
  /** How far (0-1) the level swings around its mean over one cycle. */
  depth: number;
  /** Seconds per cycle of the level's rise and fall. */
  periodSec: number;
  /**
   * The cycle's curve, 0-1 (ambientNoiseCycle.ts's buildNoiseCycle): a
   * broad plateau at 0, a sine at 0.5, a narrow swell at 1.
   */
  curve: number;
  /** Where in the cycle the peak falls, 0.1-0.9: early is a fast rise and a slow fall. */
  skew: number;
  /**
   * How far the filter follows the swell, -1 to 1: above 0 it opens as the
   * level rises (a gust whistling higher, a wave brightening as it breaks),
   * below 0 it closes. In units of AMBIENT_NOISE_SWEEP_OCTAVES.
   */
  sweep: number;
  /** How much each cycle departs from the last in length and height, 0-1. */
  variation: number;
  /** How far the layer sways across the stereo field, crossing centre at each peak, 0-1. */
  sway: number;
  /**
   * Stereo width, 0-1: 1 is the two sides unrelated, enveloping; 0 is a point
   * source, which sway can then carry across the field.
   */
  width: number;
  /** How closely the layer follows the weather's gusts, 0-1. */
  weather: number;
}

/** Rain falling on a surface, near drops heard one by one over the wash of the rest. */
export interface AmbientRainChannelSettings extends AmbientChannelBaseSettings {
  kind: 'rain';
  /** 0 (softest: leaves) to 1 (hardest: glass); see AMBIENT_RAIN_SURFACE_ANCHORS. */
  surface: number;
  /** How much the surface rings, 0 dead to 1 twice as long; 0.5 is the surface as authored. */
  resonance: number;
  /** The drops heard one by one: 0 drizzle to 1 downpour -- how many, and how heavy. */
  intensity: number;
  /** The drops' level (ambientPartGain). */
  dropLevel: number;
  /** The drops' pitch, 0 an octave lower to 1 an octave higher; 0.5 as authored. */
  dropTone: number;
  /**
   * The wash -- the dense bed of rain too many and too small to hear one at
   * a time: 0 a sparse patter to 1 a smooth hiss (how many tiny impacts).
   */
  washDensity: number;
  /** The wash's level (ambientPartGain); at 0 there is none, and the drops play alone. */
  washLevel: number;
  /** The wash's pitch, 0 two octaves lower to 1 two octaves higher; 0.5 as authored. */
  washTone: number;
  /** How often (0-1, of AMBIENT_RAIN_DRIPS_MAX_PER_SEC) a large, slow drop falls from a gutter or a branch. */
  drips: number;
  /** The drips' level (ambientPartGain). */
  dripLevel: number;
  /** The drips' pitch, 0 an octave lower to 1 an octave higher; 0.5 as authored. */
  dripTone: number;
  /** Standing water, 0 dry to 1 soaked: the share of drops that land in it, and a surface its film deadens. */
  wetness: number;
  /** The splashes' and bubbles' level (ambientPartGain). */
  splashLevel: number;
  /** The splashes' and bubbles' pitch, 0 an octave lower (larger bubbles) to 1 an octave higher. */
  splashTone: number;
  /** Where the layer is, -1 to 1. */
  pan: number;
  /** Stereo width, 0 a point at the pan to 1 the whole room the pan leaves. */
  width: number;
  weather: number;
}

/**
 * One storm cell, rumbling now and then (public/ambient-generator.js's
 * startPeal). `share` is the part of the time it sounds: after a peal of
 * length L it is silent for L x (1 - share) / share. After every peal
 * `randomness` moves every other control of the next one by up to
 * AMBIENT_THUNDER_JITTER of its range either way, around the setting.
 */
export interface AmbientThunderChannelSettings extends AmbientChannelBaseSettings {
  kind: 'thunder';
  share: number;
  pan: number;
  /** How much of the stereo field a peal fills around its pan, 0-1. */
  spread: number;
  /** How harshly the boom under the rumble breaks up: 0 a smooth swell, 1 a choppy growl. */
  character: number;
  /** -1 to 1, 0 off: loud moments pushed away from quiet ones (above 0) or drawn toward them. */
  contrast: number;
  randomness: number;
  /** How long a peal's roll lasts, in seconds. */
  lengthSec: number;
  /** Gusts bring the next peal sooner. */
  weather: number;
}

/**
 * Running water -- a brook, a stream, a fountain: a cloud of bubbles, each
 * ringing at the pitch its radius sets and rising as it nears the surface
 * (the same bubble model as a raindrop landing in a puddle), over the low
 * rush of the flow. Bubbles and rush are controlled separately; the tumble
 * moves both.
 */
export interface AmbientWaterChannelSettings extends AmbientChannelBaseSettings {
  kind: 'water';
  /** 0 an even patter to 1 bubbles and rush arriving in bursts, as water tumbles over stones. */
  turbulence: number;
  /** Stereo width, 0 a point at the pan to 1 the whole room the pan leaves. */
  width: number;
  /** How many bubbles, 0 a few to 1 a froth (AMBIENT_WATER_BUBBLES_PER_SEC). */
  bubbles: number;
  /** The bubbles' level (ambientPartGain). */
  bubbleLevel: number;
  /** 0 small, high, glassy bubbles to 1 large, low gurgles. */
  size: number;
  /** How much the bubbles' sizes vary: 0 all one size, 0.5 as authored, 1 far apart. */
  sizeSpread: number;
  /** How far a bubble's pitch climbs as it rises: 0 flat, 0.5 as authored, 1 four times as far. */
  rise: number;
  /** How long a bubble rings: 0 a dead plop, 0.5 as authored, 1 a ringing note. */
  ring: number;
  /** The rush's texture: 0 a sparse, gravelly rattle to 1 a smooth rush. */
  rush: number;
  /** The rush's level (ambientPartGain); at 0 there is none. */
  rushLevel: number;
  /** The rush's pitch, 0 two octaves lower to 1 two octaves higher. */
  rushTone: number;
  pan: number;
}

/**
 * A wood fire: the roar of the flames, the crackle of burning
 * fibres and the pop of sap.
 */
export interface AmbientFireChannelSettings extends AmbientChannelBaseSettings {
  kind: 'fire';
  /** 0 embers to 1 a blaze: the roar's weight and depth. */
  size: number;
  /** Stereo width, 0 a point at the pan to 1 the whole room the pan leaves. */
  width: number;
  /** How often the wood crackles, 0 rarely to 1 constantly. */
  crackle: number;
  /** The crackles' level (ambientPartGain). */
  crackleLevel: number;
  /** The crackles' band, 0 two octaves lower to 1 two octaves higher; 0.5 as authored. */
  crackleTone: number;
  /** How often sap pops, 0 never to 1 often. */
  pops: number;
  /** The pops' level, as crackleLevel. */
  popLevel: number;
  /** 0 a dull thud to 1 a bright crack: the pop darkened, never made to ring. */
  popTone: number;
  /**
   * The chance a pop sets off a SIZZLE -- moisture the burst has opened,
   * boiling out of the wood at the pop's place -- 0 never to 1 always, while
   * fewer than AMBIENT_FIRE_MAX_SIZZLES are sizzling.
   */
  sizzle: number;
  /** The sizzle's level (ambientPartGain). */
  sizzleLevel: number;
  /** The sizzle's pitch, 0 low (2 kHz) to 1 high (8 kHz). */
  sizzleTone: number;
  /** How far the roar swings as the flames move, 0 a steady burn to 1 surging and faltering. */
  flicker: number;
  /** The average length of one movement of the flames, in seconds. */
  flickerPeriodSec: number;
  /**
   * How abrupt and how irregular the movements are, 0 soft swells at an
   * even pace to 1 sudden lurches at an uneven one.
   */
  flickerDynamics: number;
  pan: number;
  /** Wind fans the flames. */
  weather: number;
}

/**
 * Wind chimes: a set of metal tubes tuned to a pentatonic scale, each
 * ringing the inharmonic modes of a free bar when the clapper strikes it.
 */
export interface AmbientChimesChannelSettings extends AmbientChannelBaseSettings {
  kind: 'chimes';
  /** The lowest tube's fundamental, in Hz. */
  pitchHz: number;
  /** How many tubes, AMBIENT_CHIME_TUBES_MIN-MAX. */
  tubes: number;
  /** How long a struck tube rings, in seconds (its fundamental's decay to -60 dB). */
  ringSec: number;
  /** How often the clapper strikes, 0-1 (AMBIENT_CHIME_RATE_*). */
  activity: number;
  /** 0 a soft wooden clapper (warm, fundamental-heavy) to 1 a hard metal one (bright, with a tick). */
  hardness: number;
  /**
   * How much the chimes sound together, 0-1: the chance that the striker,
   * having hit a tube, rebounds across the ring into another, and how
   * quickly -- single notes at 0, a near-simultaneous cascade at 1.
   */
  unison: number;
  /**
   * What the tubes are made of, blended between AMBIENT_CHIME_MATERIALS:
   * wood (bamboo: a hollow knock), metal (long-ringing tubes), glass (a
   * bright, shorter tinkle) and veil (an ethereal shimmer that swells in).
   */
  material: number;
  /** Which scale the tubes are tuned to, an index into CHIME_SCALES (0 the major pentatonic). */
  scale: number;
  pan: number;
  /** Chimes are moved by the wind: gusts strike them more often and harder. */
  weather: number;
}

export type AmbientChannelSettings =
  | AmbientNoiseChannelSettings
  | AmbientRainChannelSettings
  | AmbientThunderChannelSettings
  | AmbientWaterChannelSettings
  | AmbientFireChannelSettings
  | AmbientChimesChannelSettings;
export type AmbientChannelKind = AmbientChannelSettings['kind'];
export type AmbientChannelOfKind<K extends AmbientChannelKind> = Extract<AmbientChannelSettings, { kind: K }>;

/**
 * The space every layer plays in: the shared reverb
 * (ambientSpace.ts's buildAmbientImpulseResponse).
 */
export interface AmbientSpaceSettings {
  /** 0 a small room to 1 a wide valley: the decay time and the pre-delay. */
  size: number;
  /** 0 a bright tail to 1 a tail that darkens fast, as open air and foliage absorb the highs. */
  damping: number;
  /** Discrete echoes off walls, buildings or cliffs, 0 none to 1 strong. */
  echoes: number;
  /** How much of the space is heard at all, 0 dry to 1 full. */
  amount: number;
}

/** The scene's one gust signal (the worklet's advanceWeather). */
export interface AmbientWeatherSettings {
  /** 0 calm to 1 squally: how far a gust or a lull moves the layers that follow it. */
  gustiness: number;
  /** Average seconds from one gust or lull to the next. */
  paceSec: number;
}

export interface AmbientSettings {
  channels: AmbientChannelSettings[];
  space: AmbientSpaceSettings;
  weather: AmbientWeatherSettings;
}

export interface AmbientPreset {
  id: string;
  name: string;
  settings: AmbientSettings;
}

export interface AmbientPreferences {
  enabled: boolean;
  /**
   * Overall ambient level (0-1), applied after the mix of every layer. Like
   * `enabled` it belongs to the listener, not to the soundscape: it is not
   * part of a preset and does not affect which preset reads as selected.
   */
  masterVolume: number;
  settings: AmbientSettings;
  activePresetId: string | null;
  customPresets: AmbientPreset[];
}

// ---------------------------------------------------------------------------
// Ranges. Every control's bounds are here, read by the sanitizer and the UI.

export const AMBIENT_FADER_RANGE_DB = 48;
export const AMBIENT_NOISE_BRIGHTNESS_MIN_HZ = 80;
export const AMBIENT_NOISE_BRIGHTNESS_MAX_HZ = 18000;
export const AMBIENT_NOISE_SWEEP_OCTAVES = 2;
export const AMBIENT_PERIOD_MIN_SEC = 0.5;
export const AMBIENT_PERIOD_MAX_SEC = 60;
export const AMBIENT_SKEW_MIN = 0.1;
export const AMBIENT_SKEW_MAX = 0.9;
export const AMBIENT_RAIN_DROPS_MIN_PER_SEC = 1;
export const AMBIENT_RAIN_DROPS_MAX_PER_SEC = 100;
export const AMBIENT_RAIN_DRIPS_MAX_PER_SEC = 3;
export const AMBIENT_THUNDER_JITTER = 0.25;
export const AMBIENT_THUNDER_LENGTH_MIN_SEC = 4;
export const AMBIENT_THUNDER_LENGTH_MAX_SEC = 30;
export const AMBIENT_FIRE_MAX_SIZZLES = 4;
export const AMBIENT_FIRE_PERIOD_MIN_SEC = 0.08;
export const AMBIENT_FIRE_PERIOD_MAX_SEC = 2;
/** The chimes' pitch range, in whole semitones from A440 (about 156 Hz to 1480 Hz). */
export const AMBIENT_CHIME_SEMITONE_MIN = -18;
export const AMBIENT_CHIME_SEMITONE_MAX = 21;
export const AMBIENT_CHIME_PITCH_MIN_HZ = 440 * (2 ** (AMBIENT_CHIME_SEMITONE_MIN / 12));
export const AMBIENT_CHIME_PITCH_MAX_HZ = 440 * (2 ** (AMBIENT_CHIME_SEMITONE_MAX / 12));
export const AMBIENT_CHIME_TUBES_MIN = 3;
export const AMBIENT_CHIME_TUBES_MAX = 8;
/** A water layer's bubbles per second at bubbles 0 and 1; mirrors WATER_BUBBLES_PER_SEC in public/ambient-generator.js. */
export const AMBIENT_WATER_BUBBLES_PER_SEC = [15, 500] as const;
export const AMBIENT_CHIME_RING_MIN_SEC = 1;
export const AMBIENT_CHIME_RING_MAX_SEC = 15;
export const AMBIENT_CHIME_RATE_MIN_PER_SEC = 0.05;
export const AMBIENT_CHIME_RATE_MAX_PER_SEC = 4;
export const AMBIENT_WEATHER_PACE_MIN_SEC = 2;
export const AMBIENT_WEATHER_PACE_MAX_SEC = 60;
export const MAX_AMBIENT_CUSTOM_PRESETS = 12;
export const AMBIENT_DEFAULT_MASTER_VOLUME = 1;

/**
 * A fader position (0-1) as a gain: silence at 0, and otherwise
 * AMBIENT_FADER_RANGE_DB below unity at the bottom rising evenly in decibels
 * to unity at the top.
 */
export function ambientFaderGain(position: number): number {
  if (!(position > 0)) return 0;
  return 10 ** ((-AMBIENT_FADER_RANGE_DB * (1 - Math.min(1, position))) / 20);
}

/** A fader position in decibels (-Infinity at 0). */
export function ambientFaderDb(position: number): number {
  return position > 0 ? -AMBIENT_FADER_RANGE_DB * (1 - Math.min(1, position)) : -Infinity;
}

/**
 * A part's level slider (a fire's crackle, a rain's wash, ...): silence at
 * 0, the part as authored at AMBIENT_PART_AUTHORED, and evenly in decibels
 * AMBIENT_PART_DB_PER_UNIT per unit of travel either side -- from -48 dB just
 * above 0 to +16 dB at the top. Mirrored as partGain in the worklet.
 */
export const AMBIENT_PART_AUTHORED = 0.75;
export const AMBIENT_PART_DB_PER_UNIT = 64;
export function ambientPartDb(position: number): number {
  return position > 0 ? AMBIENT_PART_DB_PER_UNIT * (Math.min(1, position) - AMBIENT_PART_AUTHORED) : -Infinity;
}
export function ambientPartGain(position: number): number {
  return position > 0 ? 10 ** (ambientPartDb(position) / 20) : 0;
}

/** Geometric interpolation: equal steps of `t` are equal ratios. */
export function logLerp(from: number, to: number, t: number): number {
  return from * ((to / from) ** t);
}

/** A rain layer's intensity as drops heard one by one per second. */
export function rainDropsPerSecond(intensity: number): number {
  return logLerp(AMBIENT_RAIN_DROPS_MIN_PER_SEC, AMBIENT_RAIN_DROPS_MAX_PER_SEC, clamp(intensity, 0, 1));
}

/**
 * Chime pitch is tuned in equal-tempered semitones from A440: the pitch of
 * semitone `n` above (or below) it.
 */
export function chimeSemitoneHz(semitone: number): number {
  return 440 * (2 ** (semitone / 12));
}

/** The semitone (from A440) nearest `hz`. */
export function chimeSemitoneOf(hz: number): number {
  return Math.round(12 * Math.log2(hz / 440));
}

/** A chimes layer's activity as strikes per second. */
export function chimeStrikesPerSecond(activity: number): number {
  return logLerp(AMBIENT_CHIME_RATE_MIN_PER_SEC, AMBIENT_CHIME_RATE_MAX_PER_SEC, clamp(activity, 0, 1));
}

// ---------------------------------------------------------------------------
// The roster.

export interface AmbientRosterEntry {
  id: string;
  kind: AmbientChannelKind;
  /** 1-based number within its kind, as the channel button shows it. */
  number: number;
}

const ROSTER_COUNTS: ReadonlyArray<readonly [AmbientChannelKind, number]> = [
  ['noise', 6],
  ['rain', 3],
  ['thunder', 3],
  ['water', 2],
  ['fire', 2],
  ['chimes', 2],
];

/** Every channel a soundscape has, in the order the settings panel shows them. */
export const AMBIENT_CHANNEL_ROSTER: readonly AmbientRosterEntry[] = ROSTER_COUNTS.flatMap(([kind, count]) => (
  Array.from({ length: count }, (_, index) => ({ id: `${kind}-${index + 1}`, kind, number: index + 1 }))
));
export const MAX_AMBIENT_CHANNELS = AMBIENT_CHANNEL_ROSTER.length;

type KindDefaults = { [K in AmbientChannelKind]: Readonly<Omit<AmbientChannelOfKind<K>, 'id'>> };

/**
 * The value every control starts at and resets to, per kind. The settings
 * panel's reset-to-default reads these rather than restating them.
 */
export const AMBIENT_CHANNEL_DEFAULTS: KindDefaults = {
  noise: {
    kind: 'noise', enabled: true, solo: false, volume: 0.7, distance: 0,
    colour: 0.5, brightnessHz: AMBIENT_NOISE_BRIGHTNESS_MAX_HZ, focus: 0,
    depth: 0.3, periodSec: 12, curve: 0.5, skew: 0.5, sweep: 0,
    variation: 0.3, sway: 0, width: 1, weather: 0,
  },
  rain: {
    kind: 'rain', enabled: true, solo: false, volume: 0.7, distance: 0.4,
    surface: rainSurfaceAt('street'), resonance: 0.5,
    intensity: 0.6, dropLevel: 0.75, dropTone: 0.5,
    washDensity: 0.5, washLevel: 0.626, washTone: 0.5,
    drips: 0.1, dripLevel: 0.75, dripTone: 0.5,
    wetness: 0.5, splashLevel: 0.75, splashTone: 0.5,
    pan: 0, width: 1, weather: 0,
  },
  thunder: {
    kind: 'thunder', enabled: true, solo: false, volume: 0.8, distance: 0.7,
    share: 0.05, pan: 0, spread: 0.5, character: 0.5, contrast: 0, randomness: 0.5, lengthSec: 15, weather: 0,
  },
  water: {
    kind: 'water', enabled: true, solo: false, volume: 0.7, distance: 0.3,
    turbulence: 0.5, width: 1, bubbles: 0.5, bubbleLevel: 0.75, size: 0.4, sizeSpread: 0.5, rise: 0.5, ring: 0.5,
    rush: 1, rushLevel: 0.75, rushTone: 0.5, pan: 0,
  },
  fire: {
    kind: 'fire', enabled: true, solo: false, volume: 0.7, distance: 0.15,
    size: 0.5, width: 1, crackle: 0.5, crackleLevel: 0.75, crackleTone: 0.5, pops: 0.3, popLevel: 0.75, popTone: 0.7,
    sizzle: 0.5, sizzleLevel: 0.75, sizzleTone: 0.2, flicker: 0.6, flickerPeriodSec: 0.4, flickerDynamics: 0.4, pan: 0, weather: 0,
  },
  chimes: {
    kind: 'chimes', enabled: true, solo: false, volume: 0.6, distance: 0.35,
    pitchHz: chimeSemitoneHz(3), tubes: 5, ringSec: 6, activity: 0.3, hardness: 0.6, unison: 0.3, material: 1 / 3, scale: 0, pan: 0, weather: 0.8,
  },
};

export const DEFAULT_AMBIENT_SPACE: Readonly<AmbientSpaceSettings> = { size: 0.45, damping: 0.5, echoes: 0.1, amount: 0.7 };
export const DEFAULT_AMBIENT_WEATHER: Readonly<AmbientWeatherSettings> = { gustiness: 0.4, paceSec: 12 };

/** A roster channel at its defaults (enabled unless said otherwise). */
export function createAmbientChannel<K extends AmbientChannelKind>(
  id: string,
  kind: K,
  overrides: Partial<AmbientChannelOfKind<K>> = {},
): AmbientChannelOfKind<K> {
  return {
    ...AMBIENT_CHANNEL_DEFAULTS[kind],
    id,
    ...overrides,
  } as unknown as AmbientChannelOfKind<K>;
}

// ---------------------------------------------------------------------------
// Factory soundscapes, authored directly.

type ChannelFields<C> = C extends AmbientChannelSettings ? Partial<Omit<C, 'id' | 'kind'>> : never;
type ChannelOverrides = { [id: string]: ChannelFields<AmbientChannelSettings> };

function soundscape(
  channels: ChannelOverrides,
  space: Partial<AmbientSpaceSettings> = {},
  weather: Partial<AmbientWeatherSettings> = {},
): AmbientSettings {
  return {
    channels: AMBIENT_CHANNEL_ROSTER.map((entry) => {
      const overrides = channels[entry.id];
      return createAmbientChannel(entry.id, entry.kind, overrides
        ? { enabled: true, ...overrides } as Partial<AmbientChannelSettings>
        : { enabled: false });
    }),
    space: { ...DEFAULT_AMBIENT_SPACE, ...space },
    weather: { ...DEFAULT_AMBIENT_WEATHER, ...weather },
  };
}

/** The factory soundscapes, in the order the settings panel shows them. */
export const AMBIENT_FACTORY_PRESETS: readonly AmbientPreset[] = [
  {
    id: 'stormy-night',
    name: 'Stormy Night',
    settings: soundscape({
      'chimes-1': { activity: 0.79, distance: 0.86, hardness: 1, material: 0.68, pan: -0.61, pitchHz: chimeSemitoneHz(-10), ringSec: 15, scale: 1, tubes: 8, unison: 0, volume: 0.66 },
      'chimes-2': { activity: 0.69, distance: 0.8, hardness: 0.22, material: 0.06, pan: 0.57, pitchHz: chimeSemitoneHz(2), ringSec: 15, scale: 1, unison: 0.84, volume: 0.57, weather: 1 },
      'noise-1': { brightnessHz: 1232.94, colour: 0.8, curve: 0.58, depth: 0.35, distance: 0.6, focus: 0.28, periodSec: 10.706, sweep: 0.38, variation: 0.64, volume: 0.76, weather: 0.5, width: 0.98 },
      'noise-2': { brightnessHz: 661.36, volume: 0.79 },
      'noise-3': { brightnessHz: 120.09, colour: 0, focus: 0.35, volume: 0.75 },
      'rain-1': { distance: 0.1, drips: 0.55, intensity: 0.55, pan: -0.5, resonance: 0.15, splashLevel: 0.57, surface: 0.39, volume: 0.74, washDensity: 0.85, washLevel: 0.77, washTone: 0.23, wetness: 0.73 },
      'rain-2': { distance: 0.5, drips: 0.72, dropLevel: 0.74, intensity: 0.45, pan: 0.3, resonance: 0.83, splashLevel: 0.51, volume: 0.69, washDensity: 0.95, washLevel: 0.84, washTone: 0.23, wetness: 0.51 },
      'rain-3': { distance: 0.9, drips: 0.38, dropLevel: 0.681, intensity: 0.85, resonance: 0.82, splashLevel: 0.49, surface: 0.44, volume: 0.97, washDensity: 0.69, washLevel: 0.89, washTone: 0.46, wetness: 0.7 },
      'thunder-1': { character: 0.87, contrast: 0.47, distance: 0.6, lengthSec: 30, pan: -0.28, randomness: 0.11, share: 0.67, spread: 1, volume: 1 },
    }, { amount: 0.42, damping: 0.82, echoes: 0.63, size: 0.76 }, { gustiness: 0.88, paceSec: 4.681 }),
  },
  {
    id: 'parking',
    name: 'Rain at the parking lot',
    settings: soundscape({
      'noise-1': { brightnessHz: 562.18, colour: 0.14, depth: 0.65, distance: 0.41, periodSec: 16.083, sweep: 0.3, variation: 0.6, volume: 0.81, weather: 0.82 },
      'noise-2': { brightnessHz: 6976.55, colour: 0.76, curve: 0.4, depth: 0.54, distance: 0.9, periodSec: 30, sweep: 1, variation: 0.65, volume: 0.79, weather: 0.97 },
      'noise-3': { colour: 0.2, focus: 0.8, sway: 0.28, variation: 0.51, volume: 0.57, weather: 0.84 },
      'rain-1': { distance: 0.5, dripLevel: 0.32, drips: 0.82, dripTone: 0.4, dropLevel: 0.62, dropTone: 0.01, intensity: 0.87, resonance: 0, splashLevel: 0.77, splashTone: 0.76, surface: 0.73, volume: 0.93, washDensity: 0.96, washLevel: 0.85, washTone: 0.14, wetness: 0.32 },
      'rain-2': { distance: 0.3, dripLevel: 0.6, drips: 0.6, dropTone: 0.18, resonance: 0.6, splashLevel: 0.57, surface: 0.13, volume: 0.8, washDensity: 0.71, washLevel: 0.9, washTone: 0.31, wetness: 0.4, width: 0.65 },
      'rain-3': { distance: 0, dripLevel: 0.5, drips: 0.09, dripTone: 1, dropLevel: 0.63, dropTone: 0, intensity: 0.85, resonance: 0.54, splashLevel: 0.53, splashTone: 0.3, surface: 0.14, washDensity: 0.17, washLevel: 0.84, washTone: 0.09, weather: 0.94, wetness: 0.36 },
    }, { damping: 0.35, echoes: 0.55, size: 0.6 }, { paceSec: 13 }),
  },
  {
    id: 'winds',
    name: 'Strong winds',
    settings: soundscape({
      'noise-1': { brightnessHz: 113.76, colour: 0.88, focus: 0.75, periodSec: 38.074, sweep: 0.24, volume: 0.84 },
      'noise-2': { brightnessHz: 1167.94, colour: 0.26, focus: 0.42, sweep: 0.2, volume: 1, weather: 1 },
      'noise-3': { brightnessHz: 562.18, colour: 0.17, curve: 0.13, distance: 0.67, focus: 0.11, periodSec: 29.969, skew: 0.23, sway: 0.03, sweep: 0.2, variation: 0.44, volume: 0.94, weather: 1 },
      'noise-4': { brightnessHz: 2778.24, colour: 0.7, focus: 0.19, sweep: 0.18, volume: 0.9 },
      'noise-5': { colour: 0.45, depth: 0.11, distance: 0.39, periodSec: 9.729, sway: 0.19, sweep: 0.22, variation: 0.92, volume: 0.84, weather: 0.63 },
      'noise-6': { brightnessHz: 10472.59, colour: 0.65, focus: 0.13, periodSec: 4.11, sway: 0.01, variation: 0.87, volume: 0.82 },
      'thunder-2': { character: 0.95, contrast: 0.28, distance: 0.72, lengthSec: 24, randomness: 0.81, share: 0.825, spread: 1, volume: 1, weather: 0.63 },
    }, { damping: 0.35, echoes: 0.55, size: 0.6 }, { paceSec: 13 }),
  },
  {
    id: 'underwater',
    name: 'Under water',
    settings: soundscape({
      'noise-1': { brightnessHz: 200.89, colour: 0.02, periodSec: 14.615, sweep: 0.04, volume: 1 },
      'noise-2': { brightnessHz: 86.77, colour: 0, focus: 0.58, skew: 0.19, sway: 0.18, sweep: 0.12, volume: 0.88, width: 0.87 },
      'noise-3': { brightnessHz: 170.76, colour: 0, depth: 0.24, focus: 0.79, periodSec: 28.568, skew: 0.31, sway: 0.06, variation: 0, volume: 0.78 },
      'noise-4': { brightnessHz: 80, colour: 0.02, depth: 0.28, focus: 0.31, skew: 0.38, sweep: 0.36, variation: 0, volume: 0.84 },
      'water-1': { bubbleLevel: 0.62, bubbles: 0.26, distance: 0.32, ring: 0.33, rise: 0.13, rushLevel: 0.79, rushTone: 0.2, size: 0.9, sizeSpread: 0.62, turbulence: 0.7, volume: 0.52 },
      'water-2': { bubbleLevel: 0.8, bubbles: 0.34, distance: 0.54, ring: 0.23, rise: 0.35, rush: 0.66, rushLevel: 0, rushTone: 0.84, sizeSpread: 0.48, turbulence: 0.73, volume: 0.26 },
    }, { damping: 0.35, echoes: 0.55, size: 0.6 }, { paceSec: 13 }),
  },
  {
    id: 'campsite',
    name: 'Campsite',
    settings: soundscape({
      'chimes-1': { activity: 0.77, distance: 0, hardness: 0.34, material: 0.08, pan: 0.38, pitchHz: 440, ringSec: 13.644, scale: 30, tubes: 4, unison: 0.7, volume: 0.32 },
      'fire-1': { crackle: 0.77, flicker: 0.27, flickerDynamics: 0.64, flickerPeriodSec: 0.207, pan: 0.3, size: 0.81, sizzleLevel: 0.58, volume: 0.86, width: 0.35 },
      'noise-1': { brightnessHz: 4775.16, colour: 0.73, depth: 0.75, distance: 0.73, periodSec: 11.782, skew: 0.41, sweep: -0.08, variation: 0.65, volume: 0.61 },
      'noise-2': { brightnessHz: 153.23, colour: 0.22, depth: 0.42, focus: 0.84, skew: 0.28, sway: 0.19, variation: 0.98, volume: 0.64 },
      'water-1': { bubbleLevel: 0.7, bubbles: 0.45, distance: 0.57, pan: -0.37, ring: 0.39, rise: 0.27, rushLevel: 0.98, rushTone: 0.62, size: 0.85, sizeSpread: 0.82, turbulence: 0.46, volume: 0.59, width: 0.56 },
    }, { damping: 0.35, echoes: 0.55, size: 0.6 }, { paceSec: 13 }),
  },
  {
    id: 'storm',
    name: 'Passing thunderstorm',
    settings: soundscape({
      'noise-1': { brightnessHz: 562.18, colour: 0.14, depth: 0.65, distance: 0.41, periodSec: 16.083, sway: 0.32, sweep: 0.3, variation: 0.6, volume: 0.81, weather: 0.82 },
      'noise-2': { brightnessHz: 6976.55, colour: 0.76, curve: 0.4, depth: 0.54, distance: 0.9, periodSec: 30, sway: 0.26, sweep: 1, variation: 0.65, volume: 0.79, weather: 0.97 },
      'noise-3': { colour: 0.2, focus: 0.8, sway: 0.28, variation: 0.51, volume: 0.57, weather: 0.84 },
      'noise-4': { brightnessHz: 13005.93, colour: 0.29, depth: 0.81, distance: 0.55, focus: 0.14, periodSec: 43.955, skew: 0.68, sway: 0.23, sweep: 0.97, variation: 1, volume: 0.91, weather: 0.9 },
      'noise-5': { brightnessHz: 5930.28, colour: 0.23, curve: 0.32, depth: 0.74, distance: 0.38, periodSec: 43.955, skew: 0.16, sway: 0.47, sweep: 0.93, variation: 0.62, weather: 1 },
      'rain-1': { distance: 0.5, dripLevel: 0.32, drips: 0.82, dripTone: 0.4, dropLevel: 0.62, dropTone: 0.01, intensity: 0.87, resonance: 0, splashLevel: 0.77, splashTone: 0.76, surface: 0.73, volume: 0.93, washDensity: 0.96, washLevel: 0.85, washTone: 0.14, wetness: 0.32 },
      'rain-2': { distance: 0.3, dripLevel: 0.6, drips: 0.85, dropTone: 0.1, resonance: 0.74, splashLevel: 0.57, surface: 0.01, volume: 0.92, washDensity: 0.25, washLevel: 0.9, washTone: 0.31, wetness: 0.75, width: 0.65 },
      'rain-3': { distance: 0, dripLevel: 0.5, drips: 0.59, dripTone: 0.55, dropLevel: 0.63, dropTone: 0, intensity: 0.85, resonance: 0.54, splashLevel: 0.53, splashTone: 0.3, surface: 0.14, volume: 0.69, washDensity: 0.82, washLevel: 0.81, washTone: 0.09, weather: 0.94, wetness: 0.36 },
      'thunder-1': { character: 0.94, contrast: 0.77, pan: -0.3, share: 0.715, spread: 0.89, volume: 0.91 },
      'thunder-2': { character: 0.81, contrast: 0.28, distance: 0.29, lengthSec: 25, share: 0.865, volume: 0.92 },
      'thunder-3': { pan: 0.49, share: 0.705, spread: 0.92, weather: 0.76 },
    }, { damping: 0.35, echoes: 0.55, size: 0.51 }, { gustiness: 1, paceSec: 4.681 }),
  },
];

export const DEFAULT_AMBIENT_SETTINGS: AmbientSettings = cloneSettings(AMBIENT_FACTORY_PRESETS[0].settings);

export const DEFAULT_AMBIENT_PREFERENCES: AmbientPreferences = {
  enabled: false,
  masterVolume: AMBIENT_DEFAULT_MASTER_VOLUME,
  settings: cloneSettings(DEFAULT_AMBIENT_SETTINGS),
  activePresetId: AMBIENT_FACTORY_PRESETS[0].id,
  customPresets: [],
};

export function cloneSettings(settings: AmbientSettings): AmbientSettings {
  return {
    channels: settings.channels.map((channel) => ({ ...channel })),
    space: { ...settings.space },
    weather: { ...settings.weather },
  };
}

// ---------------------------------------------------------------------------
// Signature: equal for two soundscapes exactly when they sound the same.

/**
 * Used to tell which preset, if any, the current settings match. It leaves
 * out `id`s' order-independent identity (channels are in roster order) and
 * `solo` (a listening aid, not part of the sound), and everything on
 * AmbientPreferences outside `settings`. A disabled channel's controls are
 * still part of it: they are what enabling the channel brings back.
 */
export function ambientSettingsSignature(settings: AmbientSettings): string {
  const fields = (record: object, skip: ReadonlySet<string>) => Object.entries(record)
    .filter(([key]) => !skip.has(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${typeof value === 'number' ? value.toFixed(4) : String(value)}`)
    .join(',');
  const skipChannel = new Set(['solo']);
  const none = new Set<string>();
  return [
    ...settings.channels.map((channel) => fields(channel, skipChannel)),
    `space:${fields(settings.space, none)}`,
    `weather:${fields(settings.weather, none)}`,
  ].join('|');
}

// ---------------------------------------------------------------------------
// Sanitizing.

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteRange(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

/** How each stored field is bounded: [min, max], plus `integer` where only whole numbers mean anything. */
type FieldBounds = { [field: string]: readonly [number, number] | readonly [number, number, 'integer'] };

const COMMON_BOUNDS: FieldBounds = { volume: [0, 1], distance: [0, 1] };
const UNIT = [0, 1] as const;
const SIGNED = [-1, 1] as const;

export const AMBIENT_FIELD_BOUNDS: { [K in AmbientChannelKind]: FieldBounds } = {
  noise: {
    ...COMMON_BOUNDS, colour: UNIT, brightnessHz: [AMBIENT_NOISE_BRIGHTNESS_MIN_HZ, AMBIENT_NOISE_BRIGHTNESS_MAX_HZ],
    focus: UNIT, depth: UNIT, periodSec: [AMBIENT_PERIOD_MIN_SEC, AMBIENT_PERIOD_MAX_SEC], curve: UNIT,
    skew: [AMBIENT_SKEW_MIN, AMBIENT_SKEW_MAX], sweep: SIGNED, variation: UNIT, sway: UNIT, width: UNIT, weather: UNIT,
  },
  rain: {
    ...COMMON_BOUNDS, surface: UNIT, resonance: UNIT, intensity: UNIT, dropLevel: UNIT, dropTone: UNIT,
    washDensity: UNIT, washLevel: UNIT, washTone: UNIT, drips: UNIT, dripLevel: UNIT, dripTone: UNIT,
    wetness: UNIT, splashLevel: UNIT, splashTone: UNIT, pan: SIGNED, width: UNIT, weather: UNIT,
  },
  thunder: {
    ...COMMON_BOUNDS, share: UNIT, pan: SIGNED, spread: UNIT, character: UNIT, contrast: SIGNED, randomness: UNIT,
    lengthSec: [AMBIENT_THUNDER_LENGTH_MIN_SEC, AMBIENT_THUNDER_LENGTH_MAX_SEC], weather: UNIT,
  },
  water: {
    ...COMMON_BOUNDS, turbulence: UNIT, width: UNIT, bubbles: UNIT, bubbleLevel: UNIT, size: UNIT, sizeSpread: UNIT,
    rise: UNIT, ring: UNIT, rush: UNIT, rushLevel: UNIT, rushTone: UNIT, pan: SIGNED,
  },
  fire: {
    ...COMMON_BOUNDS, size: UNIT, width: UNIT, crackle: UNIT, crackleLevel: UNIT, crackleTone: UNIT, pops: UNIT, popLevel: UNIT, popTone: UNIT,
    sizzle: UNIT, sizzleLevel: UNIT, sizzleTone: UNIT, flicker: UNIT, flickerPeriodSec: [AMBIENT_FIRE_PERIOD_MIN_SEC, AMBIENT_FIRE_PERIOD_MAX_SEC],
    flickerDynamics: UNIT, pan: SIGNED, weather: UNIT,
  },
  chimes: {
    ...COMMON_BOUNDS, pitchHz: [AMBIENT_CHIME_PITCH_MIN_HZ, AMBIENT_CHIME_PITCH_MAX_HZ],
    tubes: [AMBIENT_CHIME_TUBES_MIN, AMBIENT_CHIME_TUBES_MAX, 'integer'],
    ringSec: [AMBIENT_CHIME_RING_MIN_SEC, AMBIENT_CHIME_RING_MAX_SEC], activity: UNIT, hardness: UNIT, unison: UNIT, material: UNIT,
    scale: [0, CHIME_SCALE_COUNT - 1, 'integer'], pan: SIGNED, weather: UNIT,
  },
};

export const AMBIENT_SPACE_BOUNDS: FieldBounds = { size: UNIT, damping: UNIT, echoes: UNIT, amount: UNIT };
export const AMBIENT_WEATHER_BOUNDS: FieldBounds = { gustiness: UNIT, paceSec: [AMBIENT_WEATHER_PACE_MIN_SEC, AMBIENT_WEATHER_PACE_MAX_SEC] };

function sanitizeFields<T extends object>(source: Record<string, unknown>, bounds: FieldBounds, fallback: T): T {
  const result: Record<string, unknown> = { ...(fallback as Record<string, unknown>) };
  for (const [field, range] of Object.entries(bounds)) {
    const value = finiteRange(source[field], range[0], range[1], (fallback as Record<string, number>)[field]);
    result[field] = range[2] === 'integer' ? Math.round(value) : value;
  }
  return result as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * Read stored settings. Channels are matched to the roster by id; a stored
 * channel the roster does not name is dropped, and a roster channel with
 * nothing stored starts disabled at its defaults. Anything not in this shape
 * -- a save from before the roster -- reads as the default soundscape.
 */
export function sanitizeAmbientSettings(input: unknown): AmbientSettings {
  const source = asRecord(input);
  if (!Array.isArray(source.channels)) return cloneSettings(DEFAULT_AMBIENT_SETTINGS);
  const stored = new Map<string, Record<string, unknown>>();
  for (const item of source.channels) {
    const record = asRecord(item);
    if (typeof record.id === 'string' && !stored.has(record.id)) stored.set(record.id, record);
  }
  let soloSeen = false;
  const channels = AMBIENT_CHANNEL_ROSTER.map((entry): AmbientChannelSettings => {
    const saved = stored.get(entry.id);
    const fallback = createAmbientChannel(entry.id, entry.kind, { enabled: false });
    if (!saved) return fallback;
    const solo = saved.solo === true && !soloSeen;
    if (solo) soloSeen = true;
    const fields = sanitizeFields(saved, AMBIENT_FIELD_BOUNDS[entry.kind], fallback) as unknown as Record<string, unknown>;
    // Chimes are tuned in semitones: a stored pitch lands on the nearest one.
    if (entry.kind === 'chimes') fields.pitchHz = chimeSemitoneHz(chimeSemitoneOf(fields.pitchHz as number));
    return {
      ...fields,
      id: entry.id,
      kind: entry.kind,
      enabled: saved.enabled !== false,
      solo,
    } as AmbientChannelSettings;
  });
  return {
    channels,
    space: sanitizeFields(asRecord(source.space), AMBIENT_SPACE_BOUNDS, { ...DEFAULT_AMBIENT_SPACE }),
    weather: sanitizeFields(asRecord(source.weather), AMBIENT_WEATHER_BOUNDS, { ...DEFAULT_AMBIENT_WEATHER }),
  };
}

export function sanitizeAmbientPreferences(input: unknown): AmbientPreferences {
  const source = asRecord(input);
  const rawCustom = Array.isArray(source.customPresets) ? source.customPresets : [];
  const seenIds = new Set<string>();
  const customPresets = rawCustom.slice(0, MAX_AMBIENT_CUSTOM_PRESETS).flatMap((item): AmbientPreset[] => {
    const entry = asRecord(item);
    if (typeof entry.id !== 'string' || !entry.id || seenIds.has(entry.id)) return [];
    if (typeof entry.name !== 'string' || !entry.name.trim()) return [];
    if (!Array.isArray(asRecord(entry.settings).channels)) return [];
    seenIds.add(entry.id);
    const settings = sanitizeAmbientSettings(entry.settings);
    return [{
      id: entry.id.slice(0, 80),
      name: entry.name.trim().slice(0, 40),
      settings: { ...settings, channels: settings.channels.map((channel) => ({ ...channel, solo: false })) },
    }];
  });
  const activePresetId = typeof source.activePresetId === 'string'
    && (AMBIENT_FACTORY_PRESETS.some((item) => item.id === source.activePresetId)
      || customPresets.some((item) => item.id === source.activePresetId))
    ? source.activePresetId
    : null;

  return {
    enabled: source.enabled === true,
    masterVolume: finiteRange(source.masterVolume, 0, 1, AMBIENT_DEFAULT_MASTER_VOLUME),
    settings: sanitizeAmbientSettings(source.settings),
    activePresetId,
    customPresets,
  };
}

/**
 * Switch to a soundscape: its settings, ambient sound turned on, and the
 * preset marked active. Solo is a listening aid rather than part of the
 * sound, so whichever channel was soloed stays soloed. The one way a preset
 * is applied, whether from the settings panel or the player's switch.
 */
export function applyAmbientPreset(preferences: AmbientPreferences, preset: AmbientPreset): AmbientPreferences {
  const soloId = preferences.settings.channels.find((channel) => channel.solo)?.id ?? null;
  const settings = cloneSettings(preset.settings);
  return {
    ...preferences,
    enabled: true,
    settings: { ...settings, channels: settings.channels.map((channel) => ({ ...channel, solo: channel.id === soloId })) },
    activePresetId: preset.id,
  };
}

/**
 * The soundscape after the active one, for stepping through them from the
 * player: the user's own if there are any, otherwise the factory ones, in
 * the order the settings panel shows them, wrapping at the end.
 */
export function nextAmbientPreset(preferences: AmbientPreferences): AmbientPreset {
  const cycle = preferences.customPresets.length > 0 ? preferences.customPresets : AMBIENT_FACTORY_PRESETS;
  const current = cycle.findIndex((preset) => preset.id === preferences.activePresetId);
  return cycle[(current + 1) % cycle.length];
}

/** Whether a soundscape has any layer that could be heard (solo respected). */
export function hasAudibleAmbientLayer(settings: AmbientSettings): boolean {
  const soloChannel = settings.channels.find((channel) => channel.solo);
  if (soloChannel) return soloChannel.enabled && soloChannel.volume > 0;
  return settings.channels.some((channel) => channel.enabled && channel.volume > 0);
}
