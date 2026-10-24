/**
 * The visualizer: elements of the look that follow the playing music, saved
 * with the layout like every other part of it (Options > Visualizer). Three
 * independent BLOCKS, each listening to its own band (or the kick drum) with
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

/** How one block follows the music. */
export interface VisualizerChannel {
  /** The share of the block's effect a full response reaches, 0..1. */
  amount: number
  /**
   * The centre of the band, in Hz; `BEAT_FREQUENCY` (0) follows kick-drum
   * hits instead of one band.
   */
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
  /**
   * Turns the response over: the block rests at its full amount and a hit
   * takes it away.
   */
  invert: boolean
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

/** The frequency that means "follow the kick drum" rather than a band. */
export const BEAT_FREQUENCY = 0
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
  amount: 0.6,
  frequencyHz: 70,
  octaves: 1,
  contrast: 0.5,
  fallSec: 0.25,
  fallShape: 0,
  invert: false,
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

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}

function sanitizeChannel(input: unknown, d: VisualizerChannel): VisualizerChannel {
  const source = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof VisualizerChannel, unknown>>
  return {
    amount: bounded(source.amount, 0, 1, d.amount),
    frequencyHz: source.frequencyHz === BEAT_FREQUENCY
      ? BEAT_FREQUENCY
      : bounded(source.frequencyHz, BEAT_FREQUENCY_MIN_HZ, BEAT_FREQUENCY_MAX_HZ, d.frequencyHz),
    octaves: bounded(source.octaves, BEAT_OCTAVES_MIN, BEAT_OCTAVES_MAX, d.octaves),
    contrast: bounded(source.contrast, 0, BEAT_CONTRAST_MAX, d.contrast),
    fallSec: bounded(source.fallSec, BEAT_FALL_MIN_SEC, BEAT_FALL_MAX_SEC, d.fallSec),
    fallShape: bounded(source.fallShape, BEAT_FALL_SHAPE_MIN, BEAT_FALL_SHAPE_MAX, d.fallShape),
    invert: typeof source.invert === 'boolean' ? source.invert : d.invert,
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
