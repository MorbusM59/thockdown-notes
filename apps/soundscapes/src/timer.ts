/**
 * The TIMER: how long a soundscape the listener plays (not one the schedule
 * plays) runs before it stops, and the one rule every end in the app fades
 * by.
 *
 * - Five DURATIONS the listener sets (5 seconds to 24 hours, on a grid that
 *   coarsens as they grow: `stepDuration`), and at most one of them ACTIVE;
 *   none active is the infinity button, playing until stopped.
 * - The countdown runs in the native session (SoundscapeSession.java), which
 *   is handed the active duration and its fade: it starts when a soundscape
 *   is started or switched to, stops while paused, and ends in a STOP, which
 *   hands back to the schedule.
 * - THE FADE RULE (`fadeSecFor`): whatever ends, a timed play or a
 *   scheduled entry, is silent at its end time, having faded out over 10%
 *   of the time it was set to play, at most five minutes. Written here
 *   only; the schedule's events and the timer both carry the number they
 *   came to, so the native side does not restate it.
 */
export const MIN_DURATION_SEC = 5
export const MAX_DURATION_SEC = 24 * 60 * 60
const MAX_FADE_SEC = 5 * 60
const FADE_SHARE = 0.1

export interface TimerSettings {
  /** The five durations, in seconds. */
  durations: number[]
  /** The index of the active one, or null for none (infinity). */
  active: number | null
}

export const DEFAULT_TIMER: TimerSettings = {
  durations: [5 * 60, 15 * 60, 60 * 60, 2 * 60 * 60, 8 * 60 * 60],
  active: null,
}

/** The fade an end takes, for something set to play `playSec`: 10% of it, at most five minutes. */
export function fadeSecFor(playSec: number): number {
  return Math.min(playSec * FADE_SHARE, MAX_FADE_SEC)
}

/** Below each bound, the step a duration moves by; past the last, an hour. */
const GRID: ReadonlyArray<readonly [below: number, step: number]> = [
  [60, 5],
  [5 * 60, 30],
  [15 * 60, 60],
  [60 * 60, 5 * 60],
  [2 * 60 * 60, 15 * 60],
  [8 * 60 * 60, 30 * 60],
]
const LAST_STEP = 60 * 60

/** The step up from `sec`: the grid of the range `sec` lies in. */
function stepUp(sec: number): number {
  return GRID.find(([below]) => sec < below)?.[1] ?? LAST_STEP
}

/** The step down from `sec`: the grid of the range just below it, so a step down undoes a step up. */
function stepDown(sec: number): number {
  return stepUp(sec - 1)
}

/** `sec` moved `steps` steps on the grid (up positive), held within 5 seconds and 24 hours. */
export function stepDuration(sec: number, steps: number): number {
  let value = sec
  for (let count = 0; count < Math.abs(steps); count += 1) {
    value = steps > 0 ? Math.min(MAX_DURATION_SEC, value + stepUp(value)) : Math.max(MIN_DURATION_SEC, value - stepDown(value))
  }
  return value
}

/** A stored duration made safe: a whole number of seconds, in range, on the grid. */
function snapDuration(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  let snapped = MIN_DURATION_SEC
  while (snapped < value && snapped < MAX_DURATION_SEC) snapped = stepDuration(snapped, 1)
  return snapped
}

export function sanitizeTimer(input: unknown): TimerSettings {
  const record = (input ?? {}) as { durations?: unknown; active?: unknown }
  const stored = Array.isArray(record.durations) ? record.durations : []
  const durations = DEFAULT_TIMER.durations.map((fallback, index) => snapDuration(stored[index], fallback))
  const active = typeof record.active === 'number' && Number.isInteger(record.active) && record.active >= 0 && record.active < durations.length
    ? record.active
    : null
  return { durations, active }
}

/**
 * A duration as its button shows it: the longer unit over the shorter, a
 * unit with nothing in it left out. Below an hour minutes and seconds,
 * from an hour hours and minutes.
 */
export function durationLines(sec: number): string[] {
  const [big, small, bigUnit, smallUnit] = sec < 60 * 60
    ? [Math.floor(sec / 60), sec % 60, 'm', 's']
    : [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), 'h', 'm']
  return [big > 0 ? `${big} ${bigUnit}` : null, small > 0 ? `${small} ${smallUnit}` : null].filter((line): line is string => line !== null)
}

/** Time left as h:mm:ss with no leading zeros: 1:05:09, 5:09, 0:09. */
export function remainingText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}
