/**
 * The visualizer: elements of the look that follow the playing music, saved
 * with the layout like every other part of it (Options > Visualizer). Three
 * independent BLOCKS, each listening to its own band (or a drum: kick, snare or hat) with
 * its own timing: the caret, which dips; the active editor's EDGE (an inner shadow); and the
 * PANE (the box outlines in the edit view, a flat wash of colour anywhere else). The edge and the pane each have a colour, picked like any
 * other layout colour (so a theme's invert applies to it as to the rest).
 *
 * Whether the visualizer is on, and the per-device visual delay, are NOT
 * here: on/off persists across layout switches (as the custom cursor's
 * does), and a delay belongs to the sound device, not to a look
 * (`apps/notes/src/shared/beatSettings.ts`). The engine is the notes app's
 * `sound/musicBeat.ts`; this file is only the shape, its defaults and its
 * sanitizer, shared by the renderer and the main process.
 */

/** A drum the drum tracker (the notes app's `sound/drumTracker.ts`) finds the hits of. */
export type VisualizerDrum = 'kick' | 'snare' | 'hat'

/**
 * The three TRACKERS: what is detected in the music, once per layout, apart
 * from what shows it. Every block that follows the music reads all three
 * through its own MIX (`VisualizerMix`), so one detection can drive any number
 * of elements and an element can follow several detections at once.
 *
 * - `kicks`, the kick drum's hits: the boomy thump felt in the chest.
 * - `hits`, the snare's hits (and claps and rim shots): the bright counter
 *   hits piercing through at mid and high frequencies.
 * - `band`, the live level of one band of the spectrum, a bell of `octaves`
 *   between its half-power points around `frequencyHz`, smoothed by a fixed
 *   attack and release (the notes app's `sound/musicBeat.ts`) so it does not
 *   flicker.
 */
export type VisualizerTrackerName = 'kicks' | 'hits' | 'band'

export const VISUALIZER_TRACKERS: readonly VisualizerTrackerName[] = ['kicks', 'hits', 'band']

/** The drum each hit tracker follows. */
export const TRACKER_DRUM: Record<'kicks' | 'hits', VisualizerDrum> = { kicks: 'kick', hits: 'snare' }

/** A drum tracker's settings. */
export interface VisualizerDrumTracker {
  /**
   * 0..1: how steadily it holds the pattern the drum has been playing
   * against what it hears (the notes app's `sound/drumTracker.ts`, GROOVE).
   * 0 shows only the hits it hears, the pattern a filter; 1 lands every hit
   * of the pattern at full strength, masked or not, ignores a one-off off it,
   * and stops through a break.
   */
  groove: number
  /** Where a response starts, as a share of the surrounding ten seconds: higher keeps only the biggest hits. */
  contrast: number
}

/** The band tracker's settings. */
export interface VisualizerBandTracker {
  /** The centre of the band, in Hz. */
  frequencyHz: number
  /** The band's width, in octaves, between its half-power points. */
  octaves: number
  /** Where its response starts, as a share of the band's levels over the surrounding ten seconds. */
  contrast: number
}

export interface VisualizerTrackers {
  kicks: VisualizerDrumTracker
  hits: VisualizerDrumTracker
  band: VisualizerBandTracker
}

/**
 * How much each tracker drives one element, each 0..1, and how the sum is
 * scaled (`mixResponse`). The centre pulse takes no band (a level has no
 * hits to set a pulse off), so its `band` is always 0.
 */
export interface VisualizerMix {
  kicks: number
  hits: number
  band: number
  /**
   * 0..1, the RELATIVE SCALING: at 0 each tracker adds its response times its
   * contribution, at 1 that sum is divided by the sum of the contributions,
   * linearly between.
   */
  normalize: number
}

/**
 * An element's response from the trackers' (each 0..1): every tracker's
 * response times its contribution, summed, divided by a divisor running
 * linearly from 1 (`normalize` 0) to the contributions' own sum (1), and
 * capped at 1. So at 0 a single contribution of 1 peaks the element and two
 * at once cannot exceed it; at 1 the element peaks only when every tracker it
 * follows does, and a lone contribution of any size peaks it (100 kick and 50
 * hits read a full kick alone as 100/150). No contribution at all is no response.
 */
export function mixResponse(mix: VisualizerMix, kicks: number, hits: number, band: number): number {
  const sum = mix.kicks + mix.hits + mix.band
  if (!(sum > 0)) return 0
  const divisor = 1 + mix.normalize * (sum - 1)
  return Math.min(1, (kicks * mix.kicks + hits * mix.hits + band * mix.band) / divisor)
}

/** Whether a mix reads `tracker` at all. */
export function mixReads(mix: VisualizerMix, tracker: VisualizerTrackerName): boolean {
  return mix[tracker] > 0
}

