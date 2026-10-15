/**
 * Typing flow: the reader's settings. The model they drive is
 * `flow/flowModel.ts`; this file is only the persisted shape, its defaults and
 * its sanitizer, kept free of the DOM so the main process's `sanitizeMenu`
 * can use the same sanitizer the renderer does.
 */

export interface FlowSettings {
  enabled: boolean
  /** Typing speed, in words per minute (5 characters a word), at and above which a hit is worth its full gain. */
  thresholdWpm: number
  /** The share of a full meter, in percent, that one hit at the threshold pace adds (`flowModel.ts`). */
  gainPercent: number
  /** Seconds after the last keystroke at which a full meter has decayed, quadratically, to empty. Also how long a trail box takes to fade. */
  fadeSec: number
  /** Strength of each feedback channel at a full meter, 0..1. `caret` drives the halo, the steadying blink and the trail (whose colour is the `flowTrail` highlight colour). */
  look: number
  reverb: number
  caret: number
}

export const FLOW_THRESHOLD_WPM_MIN = 10
export const FLOW_THRESHOLD_WPM_MAX = 160
export const FLOW_GAIN_PERCENT_MIN = 1
export const FLOW_GAIN_PERCENT_MAX = 10
export const FLOW_FADE_SEC_MIN = 0.1
export const FLOW_FADE_SEC_MAX = 5

export const DEFAULT_FLOW_SETTINGS: FlowSettings = {
  enabled: false,
  thresholdWpm: 45,
  gainPercent: 3,
  fadeSec: 2,
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
    gainPercent: bounded(source.gainPercent, FLOW_GAIN_PERCENT_MIN, FLOW_GAIN_PERCENT_MAX, d.gainPercent),
    fadeSec: bounded(source.fadeSec, FLOW_FADE_SEC_MIN, FLOW_FADE_SEC_MAX, d.fadeSec),
    look: bounded(source.look, 0, 1, d.look),
    reverb: bounded(source.reverb, 0, 1, d.reverb),
    caret: bounded(source.caret, 0, 1, d.caret),
  }
}
