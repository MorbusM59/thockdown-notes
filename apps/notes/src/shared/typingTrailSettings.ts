/**
 * The typing trail: the reader's settings (Options > Typing Trail). The trail
 * itself is `typingTrail/typingTrail.ts`; this file is only the persisted
 * shape, its defaults and its sanitizer, kept free of the DOM so the main
 * process's `sanitizeMenu` can use the same sanitizer the renderer does.
 * Whether the trail is on at all is a feature toggle (shared/features.ts).
 */

export interface TypingTrailSettings {
  /** Seconds a trail box takes to fade from its creation alpha to nothing. */
  fadeMaxTime: number
  /** The fade's shape `s`: alpha at time t is `((fadeMaxTime - t) / fadeMaxTime) ^ (2 ^ s)`, so 0 is linear, positive drops early and negative holds late. */
  fadeShape: number
  /**
   * How many steps a run of typing takes to reach the trail colour's full
   * alpha: each new box starts `1 / gain` of it above what the previous box
   * has faded to by then (`nextTrailLevel`).
   */
  gain: number
}

export const TRAIL_FADE_MAX_TIME_MIN = 0.5
export const TRAIL_FADE_MAX_TIME_MAX = 10
export const TRAIL_FADE_SHAPE_MIN = -5
export const TRAIL_FADE_SHAPE_MAX = 5
export const TRAIL_GAIN_MIN = 1
export const TRAIL_GAIN_MAX = 50

export const DEFAULT_TYPING_TRAIL_SETTINGS: TypingTrailSettings = {
  fadeMaxTime: 3,
  fadeShape: 0,
  gain: 12,
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}

/**
 * Reads the persisted record. A save from before the typing trail was split
 * out of the typing flow has no `typingTrail` but a `flow` record whose fade
 * and shape are this trail's, so the caller passes that in its place
 * (`sanitizeTypingTrailSettings(menu.typingTrail ?? menu.flow)`): the fade is
 * kept, and every other field the flow record carried is dropped here.
 */
export function sanitizeTypingTrailSettings(input: unknown): TypingTrailSettings {
  const source = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof TypingTrailSettings, unknown>>
  const d = DEFAULT_TYPING_TRAIL_SETTINGS
  return {
    fadeMaxTime: bounded(source.fadeMaxTime, TRAIL_FADE_MAX_TIME_MIN, TRAIL_FADE_MAX_TIME_MAX, d.fadeMaxTime),
    fadeShape: bounded(source.fadeShape, TRAIL_FADE_SHAPE_MIN, TRAIL_FADE_SHAPE_MAX, d.fadeShape),
    gain: Math.round(bounded(source.gain, TRAIL_GAIN_MIN, TRAIL_GAIN_MAX, d.gain)),
  }
}
