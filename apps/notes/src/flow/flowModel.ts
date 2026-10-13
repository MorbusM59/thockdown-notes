/**
 * The typing flow meter, as a pure model: what a keystroke does to the level,
 * and what the level is at any later moment. No clock, no DOM -- the caller
 * passes times in seconds -- so it is tested by iterating it
 * (`flowModel.test.ts`) and the live store (`flowMeter.ts`) is only plumbing.
 *
 * THE LEVEL IS PUSHED BY HITS AND DECAYS BETWEEN THEM.
 *
 * A hit moves the level a share of the way to 1: `L += (1 - L) * g * q`. `g`
 * comes from the build setting (the number of perfect hits that would take an
 * empty meter to 90% with no decay: `(1 - g)^N = 0.1`), and `q`, the hit's
 * QUALITY in 0..1, is how fast and how even the recent typing has been. A
 * share of what is left, so the level can approach 1 and never pass it.
 *
 * Between hits the level decays with a HAZARD THAT GROWS WITH THE GAP:
 * `L(t) = L_hit * exp(-(gap / T)^2)`. The hazard of that curve is
 * `2 * gap / T^2`, zero at the hit and rising linearly, so the ordinary space
 * between two keystrokes costs almost nothing and a hesitation costs more the
 * longer it lasts -- the longer a key is delayed, the faster flow leaves.
 * `T` is solved from the fade setting so that a full meter is at half exactly
 * `fadeSec` after the last hit. The decay is evaluated in closed form from the
 * last hit, never integrated per frame, so the level at a moment does not
 * depend on how often anybody looked at it.
 *
 * QUALITY is speed times evenness, both read off one running estimate of the
 * LOGARITHM of the interval between hits (an exponential moving average of
 * its mean and its variance over about `RHYTHM_MEMORY_KEYS` hits). The
 * logarithm makes evenness scale-free: a 20% wobble costs the same at any
 * speed.
 *   - Speed: the geometric-mean interval as words per minute (a word being
 *     five characters, `12 / interval`), against the threshold:
 *     `r^4 / (1 + r^4)` with `r = wpm / threshold`. Half at the threshold,
 *     close to nothing well below it, and still rising above it, so faster
 *     typing keeps paying.
 *   - Evenness: `2^(-rhythm * sigma / RHYTHM_SIGMA_HALF)`, where sigma is the
 *     standard deviation of the log interval. At full strictness, a sigma of
 *     `RHYTHM_SIGMA_HALF` halves a hit's worth; at zero, rhythm is ignored.
 * Until the estimate has seen `RHYTHM_WARMUP` intervals a hit has no quality:
 * one interval says nothing about a rhythm.
 *
 * An interval longer than `PAUSE_SEC` is a pause, not a beat of the rhythm: it
 * restarts the estimate rather than being averaged into it (the decay has
 * already charged for the pause itself).
 *
 * A BREAK (arrows, Backspace, Delete, undo, jumping the caret) ends the
 * streak: the level and the estimate both start again from nothing.
 */

import type { FlowSettings } from '../shared/flowSettings'

export const RHYTHM_MEMORY_KEYS = 8
export const RHYTHM_WARMUP = 3
export const RHYTHM_SIGMA_HALF = 0.2
export const PAUSE_SEC = 1.5

export type FlowTuning = Pick<FlowSettings, 'thresholdWpm' | 'buildKeys' | 'fadeSec' | 'rhythm'>

export interface FlowState {
  /** The level immediately after the last hit. */
  levelAtHit: number
  /** Time of the last hit, in seconds; null before the first. */
  lastHitSec: number | null
  /** Running mean and variance of ln(interval), over `intervals` intervals since the estimate last restarted. */
  logMean: number
  logVariance: number
  intervals: number
}

export const EMPTY_FLOW_STATE: FlowState = {
  levelAtHit: 0,
  lastHitSec: null,
  logMean: 0,
  logVariance: 0,
  intervals: 0,
}

/** The level at `nowSec`, decayed from the last hit. */
export function flowLevelAt(state: FlowState, nowSec: number, tuning: Pick<FlowTuning, 'fadeSec'>): number {
  if (state.lastHitSec === null || state.levelAtHit <= 0) return 0
  const gap = Math.max(0, nowSec - state.lastHitSec)
  // exp(-(fadeSec / T)^2) = 1/2  =>  T = fadeSec / sqrt(ln 2)
  const ratio = (gap * Math.sqrt(Math.LN2)) / tuning.fadeSec
  return state.levelAtHit * Math.exp(-ratio * ratio)
}

/** How much one hit is worth, 0..1, given the rhythm estimate. */
export function hitQuality(state: FlowState, tuning: Pick<FlowTuning, 'thresholdWpm' | 'rhythm'>): number {
  if (state.intervals < RHYTHM_WARMUP) return 0
  const wpm = 12 / Math.exp(state.logMean)
  const r4 = Math.pow(wpm / tuning.thresholdWpm, 4)
  const speed = r4 / (1 + r4)
  const sigma = Math.sqrt(state.logVariance)
  const evenness = Math.pow(2, (-tuning.rhythm * sigma) / RHYTHM_SIGMA_HALF)
  return speed * evenness
}

/** The share of what is left that a perfect hit adds: `(1 - g)^buildKeys = 0.1`. */
export function hitGain(buildKeys: number): number {
  return 1 - Math.pow(0.1, 1 / buildKeys)
}

export function flowHit(state: FlowState, nowSec: number, tuning: FlowTuning): FlowState {
  const level = flowLevelAt(state, nowSec, tuning)
  let { logMean, logVariance, intervals } = state
  if (state.lastHitSec !== null) {
    const interval = nowSec - state.lastHitSec
    if (interval > PAUSE_SEC || interval <= 0) {
      // A pause restarts the estimate; a non-positive interval (two events
      // stamped the same instant) carries no rhythm and is skipped.
      if (interval > PAUSE_SEC) intervals = 0
    } else {
      const x = Math.log(interval)
      if (intervals === 0) {
        logMean = x
        logVariance = 0
      } else {
        const alpha = 2 / (RHYTHM_MEMORY_KEYS + 1)
        const diff = x - logMean
        logMean += alpha * diff
        logVariance = (1 - alpha) * (logVariance + alpha * diff * diff)
      }
      intervals += 1
    }
  }
  const estimate: FlowState = { levelAtHit: level, lastHitSec: nowSec, logMean, logVariance, intervals }
  const push = hitGain(tuning.buildKeys) * hitQuality(estimate, tuning)
  return { ...estimate, levelAtHit: level + (1 - level) * push }
}

/** What a key press is to the meter. */
export type FlowKeyKind = 'hit' | 'break' | 'ignore'

const BREAK_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Backspace', 'Delete',
  'Home', 'End', 'PageUp', 'PageDown',
])

/**
 * A printable character, Space or Enter is a hit; a key that corrects or
 * moves the caret is a break; a shortcut (Ctrl/Meta held) breaks too, since
 * the ones that matter mid-sentence are undo, redo and select-all; bare
 * modifiers, Tab and everything else are ignored. Auto-repeat is not typing.
 */
export function classifyFlowKey(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat'>): FlowKeyKind {
  if (BREAK_KEYS.has(event.key)) return 'break'
  if (event.ctrlKey || event.metaKey) {
    return event.key.length === 1 ? 'break' : 'ignore'
  }
  if (event.repeat) return 'ignore'
  if (event.key === 'Enter' || event.key.length === 1) return 'hit'
  return 'ignore'
}