/** How one block follows the music. */
export interface VisualizerChannel {
  /**
   * The share of the block's effect a full response reaches, -1..1. Positive:
   * a hit adds it. Negative: inverted, the block rests at |effect| while music
   * plays and a hit takes it away. Zero: off.
   */
  effect: number
  /** How much each tracker drives it. */
  mix: VisualizerMix
  /**
   * The fall's shape, -1..1 (`pulseCurve`): positive is a sharp point that
   * drops at once into a long low tail (a ride cymbal), negative holds near
   * full and then lets go (a heavy thump), 0 between.
   */
  shape: number
  /** Seconds a hit takes to fall to nothing, `FALL_MIN_SEC`..`FALL_MAX_SEC`; a hit lifts the response at once. */
  fallSec: number
}

/**
 * The caret's block: it ticks on a steady beat that follows the music's
 * tempo (the notes app's beat map, `sound/beatMap.ts`) rather than a band or a drum,
 * so it has only the depth of each beat (`effect`, as a channel's) and the
 * fall each beat makes (`shape` and `fallSec`, cut at the next beat).
 *
 * `followsMusic` is the switch (Options > Caret, the last button of the blink
 * row): while it is on, music is playing and a beat has been found, the caret
 * follows the beat; at any other moment it blinks with its own blink, which
 * the switch leaves selected. The block's sliders are shown only while it is on.
 */
export type VisualizerCaret = Pick<VisualizerChannel, 'effect' | 'shape' | 'fallSec'> & { followsMusic: boolean }

/** A block drawn in a colour of its own. */
export interface VisualizerColorChannel extends VisualizerChannel {
  color: string
}

/**
 * The edge's geometry, which does not follow the music: only its opacity
 * does. It is drawn as two inset shadows (editor.css's `.editor-beat-edge`),
 * a narrow edge (an eighth of the blur) and a soft body.
 */
export interface VisualizerEdgeChannel extends VisualizerColorChannel {
  /** How far, in px, the edge's solid part reaches in from the editor's edges (both shadows' spread radius). */
  spreadPx: number
  /** How soft its edge is, in px: the soft body's blur radius; the narrow edge's is an eighth of it. */
  blurPx: number
}

export const EDGE_SPREAD_MAX_PX = 200
export const EDGE_BLUR_MAX_PX = 200
export const DEFAULT_EDGE_SPREAD_PX = 0
export const DEFAULT_EDGE_BLUR_PX = 100

export interface VisualizerSettings {
  /** What is detected in the music, read by every block below through its own mix. */
  trackers: VisualizerTrackers
  /** The caret, held at its peak while it follows the music and dipped on a steady beat that follows its tempo. */
  caret: VisualizerCaret
  /** The active editor's edge, an inner shadow; a response deepens it. */
  edge: VisualizerEdgeChannel
  /**
   * The pane: in the edit view, a copy of the box outlines over the grid's
   * own; in any view without a grid, a flat wash of its colour over the
   * editor. A response draws it.
   */
  pane: VisualizerColorChannel
  /** The visualizer mode's own look (F3), as opposed to the beat's effects on the editor. */
  immersive: VisualizerImmersive
}

/**
 * The glaze the visualizer mode sways (apps/notes's VisualizerGlaze.tsx):
 * every linear stack and radial source of the layout's glaze, each drawn at
 * `glazeStrength` (in place of the layout's own linear and radial strengths),
 * a linear stack times its share under `glazeSpread` (`glazeLayerShare`), and
 * swaying as far as `swayRangePx` and `swaySpread` say.
 */
