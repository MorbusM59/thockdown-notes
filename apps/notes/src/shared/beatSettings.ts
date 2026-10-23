/**
 * Beat pulse: elements that follow one band of the playing music (Options >
 * Tools). The model is `sound/musicBeat.ts` and the channels
 * `flow/useBeatFeedback.ts`; this file is only the persisted shape, its
 * defaults and its sanitizer, kept free of the DOM so the main process's
 * `sanitizeMenu` can use it too.
 */

/** How one element follows the music. Every element has the same six. */
export interface BeatChannel {
  /** The share of the element's effect a full response reaches, 0..1. */
  amount: number
  /**
   * The centre of the band, in Hz; `BEAT_FREQUENCY` (0) follows kick-drum
   * hits instead of one band (`sound/musicBeat.ts`'s onset reading).
   */
  frequencyHz: number
  /** The band's width, in octaves, between its half-power points. */
  octaves: number
  /**
   * Where the response starts, as a share of the surrounding ten seconds of
   * the band (`sound/musicBeat.ts`'s stretch): 0.5 means the band responds
   * only while louder than it is half the time. Higher keeps only the biggest
   * hits, lower lets more of the bass line through.
   */
  contrast: number
  /** Seconds a peak takes to fall to nothing; a hit lifts the response at once. */
  fallSec: number
  /** The fall's shape, flow's fade curve (`flowTrail.ts`'s `fadeCurve`): 0 falls evenly, higher drops early, lower holds and drops late. */
  fallShape: number
}

export interface BeatSettings {
  enabled: boolean
  /** The caret, held at its peak while the pulse drives it; a response dips it. */
  caret: BeatChannel
  /** The active editor's inner shade; a response deepens it. */
  shade: BeatChannel
  /**
   * How far the box outlines brighten at a full response. They follow the
   * shade's band and timing (one response drives both) and only their
   * intensity is their own; `shade.amount` is the shade's alone.
   */
  outlineAmount: number
  /**
   * Milliseconds the pulse is drawn later than the music is heard, per output
   * device (`sound/outputDevice.ts` names it), on top of the latency the audio
   * stack reports: a wireless headset's delay is often not reported at all.
   * A device with no entry is at 0. Negative draws it earlier.
   */
  delayMsByDevice: Record<string, number>
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
export const BEAT_DELAY_MIN_MS = -200
export const BEAT_DELAY_MAX_MS = 500

export const DEFAULT_BEAT_CHANNEL: BeatChannel = {
  amount: 0.6,
  frequencyHz: 70,
  octaves: 1,
  contrast: 0.5,
  fallSec: 0.25,
  fallShape: 0,
}

export const DEFAULT_BEAT_SETTINGS: BeatSettings = {
  enabled: false,
  caret: DEFAULT_BEAT_CHANNEL,
  shade: DEFAULT_BEAT_CHANNEL,
  outlineAmount: 0.6,
  delayMsByDevice: {},
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}

function sanitizeChannel(input: unknown): BeatChannel {
  const d = DEFAULT_BEAT_CHANNEL
  // The first version stored a bare strength per element.
  if (typeof input === 'number') return { ...d, amount: bounded(input, 0, 1, d.amount) }
  const source = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof BeatChannel, unknown>>
  return {
    amount: bounded(source.amount, 0, 1, d.amount),
    frequencyHz: source.frequencyHz === BEAT_FREQUENCY
      ? BEAT_FREQUENCY
      : bounded(source.frequencyHz, BEAT_FREQUENCY_MIN_HZ, BEAT_FREQUENCY_MAX_HZ, d.frequencyHz),
    octaves: bounded(source.octaves, BEAT_OCTAVES_MIN, BEAT_OCTAVES_MAX, d.octaves),
    contrast: bounded(source.contrast, 0, BEAT_CONTRAST_MAX, d.contrast),
    fallSec: bounded(source.fallSec, BEAT_FALL_MIN_SEC, BEAT_FALL_MAX_SEC, d.fallSec),
    fallShape: bounded(source.fallShape, BEAT_FALL_SHAPE_MIN, BEAT_FALL_SHAPE_MAX, d.fallShape),
  }
}

export function sanitizeBeatSettings(input: unknown): BeatSettings {
  const source = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof BeatSettings, unknown>>
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_BEAT_SETTINGS.enabled,
    caret: sanitizeChannel(source.caret),
    shade: sanitizeChannel(source.shade),
    outlineAmount: bounded(source.outlineAmount, 0, 1, DEFAULT_BEAT_SETTINGS.outlineAmount),
    delayMsByDevice: sanitizeDelays(source.delayMsByDevice),
  }
}

function sanitizeDelays(input: unknown): Record<string, number> {
  const delays: Record<string, number> = {}
  if (!input || typeof input !== 'object') return delays
  for (const [device, ms] of Object.entries(input)) {
    if (typeof ms === 'number' && Number.isFinite(ms)) delays[device] = Math.round(Math.max(BEAT_DELAY_MIN_MS, Math.min(BEAT_DELAY_MAX_MS, ms)))
  }
  return delays
}
