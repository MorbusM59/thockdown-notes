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

/** A drum a block can follow instead of a band: its hits, found by the notes app's `sound/drumTracker.ts`. */
export type VisualizerDrum = 'kick' | 'snare' | 'hat'

/** What a block listens to: the level of one band of the music, or the hits of one drum. */
export type VisualizerSource = 'band' | VisualizerDrum

/** How one block follows the music. */
export interface VisualizerChannel {
  /**
   * The share of the block's effect a full response reaches, -1..1. Positive:
   * a hit adds it. Negative: inverted, the block rests at |effect| while music
   * plays and a hit takes it away. Zero: off.
   */
  effect: number
  /** What it follows: a band (`frequencyHz`, `octaves`) or a drum (`groove`). */
  source: VisualizerSource
  /** The centre of the band, in Hz; kept while a drum is followed, so going back to the band finds it where it was. */
  frequencyHz: number
  /** The band's width, in octaves, between its half-power points. */
  octaves: number
  /**
   * For a drum, 0..1: how steadily it holds the pattern the drum has been
   * playing against what it hears (the notes app's `sound/drumTracker.ts`,
   * GROOVE). 0 shows only the hits it hears, the pattern a filter; 1 lands
   * every hit of the pattern at full strength, masked or not, ignores a
   * one-off off it, and stops through a break. Kept while a band is
   * followed, as `octaves` is kept while a drum is.
   */
  groove: number
  /**
   * Where the response starts, as a share of the surrounding ten seconds of
   * the band: higher keeps only the biggest hits.
   */
  contrast: number
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
 * tempo (the notes app's `sound/beatClock.ts`) rather than a band or a drum,
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
  /** The grid wave's colour (apps/notes's GridWave.tsx), picked like any layout colour, before the theme's invert. */
  waveColor: string
  /** The grid wave's length, in boxes, from one band's peak to the next. */
  waveBoxes: number
  /** Seconds a wave band takes to travel one wave length. */
  waveSec: number
  /**
   * The grid wave's rotation, in turns per second, -1..1: 0 holds it still,
   * negative turns it counter-clockwise, positive clockwise.
   */
  waveTurnsPerSec: number
}

export const IMMERSIVE_GLAZE_STRENGTH_MAX = 0.2
export const IMMERSIVE_SWAY_RANGE_MAX_PX = 200
export const WAVE_BOXES_MIN = 2
export const WAVE_BOXES_MAX = 256
export const WAVE_SEC_MIN = 0.5
export const WAVE_SEC_MAX = 30
export const WAVE_TURNS_PER_SEC_MAX = 1
export const DEFAULT_VISUALIZER_IMMERSIVE: VisualizerImmersive = { glazeStrength: 0.1, glazeSpread: 0, swayRangePx: 40, swaySpread: 0.5, waveColor: 'rgba(0, 0, 0, 0.086)', waveBoxes: 128, waveSec: 6, waveTurnsPerSec: 0 }

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

/**
 * A drum's groove where a layout has none: 0, the drum as it was followed
 * before groove was a setting, so a layout saved then looks exactly as it did.
 */
const DEFAULT_GROOVE = 0

/**
 * The defaults are the visualizer of a layout the author saved (2026-10-25),
 * its fall lengths rounded to the whole milliseconds the slider shows; a
 * field that layout did not set keeps the value it had before.
 */
export const DEFAULT_VISUALIZER_CHANNEL: VisualizerChannel = {
  effect: 0.6,
  source: 'kick',
  frequencyHz: 70,
  octaves: 1,
  groove: DEFAULT_GROOVE,
  contrast: 0.5,
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
  source: 'snare',
  frequencyHz: 640,
  fallSec: 0.25,
}

/**
 * The defaults for a layout, which depend on whether it is inverted: a
 * colour is picked BEFORE the theme's invert, so an edge that darkens and
 * a pane that brightens on screen are stored the other way round in an
 * inverted layout.
 */
export function defaultVisualizer(inverted: boolean): VisualizerSettings {
  return {
    caret: DEFAULT_VISUALIZER_CARET,
    // An inverted (dark) layout's colours are the author's own picks, value 0 at
    // alphas 200 and 25 of the picker's 255, not the light ones inverted.
    edge: { ...DEFAULT_VISUALIZER_EDGE, color: inverted ? 'rgba(0, 0, 0, 0.784)' : 'rgba(0, 0, 0, 1)' },
    pane: { ...DEFAULT_VISUALIZER_PANE, color: inverted ? 'rgba(0, 0, 0, 0.098)' : 'rgba(255, 255, 255, 0.499)' },
    immersive: DEFAULT_VISUALIZER_IMMERSIVE,
  }
}

const SOURCES: readonly VisualizerSource[] = ['band', 'kick', 'snare', 'hat']

/** A layout saved before `source` existed said "the kick" with a frequency of 0, and a band with its frequency. */
function legacySource(frequencyHz: unknown, fallback: VisualizerSource): VisualizerSource {
  if (frequencyHz === 0) return 'kick'
  return typeof frequencyHz === 'number' && Number.isFinite(frequencyHz) ? 'band' : fallback
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}

/** The signed effect; a layout saved with `amount` and `invert` turns into one. */
function sanitizeEffect(source: Partial<Record<string, unknown>>, fallback: number): number {
  if (source.effect !== undefined) return bounded(source.effect, -1, 1, fallback)
  if (source.amount === undefined) return fallback
  const amount = bounded(source.amount, 0, 1, Math.abs(fallback))
  return source.invert === true ? -amount : amount
}

function sanitizeChannel(input: unknown, d: VisualizerChannel): VisualizerChannel {
  const source = (input && typeof input === 'object' ? input : {}) as Partial<Record<string, unknown>>
  return {
    effect: sanitizeEffect(source, d.effect),
    source: SOURCES.includes(source.source as VisualizerSource) ? source.source as VisualizerSource : legacySource(source.frequencyHz, d.source),
    frequencyHz: bounded(source.frequencyHz, BEAT_FREQUENCY_MIN_HZ, BEAT_FREQUENCY_MAX_HZ, d.frequencyHz),
    octaves: bounded(source.octaves, BEAT_OCTAVES_MIN, BEAT_OCTAVES_MAX, d.octaves),
    groove: bounded(source.groove, 0, 1, d.groove),
    contrast: bounded(source.contrast, 0, BEAT_CONTRAST_MAX, d.contrast),
    ...sanitizeFall(source, d),
  }
}

/**
 * The fall's shape and length. A layout saved with one `mass` slider reads
 * as the fall it made; one saved with the first `fallShape` (an exponent of
 * 2^fallShape, -5..5) keeps its sign, at half its value.
 */
function sanitizeFall(source: Partial<Record<string, unknown>>, d: Pick<VisualizerChannel, 'shape' | 'fallSec'>): Pick<VisualizerChannel, 'shape' | 'fallSec'> {
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

function sanitizeImmersive(input: unknown, d: VisualizerImmersive): VisualizerImmersive {
  const source = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof VisualizerImmersive, unknown>>
  return {
    glazeStrength: bounded(source.glazeStrength, 0, IMMERSIVE_GLAZE_STRENGTH_MAX, d.glazeStrength),
    glazeSpread: bounded(source.glazeSpread, -1, 1, d.glazeSpread),
    swayRangePx: Math.round(bounded(source.swayRangePx, 0, IMMERSIVE_SWAY_RANGE_MAX_PX, d.swayRangePx)),
    swaySpread: bounded(source.swaySpread, 0, 1, d.swaySpread),
    waveColor: typeof source.waveColor === 'string' && source.waveColor.length > 0 ? source.waveColor : d.waveColor,
    waveBoxes: Math.round(bounded(source.waveBoxes, WAVE_BOXES_MIN, WAVE_BOXES_MAX, d.waveBoxes)),
    waveSec: bounded(source.waveSec, WAVE_SEC_MIN, WAVE_SEC_MAX, d.waveSec),
    waveTurnsPerSec: bounded(source.waveTurnsPerSec, -WAVE_TURNS_PER_SEC_MAX, WAVE_TURNS_PER_SEC_MAX, d.waveTurnsPerSec),
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
  return {
    caret: sanitizeCaret(source.caret, d.caret, legacyCaretPreset),
    edge: sanitizeEdgeChannel(source.edge ?? source.shade, d.edge),
    pane: sanitizeColorChannel(source.pane ?? source.outline, d.pane),
    immersive: sanitizeImmersive(source.immersive, d.immersive),
  }
}

/**
 * The frequency slider (Options > Visualizer) is one track for every
 * source: the KICK at its left end, the SNARE at its centre and the HAT at
 * its right, with the spectrum in octaves between them (20Hz up to the
 * spectrum's geometric middle, about 630Hz, left of the snare; the rest of
 * it right). Each drum holds a stretch of `SLIDER_STOP_OCTAVES`, and the
 * snare's sits exactly at the track's centre because the stops at the two
 * ends are the same width.
 */
export const SLIDER_STOP_OCTAVES = 0.5
const LOW = Math.log2(BEAT_FREQUENCY_MIN_HZ)
const HIGH = Math.log2(BEAT_FREQUENCY_MAX_HZ)
const MIDDLE = (LOW + HIGH) / 2
export const SOURCE_SLIDER_MIN = LOW - SLIDER_STOP_OCTAVES
export const SOURCE_SLIDER_MAX = HIGH + 2 * SLIDER_STOP_OCTAVES

/** Where a channel's source sits on the slider: a drum at the middle of its stop, a band at its frequency. */
export function sourceSliderValue(channel: Pick<VisualizerChannel, 'source' | 'frequencyHz'>): number {
  switch (channel.source) {
    case 'kick': return LOW - SLIDER_STOP_OCTAVES / 2
    case 'snare': return MIDDLE + SLIDER_STOP_OCTAVES / 2
    case 'hat': return HIGH + 1.5 * SLIDER_STOP_OCTAVES
    case 'band': {
      const octave = Math.log2(channel.frequencyHz)
      return octave <= MIDDLE ? octave : octave + SLIDER_STOP_OCTAVES
    }
  }
}

/**
 * The source a slider position selects. A drum keeps the band's frequency
 * the channel had, so the band comes back where it was; a band position
 * gives its frequency, in whole Hz.
 */
export function sourceAtSlider(value: number, frequencyHz: number): Pick<VisualizerChannel, 'source' | 'frequencyHz'> {
  const band = (octave: number) => ({
    source: 'band' as const,
    frequencyHz: Math.max(BEAT_FREQUENCY_MIN_HZ, Math.min(BEAT_FREQUENCY_MAX_HZ, Math.round(2 ** octave))),
  })
  if (value < LOW) return { source: 'kick', frequencyHz }
  if (value <= MIDDLE) return band(value)
  if (value < MIDDLE + SLIDER_STOP_OCTAVES) return { source: 'snare', frequencyHz }
  if (value <= HIGH + SLIDER_STOP_OCTAVES) return band(value - SLIDER_STOP_OCTAVES)
  return { source: 'hat', frequencyHz }
}