export interface VisualizerImmersive {
  glazeStrength: number
  /** -1 to 1, the linear stacks only: 0 draws every stack at full strength; -1 ramps from nothing at the farthest to full at the nearest; 1 the reverse. */
  glazeSpread: number
  /** How far the nearest layer sways from rest, in px, at the music's usual level. */
  swayRangePx: number
  /** 0 to 1: at 0 every layer sways as far as the nearest; at 1 each sways half as far as the one in front of it. */
  swaySpread: number
  /**
   * 0 to `SWAY_PUSH_MAX_PX`: how far each snare hit pushes the linear glaze
   * stacks along their gradient, in px for the nearest, in the drift's
   * direction (forward when there is no drift) (`parallaxSway.ts`). The
   * radial sources do not take it.
   */
  swayPush: number
  /** 0 to 1: the share of each push the glaze slides back on the wave's fall; 0 keeps it all, 1 returns it fully. */
  swayReturn: number
  /** -`SWAY_DRIFT_MAX_PX` to it: a steady drift of the linear stacks along their gradient, px a second for the nearest; 0 none. */
  swayDrift: number
  /** The grid wave's colour (apps/notes's GridWave.tsx), picked like any layout colour, before the theme's invert. */
  waveColor: string
  /** The grid wave's length, in boxes, from one band's peak to the next. */
  waveBoxes: number
  /** Seconds a wave band takes to travel one wave length. */
  waveSec: number
  /** How much each tracker shows the grid wave. */
  waveMix: VisualizerMix
  /** How much each hit tracker sets off the centre pulse; its `band` is always 0. */
  pulseMix: VisualizerMix
  /**
   * The grid wave's rotation, a step of the music's beat, -5..5
   * (`waveTertiaryBeats`): 0 holds it still, positive turns it clockwise,
   * negative counter-clockwise, and the further from 0 the faster.
   */
  waveTurn: number
  /**
   * The grid wave's fall after each hit of its mix (`pulseCurve`), as an
   * edge or pane block's: the wave shows at full strength on a hit and falls
   * to nothing, so between hits it is not there.
   */
  waveShape: number
  waveFallSec: number
  /** The centre pulse's colour (GridWave.tsx), picked like any layout colour. */
  pulseColor: string
  /**
   * The visualizer's ACCENT: the spectrum's bars and the progress track's lit
   * boxes. Empty follows the theme's caret colour, which is what both drew in
   * before they had a colour of their own.
   */
  accentColor: string
  /**
   * The LETTERBOX: the top and bottom strips around the scene. Empty follows
   * the theme's leading and trailing zone colours, the editor's top and bottom
   * sections, which is what the strips drew in before they had one of their own.
   */
  letterboxColor: string
  /** The centre pulse's starting speed, in grid boxes per second, at the ring's inner edge. */
  pulseSpeed: number
  /** 0.1 to 5 seconds: the centre pulse's speed halves every this long (exponentially). */
  pulseHalfLifeSec: number
  /** 0.1 to 5 seconds: each pulse layer fades linearly from full to nothing over this long. */
  pulseFadeSec: number
  /** 0 to 1: how gradually the pulse's ring fades at its edges (`pulseRingStrength`); 0 is a hard-edged band, 1 a smooth bell. */
  pulseSoftness: number
  /**
   * 0 to 1: SIGNAL BOOST, how far the centre pulse (its ring and the solid's
   * thump) is lifted above the strength of the hit that set it off. At 1
   * every hit pulses in full; at 0 a hit pulses in proportion to its strength.
   */
  pulseBoost: number
  /** 0 to 1: how round the centre cutout's corners are, as a share of half its side; 0 square (the cutout as it always was), 1 a circle. The grid's square hole stays the same whole boxes either way. */
  cutoutRound: number
}

export const IMMERSIVE_GLAZE_STRENGTH_MAX = 0.2
export const IMMERSIVE_SWAY_RANGE_MAX_PX = 200
export const SWAY_DRIFT_MAX_PX = 200
export const SWAY_PUSH_MAX_PX = 10
export const WAVE_BOXES_MIN = 2
export const WAVE_BOXES_MAX = 256
export const WAVE_SEC_MIN = 0.5
export const WAVE_SEC_MAX = 30
export const PULSE_SPEED_MIN = 2
export const PULSE_SPEED_MAX = 100
export const PULSE_SEC_MIN = 0.1
export const PULSE_SEC_MAX = 5
/**
 * Beats per turn of the grid wave's TERTIARY rotation at each step away from
 * still (`waveTurn` 1..5, or -1..-5): the secondary turns 4 times slower and
 * the primary 16 (the visualizer's GridWave.tsx).
 */
export const WAVE_TURN_BEATS = [16, 8, 4, 2, 1] as const
export const WAVE_TURN_MAX = WAVE_TURN_BEATS.length

/** Beats per tertiary turn at `waveTurn`, signed (negative counter-clockwise); null when it holds still. */
export function waveTertiaryBeats(waveTurn: number): number | null {
  if (waveTurn === 0) return null
  return Math.sign(waveTurn) * WAVE_TURN_BEATS[Math.abs(waveTurn) - 1]
}
/** The base every layout's immersive block is built from; neither side's default as it stands (`defaultVisualizer`). */
export const DEFAULT_VISUALIZER_IMMERSIVE: VisualizerImmersive = { glazeStrength: 0.1, glazeSpread: 0, swayRangePx: 40, swaySpread: 0.5, swayPush: 3, swayReturn: 1, swayDrift: 0, waveColor: 'rgba(0, 0, 0, 0.086)', waveBoxes: 128, waveSec: 6, waveTurn: 0, waveShape: 0, waveFallSec: 0.25, pulseColor: 'rgba(0, 0, 0, 0.086)', pulseSpeed: 20, pulseHalfLifeSec: 5, pulseFadeSec: 5, pulseSoftness: 1, pulseBoost: 1, cutoutRound: 0, accentColor: '', letterboxColor: '', waveMix: { kicks: 0, hits: 1, band: 0, normalize: 0 }, pulseMix: { kicks: 1, hits: 0, band: 0, normalize: 0 } }

