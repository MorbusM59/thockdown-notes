/**
 * Typing flow: the reader's settings. The model they drive is
 * `flow/flowModel.ts`; this file is only the persisted shape, its defaults and
 * its sanitizer, kept free of the DOM so the main process's `sanitizeMenu`
 * can use the same sanitizer the renderer does.
 */

export interface FlowSettings {
  enabled: boolean
  /** The share of a full meter, in percent, that one hit adds before its rhythm bonus (`flowModel.ts`). */
  gainPercent: number
  /** Per 50ms tick, the meter loses this percent of itself AND this percent of a full meter. Trail boxes decay the same way. */
  decayPercent: number
  /** Strength of each feedback channel at a full meter, 0..1. `caret` drives the halo, the steadying blink and the trail (whose colour is the `flowTrail` highlight colour). */
  look: number
  reverb: number
  caret: number
}

export const FLOW_GAIN_PERCENT_MIN = 1
export const FLOW_GAIN_PERCENT_MAX = 10
export const FLOW_DECAY_PERCENT_MIN = 0.2
export const FLOW_DECAY_PERCENT_MAX = 5

export const DEFAULT_FLOW_SETTINGS: FlowSettings = {
  enabled: false,
  gainPercent: 5,
  decayPercent: 1,
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
    gainPercent: bounded(source.gainPercent, FLOW_GAIN_PERCENT_MIN, FLOW_GAIN_PERCENT_MAX, d.gainPercent),
    decayPercent: bounded(source.decayPercent, FLOW_DECAY_PERCENT_MIN, FLOW_DECAY_PERCENT_MAX, d.decayPercent),
    look: bounded(source.look, 0, 1, d.look),
    reverb: bounded(source.reverb, 0, 1, d.reverb),
    caret: bounded(source.caret, 0, 1, d.caret),
  }
}
