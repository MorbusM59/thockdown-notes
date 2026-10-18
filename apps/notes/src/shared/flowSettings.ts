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
  /** Milliseconds after the last hit before the IDLE decay sets in (`flowModel.ts`'s `idleFactor`). */
  idleGraceMs: number
  /** The idle decay's shape, the same curve as the trail fade's (`fadeShape`). */
  idleShape: number
  /** Seconds the idle decay takes, once it has set in, to bring the meter to zero. */
  idleDuration: number
  /** Seconds a trail box takes to fade from its creation alpha to nothing (`flow/flowTrail.ts`). */
  fadeMaxTime: number
  /** The trail fade's shape `s`: alpha at time t is `((fadeMaxTime - t) / fadeMaxTime) ^ (2 ^ s)`, so 0 is linear, positive drops early and negative holds late. */
  fadeShape: number
  /** Boxes into a new row before the trail is at full alpha: the k-th box of a row draws at min(1, k / lineRamp) of its alpha, so 1 carries straight on. */
  lineRamp: number
  /** Strength of each feedback channel at a full meter, 0..1. `trail` drives the trail alone; the caret's hold while typing does not depend on it. */
  look: number
  reverb: number
  trail: number
  /** Strength of the music's flow EQ (`MusicPlayerService.setFlowEq`), 0..1: scales the whole curve, so 1 is the preset (more distorted the sound). */
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
export const FLOW_AMP_MAX = 1
export const FLOW_IDLE_GRACE_MAX_MS = 3000
export const FLOW_IDLE_DURATION_MIN = 0.2
export const FLOW_IDLE_DURATION_MAX = 10

export const DEFAULT_FLOW_SETTINGS: FlowSettings = {
  enabled: false,
  gainPercent: 5,
  decayPercent: 0.25,
  idleGraceMs: 500,
  idleShape: 2.5,
  idleDuration: 1.5,
  fadeMaxTime: 3,
  fadeShape: 0,
  lineRamp: 8,
  look: 0.5,
  reverb: 0.5,
  trail: 0.8,
  amp: 0.8,
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}

export function sanitizeFlowSettings(input: unknown): FlowSettings {
  const source = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof FlowSettings, unknown>>
  const d = DEFAULT_FLOW_SETTINGS
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : d.enabled,
    // Fixed at their defaults: not offered in the options panel (a reader
    // tuning their own meter is the competitive element the panel avoids),
    // so a value saved while they were is not read back. The fields and
    // their wiring stay, so offering them again is a slider and these lines.
    gainPercent: d.gainPercent,
    decayPercent: d.decayPercent,
    idleGraceMs: d.idleGraceMs,
    idleShape: d.idleShape,
    idleDuration: d.idleDuration,
    fadeMaxTime: bounded(source.fadeMaxTime, FLOW_FADE_MAX_TIME_MIN, FLOW_FADE_MAX_TIME_MAX, d.fadeMaxTime),
    fadeShape: bounded(source.fadeShape, FLOW_FADE_SHAPE_MIN, FLOW_FADE_SHAPE_MAX, d.fadeShape),
    lineRamp: d.lineRamp,
    look: bounded(source.look, 0, 1, d.look),
    reverb: bounded(source.reverb, 0, 1, d.reverb),
    // `caret` is the trail slider's name before it drove the trail too.
    trail: bounded(source.trail ?? (source as { caret?: unknown }).caret, 0, 1, d.trail),
    amp: bounded(source.amp, 0, FLOW_AMP_MAX, d.amp),
  }
}