/**
 * A swayed layer's share of the glaze strength, from its place in the stack
 * (`position`: 0 the farthest, 1 the nearest) and the spread. At 0 every layer
 * has all of it; towards -1 the share blends to `position` (nothing at the
 * back, all at the front); towards 1 to `1 - position` (the reverse).
 */
export function glazeLayerShare(position: number, spread: number): number {
  const ramp = spread < 0 ? position : 1 - position
  const amount = Math.abs(spread)
  return 1 - amount + amount * ramp
}

export const BEAT_FREQUENCY_MIN_HZ = 20
export const BEAT_FREQUENCY_MAX_HZ = 20000
export const BEAT_OCTAVES_MIN = 0.1
export const BEAT_OCTAVES_MAX = 4
export const BEAT_CONTRAST_MAX = 0.95
/**
 * The fall's length. The shortest still spans six frames at 60Hz, so even the
 * sharpest fall is drawn as a run of values rather than as on and off.
 */
export const FALL_MIN_SEC = 0.1
export const FALL_MAX_SEC = 2
/** The exponents at the two ends of `shape` (`pulseCurve`). */
const TAIL_POWER_MAX = 4
const HOLD_POWER_MAX = 4

/**
 * The fall, 1 at `u = 0` (the hit) to 0 at `u = 1` (its length elapsed):
 * `(1 - u^q)^p`. `p` is the TAIL, raised from 2 to `TAIL_POWER_MAX` as
 * `shape` goes positive (the drop gets sharper and the tail longer); `q` is
 * the HOLD, raised from 1 to `HOLD_POWER_MAX` as it goes negative (it stays
 * near full for longer, then drops). `p` never goes below 2, so every fall
 * LANDS with zero slope: the last frames before nothing move by little, and
 * no shape ends in a step (a root curve, which an earlier shape reached,
 * left most of its value standing until its final frame).
 */
export function pulseCurve(u: number, shape: number): number {
  if (u <= 0) return 1
  if (u >= 1) return 0
  const p = 2 * (TAIL_POWER_MAX / 2) ** Math.max(0, shape)
  const q = HOLD_POWER_MAX ** Math.max(0, -shape)
  return (1 - u ** q) ** p
}

/** A layout saved with one `mass` slider (light: short and early, heavy: long and held) as the fall it made. */
function fallOfMass(mass: number): { shape: number; fallSec: number } {
  return { shape: 1 - 2 * mass, fallSec: 0.04 * 40 ** mass }
}

/** A mix following one tracker in full. */
export function soleMix(tracker: VisualizerTrackerName): VisualizerMix {
  return { kicks: 0, hits: 0, band: 0, normalize: 0, [tracker]: 1 }
}

/**
 * The trackers' defaults: each drum as it was followed before the trackers
 * were separated from the blocks (groove 0, contrast 0.5), and the band the
 * edge's default band was.
 */
export const DEFAULT_VISUALIZER_TRACKERS: VisualizerTrackers = {
  kicks: { groove: 0, contrast: 0.5 },
  hits: { groove: 0, contrast: 0.5 },
  band: { frequencyHz: 70, octaves: 1, contrast: 0.5 },
}

/**
 * The defaults are the visualizer of a layout the author saved (2026-10-25),
 * its fall lengths rounded to the whole milliseconds the slider shows; a
 * field that layout did not set keeps the value it had before.
 */
export const DEFAULT_VISUALIZER_CHANNEL: VisualizerChannel = {
  effect: 0.6,
  mix: soleMix('kicks'),
  shape: 0,
  fallSec: 0.25,
}

export const DEFAULT_VISUALIZER_CARET: VisualizerCaret = {
  followsMusic: true,
  effect: -1,
  shape: -1,
  fallSec: 1.515,
}

/** The edge's and the pane's sliders, without their colours (which depend on the layout's inversion, `defaultVisualizer`). */
export const DEFAULT_VISUALIZER_EDGE: Omit<VisualizerEdgeChannel, 'color'> = {
  ...DEFAULT_VISUALIZER_CHANNEL,
  effect: 0.2,
  shape: -0.5,
  fallSec: 0.5,
  spreadPx: DEFAULT_EDGE_SPREAD_PX,
  blurPx: DEFAULT_EDGE_BLUR_PX,
}

export const DEFAULT_VISUALIZER_PANE: VisualizerChannel = {
  ...DEFAULT_VISUALIZER_CHANNEL,
  effect: 0.5,
  mix: soleMix('hits'),
  fallSec: 0.25,
}

