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
  /** Seconds a peak takes to fall to nothing; a hit lifts the response at once. */
  fallSec: number
  /** The fall's shape: 0 falls evenly, higher drops early, lower holds and drops late. */
  fallShape: number
}

/** A block drawn in a colour of its own. */
export interface VisualizerColorChannel extends VisualizerChannel {
  color: string
}

export interface VisualizerSettings {
  /** The caret, held at its peak while it follows the music; a response dips it. */
  caret: VisualizerChannel
  /** The active editor's inner shade; a response deepens it. */
  shade: VisualizerColorChannel
  /** The box outlines; a response draws them over the grid's own. */
  outline: VisualizerColorChannel
}

export const BEAT_FREQUENCY_MIN_HZ = 20
export const BEAT_FREQUENCY_MAX_HZ = 20000
export const BEAT_OCTAVES_MIN = 0.1
export const BEAT_OCTAVES_MAX = 4
export const BEAT_CONTRAST_MAX = 0.95
export const BEAT_FALL_MIN_SEC = 0.02
export const BEAT_FALL_MAX_SEC = 2
export const BEAT_FALL_SHAPE_MIN = -5
export const BEAT_FALL_SHAPE_MAX = 5

export const DEFAULT_VISUALIZER_CHANNEL: VisualizerChannel = {
  effect: 0.6,
  source: 'kick',
  frequencyHz: 70,
  octaves: 1,
  contrast: 0.5,
  fallSec: 0.25,
  fallShape: 0,
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
    caret: DEFAULT_VISUALIZER_CHANNEL,
    shade: { ...DEFAULT_VISUALIZER_CHANNEL, color: inverted ? 'rgba(255, 255, 255, 0.9)' : dark },
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
    fallSec: bounded(source.fallSec, BEAT_FALL_MIN_SEC, BEAT_FALL_MAX_SEC, d.fallSec),
    fallShape: bounded(source.fallShape, BEAT_FALL_SHAPE_MIN, BEAT_FALL_SHAPE_MAX, d.fallShape),
  }
}

function sanitizeColorChannel(input: unknown, d: VisualizerColorChannel): VisualizerColorChannel {
  const color = input && typeof input === 'object' ? (input as { color?: unknown }).color : undefined
  return { ...sanitizeChannel(input, d), color: typeof color === 'string' && color.length > 0 ? color : d.color }
}

/** Every field bounded; a missing one takes the default for a layout of that inversion. */
export function sanitizeVisualizer(input: unknown, inverted: boolean): VisualizerSettings {
  const d = defaultVisualizer(inverted)
  const source = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof VisualizerSettings, unknown>>
  return {
    caret: sanitizeChannel(source.caret, d.caret),
    shade: sanitizeColorChannel(source.shade, d.shade),
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
