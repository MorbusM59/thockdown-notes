/**
 * The visualizer: elements of the look that follow the playing music.
 * Independent BLOCKS, each following the trackers through its own mix with
 * its own timing: the active editor's EDGE (an inner shadow); and the
 * PANE (the box outlines in the edit view, a flat wash of colour anywhere else);
 * plus the visualizer mode's own scene (`VisualizerImmersive`).
 *
 * The cut between what is GLOBAL and what belongs to a LAYOUT: how the
 * visualizer follows the music (`VisualizerSettings`, Options > Visualizer)
 * is one setting for every layout, saved in the app state; its COLOURS
 * (`VisualizerColors`, Options > Colors) are part of the layout, picked like
 * any other layout colour (so a theme's invert applies to them as to the
 * rest). The caret following the music is not here: it is the app's
 * flashing curve, matched to the beat (`apps/notes/src/shared/flashing.ts`).
 *
 * Whether the visualizer is on, the per-device visual delay and the
 * response are not here either (`apps/notes/src/shared/beatSettings.ts`).
 * The engine is the notes app's `sound/musicBeat.ts`; this file is only the
 * shapes, their defaults and their sanitizers, shared by the renderer and
 * the main process.
 */

/**
 * The three TRACKERS: what is detected in the music, once per layout, apart
 * from what shows it. Every block that follows the music reads all three
 * through its own MIX (`VisualizerMix`), so one detection can drive any number
 * of elements and an element can follow several detections at once.
 *
 * They are what a listener FEELS rather than which instrument played, the
 * three channels of the notes app's drum score (`sound/drumScore.ts`):
 * - `thump`, the low end jumping: a kick, a bass stab.
 * - `pierce`, a sharp sound cutting through the mix: a snare, a clap.
 * - `tick`, the busy rhythmic top: hats, shakers.
 * One sound may be several at once (a snare with low punch is a pierce with
 * a slight thump); each tracker's contrast decides how much of that shows.
 */
export type VisualizerTrackerName = 'thump' | 'pierce' | 'tick'

export const VISUALIZER_TRACKERS: readonly VisualizerTrackerName[] = ['thump', 'pierce', 'tick']

/**
 * A tracker's settings. It detects nothing: it reads its channel of the drum
 * score written ahead of the listener, and turns each instance into a
 * response.
 */
export interface VisualizerTracker {
  /** The share of the channel's instances around the listener that show nothing: higher keeps only the strongest, and only what is mostly this channel. */
  contrast: number
  /**
   * How far the channel's score follows the bar's pattern rather than the signal alone, 0..1: at 0 every instance is
   * what was heard, higher lifts a weak hit toward the same place in the bars around it and finds expected hits that
   * barely sound. 0.5 is what the score was tuned at.
   */
  pattern: number
}

export type VisualizerTrackers = Record<VisualizerTrackerName, VisualizerTracker>

/** How much each tracker drives one element, each 0..1, added and capped (`mixResponse`). */
export type VisualizerMix = Record<VisualizerTrackerName, number>

/**
 * An element's response from the trackers' (each 0..1): every tracker's
 * response times its contribution, summed and capped at 1, so a single
 * contribution of 1 peaks the element and two at once cannot exceed it. To
 * peak only when several trackers do, lower each contribution (three at a
 * third peak together). No contribution at all is no response.
 */
