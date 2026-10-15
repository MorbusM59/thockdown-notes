/**
 * The typing flow meter, as a pure model: what a keystroke does to the level,
 * and what the level is at any later moment. No clock, no DOM -- the caller
 * passes times in seconds -- so it is tested by iterating it
 * (`flowModel.test.ts`) and the live store (`flowMeter.ts`) is only plumbing.
 *
 * THE LEVEL IS A PERCENTAGE PUSHED UP BY HITS AND DECAYED PER TICK.
 *
 * A hit ADDS `gain * worth`, from the very first key. `gain` is the reader's
 * build setting (a share of a full meter); `worth` is 1 plus a RHYTHM BONUS
 * of up to `RHYTHM_BONUS` for an interval matching the average of the last
 * `RHYTHM_MEMORY_KEYS` intervals (all of it at no deviation, none at a
 * deviation of `RHYTHM_TOLERANCE` of that average). A bonus and never a
 * penalty, so a steady rhythm can stand in for some speed.
 *
 * Every TICK (`TICK_SEC`, 50ms) the level loses `decay` of itself AND a flat
 * `decay` of a full meter: `L' = L * (1 - d) - d`. The multiplicative part
 * makes a fuller meter decay faster; the flat part makes it reach zero in
 * finite time instead of approaching it. That recurrence has the closed form
 * `L(n) = (L0 + 1) * (1 - d)^n - 1` (a geometric approach to -1, clamped at
 * 0), evaluated with a fractional `n` from the last hit, so the level at a
 * moment does not depend on how often anybody looked at it.
 *
 * There is no pace setting: the pace a full meter needs FOLLOWS from the two
 * settings. Holding at 1 costs `2d` a tick, so it takes
 * `2d / (gain * worth)` keys per tick, i.e. `480 * d / (gain * worth)` wpm
 * (`sustainWpm`): 96 wpm at the defaults with an uneven rhythm, 64 with a
 * perfectly steady one.
 *
 * Above a full meter is a BUFFER of `FLOW_BUFFER` that hits can fill, so a
 * reader typing at or just under the sustaining pace holds a steady full
 * meter instead of one flickering around it. Reaching full from below
 * UNLOCKS: the buffer is filled at once, a felt moment rather than a value
 * crossing a line. What is presented is the level clamped to 1
 * (`presentedFlow`); the buffer is invisible headroom.
 *
 * An interval longer than `PAUSE_SEC` is a pause, not a beat of the rhythm:
 * it restarts the interval history. Nothing BREAKS a streak: corrections
 * and caret moves are ignored, so the only way flow is lost is by stopping.
 */

import type { FlowSettings } from '../shared/flowSettings'

export const TICK_SEC = 0.05
export const FLOW_BUFFER = 0.2
export const RHYTHM_MEMORY_KEYS = 10
export const RHYTHM_BONUS = 0.5
export const RHYTHM_TOLERANCE = 0.2
export const PAUSE_SEC = 1.5

export type FlowTuning = Pick<FlowSettings, 'gainPercent' | 'decayPercent'>

export interface FlowState {
  /** The level immediately after the last hit, 0..1 + FLOW_BUFFER. */
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

/**
 * Any quantity on the meter's scale (the level, or a trail box's opacity)
 * decayed for `elapsedSec` by the per-tick rule: `(v + 1) * (1 - d)^n - 1`,
 * floored at 0.
 */
export function decayed(value: number, elapsedSec: number, decayPercent: number): number {
  if (value <= 0) return 0
  const n = Math.max(0, elapsedSec) / TICK_SEC
  return Math.max(0, (value + 1) * Math.pow(1 - decayPercent / 100, n) - 1)
}

/** Seconds until `value` has decayed to exactly zero. */
export function secondsToEmpty(value: number, decayPercent: number): number {
  if (value <= 0) return 0
  return (TICK_SEC * Math.log(1 / (value + 1))) / Math.log(1 - decayPercent / 100)
}

/** The model's level at `nowSec`, buffer included. */
export function flowLevelAt(state: FlowState, nowSec: number, tuning: Pick<FlowTuning, 'decayPercent'>): number {
  if (state.lastHitSec === null) return 0
  return decayed(state.levelAtHit, nowSec - state.lastHitSec, tuning.decayPercent)
}

/** What the reader sees of a level: the buffer above full is headroom, not more flow. */
export function presentedFlow(level: number): number {
  return Math.min(1, level)
}

/** The typing speed, in words per minute, at which a full meter holds steady. */
export function sustainWpm(tuning: FlowTuning, worth = 1): number {
  const keysPerTick = (2 * tuning.decayPercent) / (tuning.gainPercent * worth)
  return (keysPerTick / TICK_SEC) * 12
}

const mean = (values: readonly number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length

/**
 * What one hit is worth in units of the build gain: 1 plus the rhythm bonus.
 * `previous` is the interval history BEFORE this hit, `interval` the gap to
 * it (null for a first key or after a pause).
 */
export function hitWorth(previous: readonly number[], interval: number | null): number {
  if (interval === null || previous.length === 0) return 1
  const average = mean(previous)
  const deviation = Math.abs(interval - average) / average
  return 1 + RHYTHM_BONUS * Math.max(0, 1 - deviation / RHYTHM_TOLERANCE)
}

export function flowHit(state: FlowState, nowSec: number, tuning: FlowTuning): FlowState {
  const level = flowLevelAt(state, nowSec, tuning)
  const raw = state.lastHitSec === null ? null : nowSec - state.lastHitSec
  // A pause restarts the history; a non-positive interval (two events stamped
  // the same instant) carries no rhythm and leaves it as it was.
  const pause = raw !== null && raw > PAUSE_SEC
  const previous = pause ? [] : state.intervals
  const interval = raw === null || pause || raw <= 0 ? null : raw
  const raised = level + (tuning.gainPercent / 100) * hitWorth(previous, interval)
  // Reaching full from below unlocks the buffer whole.
  const next = level < 1 && raised >= 1 ? 1 + FLOW_BUFFER : Math.min(1 + FLOW_BUFFER, raised)
  return {
    levelAtHit: next,
    lastHitSec: nowSec,
    intervals: interval === null ? previous : [...previous, interval].slice(-RHYTHM_MEMORY_KEYS),
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