/**
 * The defaults for a layout, which depend on whether it is inverted: a
 * colour is picked BEFORE the theme's invert, so an edge that darkens and
 * a pane that brightens on screen are stored the other way round in an
 * inverted layout.
 */
export function defaultVisualizer(inverted: boolean): VisualizerSettings {
  // Each side is the author's own tuning (dark: a dark layout the author saved;
  // light: the author's light layout exported 2026-11-01), not one side inverted into the other.
  if (!inverted) return {
    trackers: { ...DEFAULT_VISUALIZER_TRACKERS, band: { frequencyHz: 20000, octaves: 4, contrast: 0 } },
    caret: { ...DEFAULT_VISUALIZER_CARET, fallSec: 1.988171738655529 },
    edge: { ...DEFAULT_VISUALIZER_EDGE, color: 'rgba(0, 0, 0, 0.451)', fallSec: 0.48243336686426647, spreadPx: 10, blurPx: 200 },
    pane: { ...DEFAULT_VISUALIZER_PANE, color: 'rgba(255, 255, 255, 1)', effect: 1 },
    immersive: LIGHT_VISUALIZER_IMMERSIVE,
  }
  return {
    trackers: DEFAULT_VISUALIZER_TRACKERS,
    caret: DEFAULT_VISUALIZER_CARET,
    edge: { ...DEFAULT_VISUALIZER_EDGE, color: 'rgba(0, 0, 0, 0.784)', spreadPx: 10, blurPx: 200 },
    pane: { ...DEFAULT_VISUALIZER_PANE, color: 'rgba(0, 0, 0, 0.275)' },
    immersive: DARK_VISUALIZER_IMMERSIVE,
  }
}

const LIGHT_VISUALIZER_IMMERSIVE: VisualizerImmersive = {
  ...DEFAULT_VISUALIZER_IMMERSIVE,
  glazeStrength: 0.075, glazeSpread: 0.5, swayReturn: 0.8, swayDrift: 5,
  waveColor: 'rgba(0, 0, 0, 0.235)', waveBoxes: 72, waveTurn: 4, waveShape: -0.5, waveFallSec: 0.49958086198073737,
  waveMix: { kicks: 0, hits: 0, band: 1, normalize: 0 },
  pulseColor: 'rgba(255, 255, 255, 0.706)', pulseSpeed: 32, pulseHalfLifeSec: 0.5, pulseFadeSec: 1.5, pulseSoftness: 0.49, pulseBoost: 0,
  cutoutRound: 1, accentColor: 'rgba(0, 0, 0, 0.235)', letterboxColor: 'rgba(255, 255, 255, 1)',
}

const DARK_VISUALIZER_IMMERSIVE: VisualizerImmersive = {
  ...DEFAULT_VISUALIZER_IMMERSIVE,
  swayRangePx: 0, swayDrift: 10,
  waveColor: 'rgba(255, 255, 255, 1)', waveBoxes: 104, waveTurn: 4, waveShape: 0.5, waveFallSec: 1.9949745588310244,
  pulseColor: 'rgba(0, 0, 0, 0.137)', pulseSpeed: 35, pulseHalfLifeSec: 0.7, pulseFadeSec: 1.4, pulseSoftness: 0,
  cutoutRound: 1,
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}

type Fields = Partial<Record<string, unknown>>

function fieldsOf(input: unknown): Fields {
  return (input && typeof input === 'object' ? input : {}) as Fields
}

/** The signed effect; a layout saved with `amount` and `invert` turns into one. */
function sanitizeEffect(source: Fields, fallback: number): number {
  if (source.effect !== undefined) return bounded(source.effect, -1, 1, fallback)
  if (source.amount === undefined) return fallback
  const amount = bounded(source.amount, 0, 1, Math.abs(fallback))
  return source.invert === true ? -amount : amount
}

/** A mix, every contribution bounded; `bandless` (the centre pulse's) has none. */
function sanitizeMix(input: unknown, d: VisualizerMix, bandless = false): VisualizerMix {
  const source = fieldsOf(input)
  return {
    kicks: bounded(source.kicks, 0, 1, d.kicks),
    hits: bounded(source.hits, 0, 1, d.hits),
    band: bandless ? 0 : bounded(source.band, 0, 1, d.band),
    normalize: bounded(source.normalize, 0, 1, d.normalize),
  }
}

/**
 * LEGACY: before the trackers were separated from the blocks (2026-11-01),
 * every block followed ONE source of its own (`source`: a band, the kick,
 * the snare or the hat; a layout older still said the kick with a frequency
 * of 0 and a band with its frequency) with its own band, groove and
 * contrast. Such a block reads as the mix following that source's tracker
 * in full; the hat, which no tracker follows on its own, as the hits (the
 * other bright drum).
 */
