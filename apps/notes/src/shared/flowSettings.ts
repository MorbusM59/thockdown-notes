/**
 * Typing flow: the reader's settings. The model they drive is
 * `flow/flowModel.ts`; this file is only the persisted shape, its defaults and
 * its sanitizer, kept free of the DOM so the main process's `sanitizeMenu`
 * can use the same sanitizer the renderer does.
 */

export interface FlowSettings {
  enabled: boolean
  /** Typing speed, in words per minute (5 characters a word), at which a hit counts for half. */
  thresholdWpm: number
  /** Keystrokes of steady typing at the threshold's speed or better that take an empty meter to 90%. */
  buildKeys: number
  /** Seconds after the last keystroke at which a full meter has fallen to half. */
  fadeSec: number
  /** How much an uneven rhythm costs, 0 (not at all) to 1 (strict). */
  rhythm: number
  /** Strength of each feedback channel at a full meter, 0..1. */
  look: number
  reverb: number
  caret: number
}

export const FLOW_THRESHOLD_WPM_MIN = 10
export const FLOW_THRESHOLD_WPM_MAX = 160
export const FLOW_BUILD_KEYS_MIN = 20
export const FLOW_BUILD_KEYS_MAX = 600
export const FLOW_FADE_SEC_MIN = 0.5
export const FLOW_FADE_SEC_MAX = 10

export const DEFAULT_FLOW_SETTINGS: FlowSettings = {
  enabled: false,
  thresholdWpm: 45,
  buildKeys: 150,
  fadeSec: 2.5,
  rhythm: 0.5,
  look: 0.5,
  reverb: 0.5,
  caret: 0.5,
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}

export function sanitizeFlowSettings(input: unknown): FlowSettings {
  const source = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof FlowSettings, unknown>>
  const d = DEFAULT_FLOW_SETTINGS
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : d.enabled,
    thresholdWpm: bounded(source.thresholdWpm, FLOW_THRESHOLD_WPM_MIN, FLOW_THRESHOLD_WPM_MAX, d.thresholdWpm),
    buildKeys: bounded(source.buildKeys, FLOW_BUILD_KEYS_MIN, FLOW_BUILD_KEYS_MAX, d.buildKeys),
    fadeSec: bounded(source.fadeSec, FLOW_FADE_SEC_MIN, FLOW_FADE_SEC_MAX, d.fadeSec),
    rhythm: bounded(source.rhythm, 0, 1, d.rhythm),
    look: bounded(source.look, 0, 1, d.look),
    reverb: bounded(source.reverb, 0, 1, d.reverb),
    caret: bounded(source.caret, 0, 1, d.caret),
  }
}
