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
  /** Per 50ms tick, the meter loses this percent of itself AND this percent of a full meter. */
  decayPercent: number
  /** Seconds a trail box takes to fade from its creation alpha to nothing (`flow/flowTrail.ts`). */
  fadeMaxTime: number
  /** The trail fade's shape `s`: alpha at time t is `((fadeMaxTime - t) / fadeMaxTime) ^ (2 ^ s)`, so 0 is linear, positive drops early and negative holds late. */
  fadeShape: number
  /** Strength of each feedback channel at a full meter, 0..1. `caret` drives the halo and the steadying blink; the trail is driven by its colour's own alpha (the `flowTrail` highlight colour). */
  look: number
  reverb: number
  caret: number
}

export const FLOW_GAIN_PERCENT_MIN = 1
export const FLOW_GAIN_PERCENT_MAX = 10
export const FLOW_DECAY_PERCENT_MIN = 0.2
export const FLOW_DECAY_PERCENT_MAX = 5
export const FLOW_FADE_MAX_TIME_MIN = 0.5
export const FLOW_FADE_MAX_TIME_MAX = 10
export const FLOW_FADE_SHAPE_MIN = -5
export const FLOW_FADE_SHAPE_MAX = 5

export const DEFAULT_FLOW_SETTINGS: FlowSettings = {
  enabled: false,
  gainPercent: 5,
  decayPercent: 1,
  fadeMaxTime: 3,
  fadeShape: 0,
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
    fadeMaxTime: bounded(source.fadeMaxTime, FLOW_FADE_MAX_TIME_MIN, FLOW_FADE_MAX_TIME_MAX, d.fadeMaxTime),
    fadeShape: bounded(source.fadeShape, FLOW_FADE_SHAPE_MIN, FLOW_FADE_SHAPE_MAX, d.fadeShape),
    look: bounded(source.look, 0, 1, d.look),
    reverb: bounded(source.reverb, 0, 1, d.reverb),
    caret: bounded(source.caret, 0, 1, d.caret),
  }
}