function legacyTracker(source: Fields): VisualizerTrackerName | null {
  switch (source.source) {
    case 'kick': return 'kicks'
    case 'snare': case 'hat': return 'hits'
    case 'band': return 'band'
  }
  if (source.frequencyHz === 0) return 'kicks'
  if (typeof source.frequencyHz === 'number' && Number.isFinite(source.frequencyHz)) return 'band'
  return null
}

function sanitizeChannel(input: unknown, d: VisualizerChannel): VisualizerChannel {
  const source = fieldsOf(input)
  const legacy = source.mix === undefined ? legacyTracker(source) : null
  return {
    effect: sanitizeEffect(source, d.effect),
    mix: legacy ? soleMix(legacy) : sanitizeMix(source.mix, d.mix),
    ...sanitizeFall(source, d),
  }
}

function sanitizeDrumTracker(input: unknown, d: VisualizerDrumTracker): VisualizerDrumTracker {
  const source = fieldsOf(input)
  return { groove: bounded(source.groove, 0, 1, d.groove), contrast: bounded(source.contrast, 0, BEAT_CONTRAST_MAX, d.contrast) }
}

function sanitizeBandTracker(input: unknown, d: VisualizerBandTracker): VisualizerBandTracker {
  const source = fieldsOf(input)
  return {
    frequencyHz: bounded(source.frequencyHz, BEAT_FREQUENCY_MIN_HZ, BEAT_FREQUENCY_MAX_HZ, d.frequencyHz),
    octaves: bounded(source.octaves, BEAT_OCTAVES_MIN, BEAT_OCTAVES_MAX, d.octaves),
    contrast: bounded(source.contrast, 0, BEAT_CONTRAST_MAX, d.contrast),
  }
}

/**
 * LEGACY: the trackers of a layout saved before they existed, from its
 * blocks' own settings: each tracker takes the settings of the first block
 * (the edge, then the pane) that followed its source, so the block a reader
 * tuned for a drum or a band keeps that tuning. A tracker no block followed
 * keeps its defaults.
 */
function legacyTrackers(blocks: unknown[], d: VisualizerTrackers): VisualizerTrackers {
  const of = (tracker: VisualizerTrackerName) => blocks.map(fieldsOf).find((block) => legacyTracker(block) === tracker)
  return {
    kicks: sanitizeDrumTracker(of('kicks'), d.kicks),
    hits: sanitizeDrumTracker(of('hits'), d.hits),
    band: sanitizeBandTracker(of('band'), d.band),
  }
}

function sanitizeTrackers(input: unknown, d: VisualizerTrackers): VisualizerTrackers {
  const source = fieldsOf(input)
  return {
    kicks: sanitizeDrumTracker(source.kicks, d.kicks),
    hits: sanitizeDrumTracker(source.hits, d.hits),
    band: sanitizeBandTracker(source.band, d.band),
  }
}

/**
 * The fall's shape and length. A layout saved with one `mass` slider reads
 * as the fall it made; one saved with the first `fallShape` (an exponent of
 * 2^fallShape, -5..5) keeps its sign, at half its value.
 */
function sanitizeFall(source: Fields, d: Pick<VisualizerChannel, 'shape' | 'fallSec'>): Pick<VisualizerChannel, 'shape' | 'fallSec'> {
  const legacy = source.shape === undefined && typeof source.mass === 'number' && Number.isFinite(source.mass)
    ? fallOfMass(Math.max(0, Math.min(1, source.mass)))
    : null
  const shape = source.shape ?? legacy?.shape ?? (typeof source.fallShape === 'number' ? source.fallShape / 2 : undefined)
  return {
    shape: bounded(shape, -1, 1, d.shape),
    fallSec: bounded(source.fallSec ?? legacy?.fallSec, FALL_MIN_SEC, FALL_MAX_SEC, d.fallSec),
  }
}

/**
 * The blink preset that became the follow-the-music switch. A layout saved
 * with it chose the button that is now the switch, so it reads as the switch
 * on (and its blink falls back to the default, `sanitizeLoadout`'s job).
 */
export const LEGACY_FOLLOW_MUSIC_CARET_PRESET = 'bounce'

/**
 * The caret's fields; anything else an older layout saved with it (a source, a band) is dropped.
 * A layout saved before the switch existed followed the music whenever its
 * caret block had an effect, so that is what it reads as, or as on when its
 * blink was the old bounce (`legacyCaretPreset`).
 */
