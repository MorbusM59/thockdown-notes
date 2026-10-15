/**
 * The typing flow meter, as a pure model: what a keystroke does to the level,
 * and what the level is at any later moment. No clock, no DOM -- the caller
 * passes times in seconds -- so it is tested by iterating it
 * (`flowModel.test.ts`) and the live store (`flowMeter.ts`) is only plumbing.
 *
 * THE LEVEL IS PUSHED BY HITS AND DECAYS BETWEEN THEM.
 *
 * A hit ADDS to the level, from the very first key: `L += gain * worth`,
 * capped at 1. `gain` is the reader's build setting, the share of a full
 * meter (1% to 10%) that one hit at the pace threshold with no rhythm bonus
 * adds. `worth` is
 *   - SPEED: `min(1, (wpm / threshold)^2)`, the pace of the running average
 *     interval against the reader's threshold. Full at the threshold and
 *     above, falling off below it. A first key, with no interval yet, counts
 *     as full speed, so flow starts from the first press.
 *   - plus a RHYTHM BONUS of up to `RHYTHM_BONUS` (half a hit): how closely
 *     this interval matches the average of the last `RHYTHM_MEMORY_KEYS`
 *     intervals. No deviation pays the whole bonus, falling linearly to
 *     nothing at a deviation of `RHYTHM_TOLERANCE` (20%) of that average.
 *     A bonus and never a penalty: a reader who eases off into a steady
 *     rhythm earns back what the slower pace cost, which is the habit it is
 *     there to reward.
 *
 * Between hits the level decays QUADRATICALLY from the last hit:
 * `L(t) = L_hit * max(0, 1 - (gap / fadeSec)^2)`. The loss starts at zero and
 * steepens with the gap, so the ordinary space between two keystrokes costs
 * almost nothing and a hesitation costs more the longer it lasts; a full
 * meter is empty exactly `fadeSec` after the last key. Evaluated in closed
 * form from the last hit, never integrated per frame, so the level at a
 * moment does not depend on how often anybody looked at it.
 *
 * An interval longer than `PAUSE_SEC` is a pause, not a beat of the rhythm:
 * it restarts the interval history rather than being averaged into it (the
 * decay has already charged for the pause itself). Nothing BREAKS a streak:
 * corrections and caret moves are ignored rather than punished, so the only
 * way flow is lost is by stopping.
 */

import type { FlowSettings } from '../shared/flowSettings'

export const RHYTHM_MEMORY_KEYS = 10
export const RHYTHM_BONUS = 0.5
export const RHYTHM_TOLERANCE = 0.2
export const PAUSE_SEC = 1.5

export type FlowTuning = Pick<FlowSettings, 'thresholdWpm' | 'gainPercent' | 'fadeSec'>

export interface FlowState {
  /** The level immediately after the last hit. */
  levelAtHit: number
  /** Time of the last hit, in seconds; null before the first. */
  lastHitSec: number | null
  /** The most recent intervals between hits, oldest first, at most `RHYTHM_MEMORY_KEYS`. */
  intervals: readonly number[]
}

export const EMPTY_FLOW_STATE: FlowState = {
  levelAtHit: 0,
  lastHitSec: null,
  intervals: [],
}

/** The level at `nowSec`, decayed from the last hit. */
export function flowLevelAt(state: FlowState, nowSec: number, tuning: Pick<FlowTuning, 'fadeSec'>): number {
  if (state.lastHitSec === null || state.levelAtHit <= 0) return 0
  const ratio = Math.max(0, nowSec - state.lastHitSec) / tuning.fadeSec
  return state.levelAtHit * Math.max(0, 1 - ratio * ratio)
}

const mean = (values: readonly number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length

/**
 * What one hit is worth in units of the build gain: speed (0..1) plus the
 * rhythm bonus (0..`RHYTHM_BONUS`). `previous` is the interval history BEFORE
 * this hit, `interval` the gap to it (null for a first key or after a pause).
 */
export function hitWorth(previous: readonly number[], interval: number | null, thresholdWpm: number): number {
  if (interval === null) return 1
  const history = [...previous, interval]
  const wpm = 12 / mean(history)
  const speed = Math.min(1, Math.pow(wpm / thresholdWpm, 2))
  if (previous.length === 0) return speed
  const average = mean(previous)
  const deviation = Math.abs(interval - average) / average
  const rhythm = Math.max(0, 1 - deviation / RHYTHM_TOLERANCE)
  return speed + RHYTHM_BONUS * rhythm
}

export function flowHit(state: FlowState, nowSec: number, tuning: FlowTuning): FlowState {
  const level = flowLevelAt(state, nowSec, tuning)
  const raw = state.lastHitSec === null ? null : nowSec - state.lastHitSec
  // A pause restarts the history; a non-positive interval (two events stamped
  // the same instant) carries no rhythm and leaves it as it was.
  const pause = raw !== null && raw > PAUSE_SEC
  const previous = pause ? [] : state.intervals
  const interval = raw === null || pause || raw <= 0 ? null : raw
  const worth = hitWorth(previous, interval, tuning.thresholdWpm)
  const intervals = interval === null ? previous : [...previous, interval].slice(-RHYTHM_MEMORY_KEYS)
  return {
    levelAtHit: Math.min(1, level + (tuning.gainPercent / 100) * worth),
    lastHitSec: nowSec,
    intervals,
  }
}

/**
 * Whether a key press is a hit. A printable character, Space or Enter is;
 * everything else -- corrections, caret moves, shortcuts, bare modifiers,
 * auto-repeat -- is ignored, never a break. AltGr arrives as Ctrl+Alt on
 * Windows and types a character (@, {, ł), so Ctrl with Alt is typing.
 */
export function isFlowHit(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat'>): boolean {
  if ((event.ctrlKey && !event.altKey) || event.metaKey || event.repeat) return false
  return event.key === 'Enter' || event.key.length === 1
}
