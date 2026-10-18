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
  /** Boxes into a new row before the trail is at full alpha: the k-th box of a row draws at min(1, k / lineRamp) of its alpha, so 1 carries straight on. */
  lineRamp: number
  /** Strength of each feedback channel at a full meter, 0..1. `trail` drives the caret (its halo, steadying blink and fade) and the trail together; at 0 neither answers flow. */
  look: number
  reverb: number
  trail: number
  /** Strength of the peak on reaching full flow, 0..1 (`flow/flowPeak.ts`): the high-pass sweep and the trail's lift and colour drain. */
  peak: number
  /** Strength of the music's flow EQ (`MusicPlayerService.setFlowEq`), 0..2: scales the whole curve, so 1 is the preset and 2 doubles every band's boost and cut. */
  amp: number
}

export const FLOW_GAIN_PERCENT_MIN = 1
export const FLOW_GAIN_PERCENT_MAX = 10
export const FLOW_DECAY_PERCENT_MIN = 0.2
export const FLOW_DECAY_PERCENT_MAX = 5
export const FLOW_FADE_MAX_TIME_MIN = 0.5
export const FLOW_FADE_MAX_TIME_MAX = 10
export const FLOW_FADE_SHAPE_MIN = -5
export const FLOW_FADE_SHAPE_MAX = 5
export const FLOW_LINE_RAMP_MIN = 1
export const FLOW_LINE_RAMP_MAX = 20
export const FLOW_AMP_MAX = 2

export const DEFAULT_FLOW_SETTINGS: FlowSettings = {
  enabled: false,
  gainPercent: 2.5,
  decayPercent: 0.25,
  fadeMaxTime: 3,
  fadeShape: 0,
  lineRamp: 4,
  look: 0.5,
  reverb: 0.5,
  trail: 0.5,
  peak: 1,
  amp: 1,
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
    lineRamp: Math.round(bounded(source.lineRamp, FLOW_LINE_RAMP_MIN, FLOW_LINE_RAMP_MAX, d.lineRamp)),
    look: bounded(source.look, 0, 1, d.look),
    reverb: bounded(source.reverb, 0, 1, d.reverb),
    // `caret` is the trail slider's name before it drove the trail too.
    trail: bounded(source.trail ?? (source as { caret?: unknown }).caret, 0, 1, d.trail),
    peak: bounded(source.peak, 0, 1, d.peak),
    amp: bounded(source.amp, 0, FLOW_AMP_MAX, d.amp),
  }
}