function sanitizeCaret(input: unknown, d: VisualizerCaret, legacyCaretPreset: unknown): VisualizerCaret {
  const source = (input && typeof input === 'object' ? input : null) as Partial<Record<string, unknown>> | null
  const effect = sanitizeEffect(source ?? {}, d.effect)
  const followsMusic = typeof source?.followsMusic === 'boolean'
    ? source.followsMusic
    : legacyCaretPreset === LEGACY_FOLLOW_MUSIC_CARET_PRESET || (source !== null && effect !== 0)
  return { followsMusic, effect, ...sanitizeFall(source ?? {}, d) }
}

function sanitizeColorChannel(input: unknown, d: VisualizerColorChannel): VisualizerColorChannel {
  const color = input && typeof input === 'object' ? (input as { color?: unknown }).color : undefined
  return { ...sanitizeChannel(input, d), color: typeof color === 'string' && color.length > 0 ? color : d.color }
}

function sanitizeEdgeChannel(input: unknown, d: VisualizerEdgeChannel): VisualizerEdgeChannel {
  const source = (input && typeof input === 'object' ? input : {}) as Partial<Record<string, unknown>>
  return {
    ...sanitizeColorChannel(input, d),
    spreadPx: Math.round(bounded(source.spreadPx, 0, EDGE_SPREAD_MAX_PX, d.spreadPx)),
    blurPx: Math.round(bounded(source.blurPx, 0, EDGE_BLUR_MAX_PX, d.blurPx)),
  }
}

function sanitizeImmersive(input: unknown, d: VisualizerImmersive, legacyPulseMix: VisualizerMix | null, legacyWaveMix: VisualizerMix | null): VisualizerImmersive {
  const source = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof VisualizerImmersive, unknown>>
  return {
    glazeStrength: bounded(source.glazeStrength, 0, IMMERSIVE_GLAZE_STRENGTH_MAX, d.glazeStrength),
    glazeSpread: bounded(source.glazeSpread, -1, 1, d.glazeSpread),
    swayRangePx: Math.round(bounded(source.swayRangePx, 0, IMMERSIVE_SWAY_RANGE_MAX_PX, d.swayRangePx)),
    swaySpread: bounded(source.swaySpread, 0, 1, d.swaySpread),
    swayPush: bounded(source.swayPush, 0, SWAY_PUSH_MAX_PX, d.swayPush),
    swayReturn: bounded(source.swayReturn, 0, 1, d.swayReturn),
    swayDrift: bounded(source.swayDrift, -SWAY_DRIFT_MAX_PX, SWAY_DRIFT_MAX_PX, d.swayDrift),
    waveColor: typeof source.waveColor === 'string' && source.waveColor.length > 0 ? source.waveColor : d.waveColor,
    waveBoxes: Math.round(bounded(source.waveBoxes, WAVE_BOXES_MIN, WAVE_BOXES_MAX, d.waveBoxes)),
    waveSec: bounded(source.waveSec, WAVE_SEC_MIN, WAVE_SEC_MAX, d.waveSec),
    waveMix: sanitizeMix(source.waveMix, legacyWaveMix ?? d.waveMix),
    pulseMix: sanitizeMix(source.pulseMix, legacyPulseMix ?? d.pulseMix, true),
    waveTurn: Math.round(bounded(source.waveTurn, -WAVE_TURN_MAX, WAVE_TURN_MAX, d.waveTurn)),
    waveShape: bounded(source.waveShape, -1, 1, d.waveShape),
    waveFallSec: bounded(source.waveFallSec, FALL_MIN_SEC, FALL_MAX_SEC, d.waveFallSec),
    pulseColor: typeof source.pulseColor === 'string' && source.pulseColor.length > 0 ? source.pulseColor : d.pulseColor,
    pulseSpeed: bounded(source.pulseSpeed, PULSE_SPEED_MIN, PULSE_SPEED_MAX, d.pulseSpeed),
    pulseHalfLifeSec: bounded(source.pulseHalfLifeSec, PULSE_SEC_MIN, PULSE_SEC_MAX, d.pulseHalfLifeSec),
    pulseFadeSec: bounded(source.pulseFadeSec, PULSE_SEC_MIN, PULSE_SEC_MAX, d.pulseFadeSec),
    pulseSoftness: bounded(source.pulseSoftness, 0, 1, d.pulseSoftness),
    pulseBoost: bounded(source.pulseBoost, 0, 1, d.pulseBoost),
    cutoutRound: bounded(source.cutoutRound, 0, 1, d.cutoutRound),
    accentColor: typeof source.accentColor === 'string' ? source.accentColor : d.accentColor,
    letterboxColor: typeof source.letterboxColor === 'string' ? source.letterboxColor : d.letterboxColor,
  }
}

/** What the edge and the pane were saved as before they had those names: `shade` and `outline`. */
type LegacyBlockName = 'shade' | 'outline'