export function mixResponse(mix: VisualizerMix, thump: number, pierce: number, tick: number): number {
  return Math.min(1, thump * mix.thump + pierce * mix.pierce + tick * mix.tick)
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
 * The edge's geometry, which does not follow the music: only its opacity
 * does. It is drawn as two inset shadows (editor.css's `.editor-beat-edge`),
 * a narrow edge (an eighth of the blur) and a soft body.
 */
export interface VisualizerEdgeChannel extends VisualizerChannel {
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
  /**
   * GRID BEAT: the blocks on the editor while the visualizer mode is NOT up
   * (Options > Grid Beat), one set per light/dark mode: the same response
   * reads very differently on a light page and a dark one. The active
   * mode's set is shown and edited.
   */
  grid: VisualizerGridBeatModes
  /** The visualizer mode's edge (F5), an inner shadow round its scene; a response deepens it. Its fall also times the centre pulse's solid thump. */
  edge: VisualizerEdgeChannel
  /** The visualizer mode's pane: a copy of the scene's box outlines over its grid. A response draws it. */
  pane: VisualizerChannel
  /** The rest of the visualizer mode's own look (F5). */
  immersive: VisualizerImmersive
}

/**
 * The beat on the editor (Options > Grid Beat), independent of the
 * visualizer mode's own edge and pane. A response draws each.
 */
export interface VisualizerGridBeatModes {
  light: VisualizerGridBeat
  dark: VisualizerGridBeat
}

export interface VisualizerGridBeat {
  /** The active editor's edge, an inner shadow. */
  edge: VisualizerEdgeChannel
  /** The edit view's pane: a copy of the box outlines over the grid's own. */
  editorPane: VisualizerChannel
  /** The render (reader) view's pane: a flat wash of the pane colour over the editor, which has no grid there. */
  readerPane: VisualizerChannel
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
   * -`SWAY_PUSH_MAX_PX` to `SWAY_PUSH_MAX_PX`: how far each snare hit pushes
   * the linear glaze stacks along their gradient, in px for the nearest,
   * signed: positive forward, negative in reverse, 0 not at all
   * (`parallaxSway.ts`). The
   * radial sources do not take it.
   */
  swayPush: number
  /** 0 to 1: the share of each push the glaze slides back on the wave's fall; 0 keeps it all, 1 returns it fully. */
  swayReturn: number
  /** -`SWAY_DRIFT_MAX_PX` to it: a steady drift of the linear stacks along their gradient, px a second for the nearest; 0 none. */
  swayDrift: number
  /** The grid wave's length, in boxes, from one band's peak to the next. */
  waveBoxes: number
  /** Beats of the music (`subscribeMusicTempo`) a wave band takes to travel one wave length. */
  waveBeats: number
  /** How much each tracker shows the grid wave. */
  waveMix: VisualizerMix
  /** How much each tracker's hits push the glaze's linear stacks (`swayPush`); the push slides back on the wave's fall. */
  glazeMix: VisualizerMix
  /** How much each tracker's hits set off the centre pulse. */
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
export const WAVE_BEATS_MIN = 1
export const WAVE_BEATS_MAX = 64
/**
 * The tempo the wave travels at while the beat map has no beat (its warm-up
 * at the start of a track or after a seek, or a passage it cannot follow),
 * and the tempo a layout saved in seconds (before 2026-11-03) is read at.
 */
export const WAVE_FALLBACK_BEAT_SEC = 0.5
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
export const DEFAULT_VISUALIZER_IMMERSIVE: VisualizerImmersive = { glazeStrength: 0.1, glazeSpread: 0, swayRangePx: 40, swaySpread: 0.5, swayPush: 0, swayReturn: 1, swayDrift: 0, waveBoxes: 128, waveBeats: 4, waveTurn: 0, waveShape: 0, waveFallSec: 0.25, pulseSpeed: 20, pulseHalfLifeSec: 5, pulseFadeSec: 5, pulseSoftness: 1, pulseBoost: 1, cutoutRound: 0, waveMix: { thump: 0, pierce: 1, tick: 0 }, glazeMix: { thump: 0, pierce: 1, tick: 0 }, pulseMix: { thump: 1, pierce: 0, tick: 0 } }

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
  return { thump: 0, pierce: 0, tick: 0, [tracker]: 1 }
}

/** The trackers' defaults: half of each channel's instances show. */
export const DEFAULT_VISUALIZER_TRACKERS: VisualizerTrackers = {
  thump: { contrast: 0.5, pattern: 0.5 },
  pierce: { contrast: 0.5, pattern: 0.5 },
  tick: { contrast: 0.5, pattern: 0.5 },
}

/**
 * The defaults are the visualizer of a layout the author saved (2026-10-25),
 * its fall lengths rounded to the whole milliseconds the slider shows; a
 * field that layout did not set keeps the value it had before.
 */
export const DEFAULT_VISUALIZER_CHANNEL: VisualizerChannel = {
  effect: 0.6,
  mix: soleMix('thump'),
  shape: 0,
  fallSec: 0.25,
}

export const DEFAULT_VISUALIZER_EDGE: VisualizerEdgeChannel = {
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
  mix: soleMix('pierce'),
  fallSec: 0.25,
}

/**
 * The visualizer every layout shares until it is tuned: the author's saved
 * layout of 2026-11-03 (the factory presets' tuning when the visualizer was
 * still part of a layout), its fall lengths rounded to what the sliders show.
 */
const DEFAULT_SAVED_EDGE: VisualizerEdgeChannel = { ...DEFAULT_VISUALIZER_EDGE, fallSec: 0.5, spreadPx: 10, blurPx: 200 }
const DEFAULT_SAVED_PANE: VisualizerChannel = { ...DEFAULT_VISUALIZER_PANE, effect: 0.7, shape: -0.2, fallSec: 0.3 }

export const DEFAULT_VISUALIZER: VisualizerSettings = {
  trackers: DEFAULT_VISUALIZER_TRACKERS,
  grid: {
    dark: {
      edge: { ...DEFAULT_SAVED_EDGE, effect: 0.12, spreadPx: 0, blurPx: 30 },
      editorPane: { ...DEFAULT_SAVED_PANE, effect: 0.05 },
      readerPane: { ...DEFAULT_SAVED_PANE, effect: 0.05 },
    },
    light: {
      edge: { ...DEFAULT_SAVED_EDGE, effect: 0.2, spreadPx: 0, blurPx: 30 },
      editorPane: { ...DEFAULT_SAVED_PANE, effect: 0.3 },
      readerPane: { ...DEFAULT_SAVED_PANE, effect: 0.3 },
    },
  },
  edge: DEFAULT_SAVED_EDGE,
  pane: DEFAULT_SAVED_PANE,
  immersive: {
    ...DEFAULT_VISUALIZER_IMMERSIVE,
    glazeStrength: 0.06, glazeSpread: -1, swayRangePx: 0, swayPush: -3, swayReturn: 1, swayDrift: 10,
    waveBoxes: 72, waveBeats: 4, waveTurn: 4, waveShape: -0.5, waveFallSec: 1.5,
    waveMix: { thump: 0, pierce: 1, tick: 0 },
    glazeMix: { thump: 0, pierce: 1, tick: 0 },
    pulseSpeed: 35, pulseHalfLifeSec: 0.75, pulseFadeSec: 1.5, pulseSoftness: 0.5, pulseBoost: 0.5,
    cutoutRound: 1,
  },
}

/**
 * The visualizer's colours, part of the layout (Options > Colors), each
 * picked like any layout colour, BEFORE the theme's invert.
 */
export interface VisualizerColors {
  /** The active editor's edge (an inner shadow). */
  edge: string
  /** The pane: the box outlines in the edit view, a flat wash anywhere else. */
  pane: string
  /** The grid wave in the visualizer mode (apps/notes's GridWave.tsx). */
  wave: string
  /** The centre pulse in the visualizer mode (GridWave.tsx). */
  pulse: string
  /**
   * The visualizer mode's ACCENT: the spectrum's bars and the progress
   * track's lit boxes. Empty follows the theme's caret colour, which is
   * what both drew in before they had a colour of their own.
   */
  accent: string
  /**
   * The LETTERBOX: the strips around the visualizer mode's scene. Empty
   * follows the theme's leading and trailing zone colours, the editor's top
   * and bottom sections.
   */
  letterbox: string
}

const LIGHT_VISUALIZER_COLORS: VisualizerColors = {
  edge: 'rgba(0, 0, 0, 0.5)', pane: 'rgba(255, 255, 255, 1)',
  wave: 'rgba(255, 255, 255, 0.314)', pulse: 'rgba(255, 255, 255, 0.392)', accent: 'rgba(0, 0, 0, 0.235)', letterbox: 'rgba(255, 255, 255, 1)',
}

const DARK_VISUALIZER_COLORS: VisualizerColors = {
  edge: 'rgba(0, 0, 0, 1)', pane: 'rgba(0, 0, 0, 0.5)',
  wave: 'rgba(255, 255, 255, 1)', pulse: 'rgba(0, 0, 0, 0.137)', accent: '', letterbox: '',
}

/**
 * A layout's default colours, which depend on whether it is inverted: a
 * colour is picked BEFORE the theme's invert, so an edge that darkens and a
 * pane that brightens on screen are stored the other way round in an
 * inverted layout.
 */
export function defaultVisualizerColors(inverted: boolean): VisualizerColors {
  return inverted ? DARK_VISUALIZER_COLORS : LIGHT_VISUALIZER_COLORS
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

/**
 * LEGACY: before the drum score's channels (2026-11-02) the trackers were the
 * KICKS, the HITS and a BAND's level; each is read as the channel that took
 * its place (the band, a level with no hits, as the tick: its every layout
 * followed the top of the spectrum).
 */
const LEGACY_TRACKER: Record<VisualizerTrackerName, string> = { thump: 'kicks', pierce: 'hits', tick: 'band' }

/** A mix, every contribution bounded; one saved under the legacy names reads as their channels. */
function sanitizeMix(input: unknown, d: VisualizerMix): VisualizerMix {
  const source = fieldsOf(input)
  const legacy = VISUALIZER_TRACKERS.every((name) => source[name] === undefined)
  const of = (name: VisualizerTrackerName) => bounded(legacy ? source[LEGACY_TRACKER[name]] : source[name], 0, 1, d[name])
  return { thump: of('thump'), pierce: of('pierce'), tick: of('tick') }
}

/**
 * LEGACY: before the trackers were separated from the blocks (2026-11-01),
 * every block followed ONE source of its own (`source`: a band, the kick,
 * the snare or the hat; a layout older still said the kick with a frequency
 * of 0 and a band with its frequency) with its own band and
 * contrast. Such a block reads as the mix following that source's channel
 * in full: the kick the thump, the snare the pierce, the hat and a band the
 * tick (`LEGACY_TRACKER`).
 */
function legacyTracker(source: Fields): VisualizerTrackerName | null {
  switch (source.source) {
    case 'kick': return 'thump'
    case 'snare': return 'pierce'
    case 'hat': case 'band': return 'tick'
  }
  if (source.frequencyHz === 0) return 'thump'
  if (typeof source.frequencyHz === 'number' && Number.isFinite(source.frequencyHz)) return 'tick'
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

function sanitizeTracker(input: unknown, d: VisualizerTracker): VisualizerTracker {
  const source = fieldsOf(input)
  return { contrast: bounded(source.contrast, 0, BEAT_CONTRAST_MAX, d.contrast), pattern: bounded(source.pattern, 0, 1, d.pattern) }
}

/**
 * LEGACY: the trackers of a layout saved before they existed, from its
 * blocks' own settings: each tracker takes the settings of the first block
 * (the edge, then the pane) that followed its source, so the block a reader
 * tuned for a drum keeps that tuning. A tracker no block followed keeps its
 * defaults, and so does the tick: a band's contrast was a share of LEVELS,
 * which says nothing about a share of hits.
 */
function legacyTrackers(blocks: unknown[], d: VisualizerTrackers): VisualizerTrackers {
  const of = (tracker: VisualizerTrackerName) => blocks.map(fieldsOf).find((block) => block.source !== 'hat' && legacyTracker(block) === tracker)
  return { thump: sanitizeTracker(of('thump'), d.thump), pierce: sanitizeTracker(of('pierce'), d.pierce), tick: d.tick }
}

/** The trackers, each bounded; a layout saved with the legacy kicks, hits and band reads them as the thump, the pierce and the tick (`LEGACY_TRACKER`). */
function sanitizeTrackers(input: unknown, d: VisualizerTrackers): VisualizerTrackers {
  const source = fieldsOf(input)
  const legacy = VISUALIZER_TRACKERS.every((name) => source[name] === undefined)
  return {
    thump: sanitizeTracker(legacy ? source.kicks : source.thump, d.thump),
    pierce: sanitizeTracker(legacy ? source.hits : source.pierce, d.pierce),
    // The legacy band's contrast was a share of levels: not carried over.
    tick: legacy ? d.tick : sanitizeTracker(source.tick, d.tick),
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

function sanitizeEdgeChannel(input: unknown, d: VisualizerEdgeChannel): VisualizerEdgeChannel {
  const source = fieldsOf(input)
  return {
    ...sanitizeChannel(input, d),
    spreadPx: Math.round(bounded(source.spreadPx, 0, EDGE_SPREAD_MAX_PX, d.spreadPx)),
    blurPx: Math.round(bounded(source.blurPx, 0, EDGE_BLUR_MAX_PX, d.blurPx)),
  }
}

function sanitizeImmersive(input: unknown, d: VisualizerImmersive, legacyPulseMix: VisualizerMix | null, legacyWaveMix: VisualizerMix | null): VisualizerImmersive {
  const source = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof VisualizerImmersive | 'waveSec', unknown>>
  return {
    glazeStrength: bounded(source.glazeStrength, 0, IMMERSIVE_GLAZE_STRENGTH_MAX, d.glazeStrength),
    glazeSpread: bounded(source.glazeSpread, -1, 1, d.glazeSpread),
    swayRangePx: Math.round(bounded(source.swayRangePx, 0, IMMERSIVE_SWAY_RANGE_MAX_PX, d.swayRangePx)),
    swaySpread: bounded(source.swaySpread, 0, 1, d.swaySpread),
    swayPush: bounded(source.swayPush, -SWAY_PUSH_MAX_PX, SWAY_PUSH_MAX_PX, d.swayPush),
    swayReturn: bounded(source.swayReturn, 0, 1, d.swayReturn),
    swayDrift: bounded(source.swayDrift, -SWAY_DRIFT_MAX_PX, SWAY_DRIFT_MAX_PX, d.swayDrift),
    waveBoxes: Math.round(bounded(source.waveBoxes, WAVE_BOXES_MIN, WAVE_BOXES_MAX, d.waveBoxes)),
    // A layout saved before the travel counted beats (2026-11-03) saved seconds, read at the fallback tempo.
    waveBeats: Math.round(bounded(source.waveBeats ?? (typeof source.waveSec === 'number' ? source.waveSec / WAVE_FALLBACK_BEAT_SEC : undefined), WAVE_BEATS_MIN, WAVE_BEATS_MAX, d.waveBeats)),
    waveMix: sanitizeMix(source.waveMix, legacyWaveMix ?? d.waveMix),
    // A layout saved before the glaze had its own mix (2026-11-01) was pushed by the wave's;
    // only a layout that SAVED a wave mix is one of those, so one that saved neither takes the default.
    glazeMix: sanitizeMix(source.glazeMix, source.glazeMix === undefined && (source.waveMix !== undefined || legacyWaveMix)
      ? sanitizeMix(source.waveMix, legacyWaveMix ?? d.waveMix) : d.glazeMix),
    pulseMix: sanitizeMix(source.pulseMix, legacyPulseMix ?? d.pulseMix),
    waveTurn: Math.round(bounded(source.waveTurn, -WAVE_TURN_MAX, WAVE_TURN_MAX, d.waveTurn)),
    waveShape: bounded(source.waveShape, -1, 1, d.waveShape),
    waveFallSec: bounded(source.waveFallSec, FALL_MIN_SEC, FALL_MAX_SEC, d.waveFallSec),
    pulseSpeed: bounded(source.pulseSpeed, PULSE_SPEED_MIN, PULSE_SPEED_MAX, d.pulseSpeed),
    pulseHalfLifeSec: bounded(source.pulseHalfLifeSec, PULSE_SEC_MIN, PULSE_SEC_MAX, d.pulseHalfLifeSec),
    pulseFadeSec: bounded(source.pulseFadeSec, PULSE_SEC_MIN, PULSE_SEC_MAX, d.pulseFadeSec),
    pulseSoftness: bounded(source.pulseSoftness, 0, 1, d.pulseSoftness),
    pulseBoost: bounded(source.pulseBoost, 0, 1, d.pulseBoost),
    cutoutRound: bounded(source.cutoutRound, 0, 1, d.cutoutRound),
  }
}

/** What the edge and the pane were saved as before they had those names: `shade` and `outline`. */
type LegacyBlockName = 'shade' | 'outline'

/**
 * Every field bounded; a missing one takes the default. Also reads a
 * visualizer saved inside a layout before it became global (with its
 * colours, which are dropped here and read by `sanitizeVisualizerColors`),
 * which is how the active layout's tuning became the global one.
 */
export function sanitizeVisualizer(input: unknown): VisualizerSettings {
  const d = DEFAULT_VISUALIZER
  if (!input || typeof input !== 'object') return d
  const source = input as Partial<Record<keyof VisualizerSettings | LegacyBlockName, unknown>>
  const edgeInput = source.edge ?? source.shade
  const paneInput = source.pane ?? source.outline
  const edge = sanitizeEdgeChannel(edgeInput, d.edge)
  const pane = sanitizeChannel(paneInput, d.pane)
  // LEGACY: a layout saved before the trackers had none, and its centre
  // pulse rode the edge's hits; it keeps the edge's drum (a band, which no
  // pulse took then, reads as the thump, the pulse's default).
  const isLegacy = source.trackers === undefined
  // An edge with no effect subscribed nothing, so it set off no pulse.
  const legacyPulseMix = !isLegacy ? null
    : edge.effect === 0 ? { thump: 0, pierce: 0, tick: 0 }
    : soleMix(edge.mix.pierce > 0 ? 'pierce' : 'thump')
  return {
    trackers: isLegacy ? legacyTrackers([edgeInput, paneInput], DEFAULT_VISUALIZER_TRACKERS) : sanitizeTrackers(source.trackers, d.trackers),
    // A save from before the grid beat was separated from the visualizer
    // mode's (2026-11-07) had one edge and one pane for both: each copy
    // starts from them.
    grid: sanitizeGridBeatModes(source.grid, { edge, editorPane: pane, readerPane: pane }, d.grid),
    edge,
    pane,
    // ...and its wave followed the snare, whatever the default wave mix is now.
    immersive: sanitizeImmersive(source.immersive, d.immersive, legacyPulseMix, isLegacy ? soleMix('pierce') : null),
  }
}

/**
 * A save from before the grid beat was split by light/dark mode
 * (2026-11-07) holds one set, which both modes take; one from before the
 * grid beat existed at all has none, and both modes take the visualizer
 * mode's edge and pane (`legacy`). Otherwise each mode is read on its own.
 */
function sanitizeGridBeatModes(input: unknown, legacy: VisualizerGridBeat, d: VisualizerGridBeatModes): VisualizerGridBeatModes {
  const source = fieldsOf(input)
  if (input !== undefined && source.light === undefined && source.dark === undefined) {
    const single = sanitizeGridBeat(input, legacy)
    return { light: single, dark: single }
  }
  if (input === undefined) return { light: legacy, dark: legacy }
  return { light: sanitizeGridBeat(source.light, d.light), dark: sanitizeGridBeat(source.dark, d.dark) }
}

function sanitizeGridBeat(input: unknown, d: VisualizerGridBeat): VisualizerGridBeat {
  const source = fieldsOf(input)
  return {
    edge: sanitizeEdgeChannel(source.edge, d.edge),
    editorPane: sanitizeChannel(source.editorPane, d.editorPane),
    readerPane: sanitizeChannel(source.readerPane, d.readerPane),
  }
}

function colorOr(value: unknown, fallback: string, allowEmpty: boolean): string {
  return typeof value === 'string' && (allowEmpty || value.length > 0) ? value : fallback
}

/**
 * A layout's visualizer colours, each a string (the accent and the letterbox
 * may be empty: they then follow the theme); a missing one takes the default
 * for a layout of that inversion. `legacyVisualizer` is the visualizer a
 * layout saved before the colours were separated from it (2026-11-07), whose
 * colours sat on its blocks.
 */
export function sanitizeVisualizerColors(input: unknown, inverted: boolean, legacyVisualizer?: unknown): VisualizerColors {
  const d = defaultVisualizerColors(inverted)
  const source = fieldsOf(input)
  const legacy = fieldsOf(legacyVisualizer)
  const immersive = fieldsOf(legacy.immersive)
  return {
    edge: colorOr(source.edge ?? fieldsOf(legacy.edge ?? legacy.shade).color, d.edge, false),
    pane: colorOr(source.pane ?? fieldsOf(legacy.pane ?? legacy.outline).color, d.pane, false),
    wave: colorOr(source.wave ?? immersive.waveColor, d.wave, false),
    pulse: colorOr(source.pulse ?? immersive.pulseColor, d.pulse, false),
    accent: colorOr(source.accent ?? immersive.accentColor, d.accent, true),
    letterbox: colorOr(source.letterbox ?? immersive.letterboxColor, d.letterbox, true),
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

/**
 * The centre pulse's gauge when it travels as a real wavefront rather than a
 * scaled copy of the face: `1 + d`, where `d` is the signed distance from
 * (x, y) to the face (half-side 1, corner radius `round`), in half-sides.
 * Its level sets are the face's OFFSET curves, the shape a wave launched from
 * every point of the face's edge actually has: the straight sides move out
 * unchanged and each corner becomes an arc whose radius grows by the
 * distance travelled, so a square face sends out a rounded square that tends
 * to a circle. For a circle (`round` 1) it equals `roundedSquareGauge`.
 * The same function `PulseRingsCanvas.tsx`'s shader evaluates.
 */
export function roundedSquareOffsetGauge(x: number, y: number, round: number): number {
  const r = Math.max(0, Math.min(1, round))
  const qx = Math.abs(x) - (1 - r)
  const qy = Math.abs(y) - (1 - r)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return 1 + outside + Math.min(Math.max(qx, qy), 0) - r
}
