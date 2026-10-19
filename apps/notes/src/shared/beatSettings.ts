/**
 * Beat pulse: elements that follow one band of the playing music (Options >
 * Tools). The model is `sound/musicBeat.ts` and the channels
 * `flow/useBeatFeedback.ts`; this file is only the persisted shape, its
 * defaults and its sanitizer, kept free of the DOM so the main process's
 * `sanitizeMenu` can use it too.
 */

/** How one element follows the music. Every element has the same five. */
export interface BeatChannel {
  /** The share of the element's effect a full response reaches, 0..1. */
  amount: number
  /**
   * 0 is mode A, 1 mode B, between a mix of the two. A: how far the band
   * stands ABOVE ITS OWN RECENT AVERAGE (a hit against the surrounding
   * music). B: the band's own level, followed directly.
   */
  blend: number
  /** The centre of the band, in Hz. */
  frequencyHz: number
  /** The band's width, in octaves, between its half-power points. */
  octaves: number
  /** The dB that make a full response: above the band's recent average in A, above `floorDb` in B. */
  rangeDb: number
  /** Mode B's zero, in dBFS: a band at or below it is no response, and `rangeDb` above it is a full one. */
  floorDb: number
}

export interface BeatSettings {
  enabled: boolean
  /** The caret, held at its peak while the pulse drives it; a response dips it. */
  caret: BeatChannel
  /** The active editor's inner shade; a response deepens it. */
  shade: BeatChannel
}

export const BEAT_FREQUENCY_MIN_HZ = 20
export const BEAT_FREQUENCY_MAX_HZ = 500
export const BEAT_OCTAVES_MIN = 0.1
export const BEAT_OCTAVES_MAX = 4
export const BEAT_RANGE_MIN_DB = 3
export const BEAT_RANGE_MAX_DB = 48
export const BEAT_FLOOR_MIN_DB = -90
export const BEAT_FLOOR_MAX_DB = 0

export const DEFAULT_BEAT_CHANNEL: BeatChannel = {
  amount: 0.6,
  blend: 0,
  frequencyHz: 70,
  octaves: 1,
  rangeDb: 12,
  floorDb: -50,
}

export const DEFAULT_BEAT_SETTINGS: BeatSettings = {
  enabled: false,
  caret: DEFAULT_BEAT_CHANNEL,
  shade: DEFAULT_BEAT_CHANNEL,
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
    blend: bounded(source.blend, 0, 1, d.blend),
    frequencyHz: bounded(source.frequencyHz, BEAT_FREQUENCY_MIN_HZ, BEAT_FREQUENCY_MAX_HZ, d.frequencyHz),
    octaves: bounded(source.octaves, BEAT_OCTAVES_MIN, BEAT_OCTAVES_MAX, d.octaves),
    rangeDb: bounded(source.rangeDb, BEAT_RANGE_MIN_DB, BEAT_RANGE_MAX_DB, d.rangeDb),
    floorDb: bounded(source.floorDb, BEAT_FLOOR_MIN_DB, BEAT_FLOOR_MAX_DB, d.floorDb),
  }
}

export function sanitizeBeatSettings(input: unknown): BeatSettings {
  const source = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof BeatSettings, unknown>>
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_BEAT_SETTINGS.enabled,
    caret: sanitizeChannel(source.caret),
    shade: sanitizeChannel(source.shade),
  }
}
