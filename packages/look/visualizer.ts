/**
 * The visualizer: elements of the look that follow the playing music, saved
 * with the layout like every other part of it (Options > Visualizer). Three
 * independent BLOCKS, each listening to its own band (or a drum: kick, snare or hat) with
 * its own timing: the caret, which dips; the active editor's SHADE; and the
 * box OUTLINES. The shade and the outline each have a colour, picked like any
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
  /** What it follows: a band (`frequencyHz`, `octaves`) or a drum. */
  source: VisualizerSource
  /** The centre of the band, in Hz; kept while a drum is followed, so going back to the band finds it where it was. */
  frequencyHz: number
  /** The band's width, in octaves, between its half-power points. */
  octaves: number
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
 */
export type VisualizerCaret = Pick<VisualizerChannel, 'effect' | 'shape' | 'fallSec'>

/** A block drawn in a colour of its own. */
export interface VisualizerColorChannel extends VisualizerChannel {
  color: string
}

/**
 * The shade's geometry, which does not follow the music: only its opacity
 * does. It is drawn as two inset shadows (editor.css's `.editor-beat-shade`),
 * a narrow edge (an eighth of the blur) and a soft body.
 */
export interface VisualizerShadeChannel extends VisualizerColorChannel {
  /** How far, in px, the shade's solid part reaches in from the editor's edges (both shadows' spread radius). */
  spreadPx: number
  /** How soft its edge is, in px: the soft body's blur radius; the narrow edge's is an eighth of it. */
  blurPx: number
}

export const SHADE_SPREAD_MAX_PX = 200
export const SHADE_BLUR_MAX_PX = 200
/** Spread 0 and blur 32 are the shade as it was drawn before either was a setting (4px and 32px blur, no spread). */
export const DEFAULT_SHADE_SPREAD_PX = 0
export const DEFAULT_SHADE_BLUR_PX = 32

export interface VisualizerSettings {
  /** The caret, held at its peak while it follows the music and dipped on a steady beat that follows its tempo. */
  caret: VisualizerCaret
  /** The active editor's inner shade; a response deepens it. */
  shade: VisualizerShadeChannel
  /** The box outlines; a response draws them over the grid's own. */
  outline: VisualizerColorChannel
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

export const DEFAULT_VISUALIZER_CHANNEL: VisualizerChannel = {
  effect: 0.6,
  source: 'kick',
  frequencyHz: 70,
  octaves: 1,
  contrast: 0.5,
  shape: 0,
  fallSec: 0.25,
}

export const DEFAULT_VISUALIZER_CARET: VisualizerCaret = {
  effect: DEFAULT_VISUALIZER_CHANNEL.effect,
  shape: DEFAULT_VISUALIZER_CHANNEL.shape,
  fallSec: DEFAULT_VISUALIZER_CHANNEL.fallSec,
}

/**
 * The defaults for a layout, which depend on whether it is inverted: a
 * colour is picked BEFORE the theme's invert, so a shade that darkens and
 * outlines that brighten on screen are stored the other way round in an
 * inverted layout.
 */
export function defaultVisualizer(inverted: boolean): VisualizerSettings {
  const dark = 'rgba(0, 0, 0, 0.9)'
  const light = 'rgba(255, 255, 255, 0.35)'
  return {
    caret: DEFAULT_VISUALIZER_CARET,
    shade: {
      ...DEFAULT_VISUALIZER_CHANNEL,
      color: inverted ? 'rgba(255, 255, 255, 0.9)' : dark,
      spreadPx: DEFAULT_SHADE_SPREAD_PX,
      blurPx: DEFAULT_SHADE_BLUR_PX,
    },
    outline: { ...DEFAULT_VISUALIZER_CHANNEL, color: inverted ? 'rgba(0, 0, 0, 0.35)' : light },
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

/** The caret's fields; anything else an older layout saved with it (a source, a band) is dropped. */
function sanitizeCaret(input: unknown, d: VisualizerCaret): VisualizerCaret {
  const source = (input && typeof input === 'object' ? input : {}) as Partial<Record<string, unknown>>
  return { effect: sanitizeEffect(source, d.effect), ...sanitizeFall(source, d) }
}

function sanitizeColorChannel(input: unknown, d: VisualizerColorChannel): VisualizerColorChannel {
  const color = input && typeof input === 'object' ? (input as { color?: unknown }).color : undefined
  return { ...sanitizeChannel(input, d), color: typeof color === 'string' && color.length > 0 ? color : d.color }
}

function sanitizeShadeChannel(input: unknown, d: VisualizerShadeChannel): VisualizerShadeChannel {
  const source = (input && typeof input === 'object' ? input : {}) as Partial<Record<string, unknown>>
  return {
    ...sanitizeColorChannel(input, d),
    spreadPx: Math.round(bounded(source.spreadPx, 0, SHADE_SPREAD_MAX_PX, d.spreadPx)),
    blurPx: Math.round(bounded(source.blurPx, 0, SHADE_BLUR_MAX_PX, d.blurPx)),
  }
}

/** Every field bounded; a missing one takes the default for a layout of that inversion. */
export function sanitizeVisualizer(input: unknown, inverted: boolean): VisualizerSettings {
  const d = defaultVisualizer(inverted)
  const source = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof VisualizerSettings, unknown>>
  return {
    caret: sanitizeCaret(source.caret, d.caret),
    shade: sanitizeShadeChannel(source.shade, d.shade),
    outline: sanitizeColorChannel(source.outline, d.outline),
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