/**
 * Every field bounded; a missing one takes the default for a layout of that
 * inversion. `legacyCaretPreset` is the layout's saved blink preset, read
 * only to migrate a layout from before the caret's follow-the-music switch.
 */
export function sanitizeVisualizer(input: unknown, inverted: boolean, legacyCaretPreset?: unknown): VisualizerSettings {
  const d = defaultVisualizer(inverted)
  // A layout saved before the visualizer existed takes the defaults whole:
  // the caret's legacy reading below (no caret block, not following) is for
  // a layout that HAD a visualizer, saved before the caret's switch.
  if (!input || typeof input !== 'object') return d
  const source = input as Partial<Record<keyof VisualizerSettings | LegacyBlockName, unknown>>
  const edgeInput = source.edge ?? source.shade
  const paneInput = source.pane ?? source.outline
  const edge = sanitizeEdgeChannel(edgeInput, d.edge)
  // LEGACY: a layout saved before the trackers had none, and its centre
  // pulse rode the edge's hits; it keeps the edge's drum (a band, which no
  // pulse takes, reads as the kick, the pulse's default).
  const isLegacy = source.trackers === undefined
  // An edge with no effect subscribed nothing, so it set off no pulse.
  const legacyPulseMix = !isLegacy ? null
    : edge.effect === 0 ? { kicks: 0, hits: 0, band: 0, normalize: 0 }
    : soleMix(edge.mix.hits > 0 ? 'hits' : 'kicks')
  return {
    // A legacy layout reads against what the trackers were when it was saved
    // (the band at 70Hz), not against today's light default.
    trackers: isLegacy ? legacyTrackers([edgeInput, paneInput], DEFAULT_VISUALIZER_TRACKERS) : sanitizeTrackers(source.trackers, d.trackers),
    caret: sanitizeCaret(source.caret, d.caret, legacyCaretPreset),
    edge,
    pane: sanitizeColorChannel(paneInput, d.pane),
    // ...and its wave followed the snare, whatever the default wave mix is now.
    immersive: sanitizeImmersive(source.immersive, d.immersive, legacyPulseMix, isLegacy ? soleMix('hits') : null),
  }
}

/**
 * How far, in boxes, the centre pulse has travelled `t` seconds after it set
 * off at `speed` boxes a second, losing `decay` of its speed each second:
 * `v(t) = speed (1 - decay)^t`, integrated. With decay it travels at most
 * `speed / -ln(1 - decay)`.
 */
export function pulseTravelBoxes(t: number, speed: number, halfLifeSec: number): number {
  const k = Math.LN2 / halfLifeSec
  return (speed * (1 - Math.exp(-k * t))) / k
}

/** Seconds the centre pulse takes to travel `distance` boxes, Infinity when its decay stops it short. */
export function pulseTimeToTravel(distance: number, speed: number, halfLifeSec: number): number {
  const k = Math.LN2 / halfLifeSec
  const share = (distance * k) / speed
  return share >= 1 ? Infinity : -Math.log(1 - share) / k
}

/**
 * How far out a point lies on the scale of a rounded square centred on the
 * origin, half-side 1, corner radius `round` of the half-side (0 a square,
 * 1 a circle): the factor the shape must be scaled by for its edge to pass
 * through (x, y). Its level sets are the shape's own scaled copies, so a
 * ring drawn on it has the shape of the cutout at every size.
 */
export function roundedSquareGauge(x: number, y: number, round: number): number {
  const a = Math.max(Math.abs(x), Math.abs(y))
  const b = Math.min(Math.abs(x), Math.abs(y))
  const rho = Math.max(0, Math.min(1, round))
  const c = 1 - rho
  // On a straight side: the larger coordinate.
  if (b <= a * c) return a
  // In a corner: (a - g c)^2 + (b - g c)^2 = (g rho)^2, its smaller positive root.
  const A = 2 * c * c - rho * rho
  const B = -2 * c * (a + b)
  const C = a * a + b * b
  if (Math.abs(A) < 1e-9) return C / (2 * c * (a + b))
  return (-B - Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A)
}

/**
 * The centre pulse's ring strength, 0 to 1, at `gauge` (`roundedSquareGauge`,
 * 1 at the layer's rim), the ring lying between `inner` and 1. Across the
 * ring (u from -1 at an edge to 0 at its middle) the strength is a plateau
 * with ramps `softness` of the half-width wide, each eased by smoothstep: 0
 * is a band with hard edges, 1 a bell with no plateau.
 */
export function pulseRingStrength(gauge: number, softness: number, inner = 0.75): number {
  if (gauge <= inner || gauge >= 1) return 0
  const u = (2 * (gauge - inner)) / (1 - inner) - 1
  const x = Math.min(1, (1 - Math.abs(u)) / Math.max(softness, 1e-3))
  return x * x * (3 - 2 * x)
}
