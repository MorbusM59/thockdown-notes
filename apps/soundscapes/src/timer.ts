/**
 * The TIMER: how long a soundscape the listener plays (not one the schedule
 * plays) runs before it stops, and the one rule every end in the app fades
 * by.
 *
 * - Five DURATIONS the listener sets (each one of DURATIONS_SEC, 1 minute to 24 hours,
 *   stepped through by `stepDuration`), one of them SELECTED, and the timer
 *   ENABLED or not: disabled plays until stopped, and keeps the selection
 *   for when it is enabled again (`activeTimerSeconds`).
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
/** The durations a timer may be, in seconds: a drag steps through them. */
export const DURATIONS_SEC: readonly number[] = [1, 2, 5, 10, 15, 30, 60, 90].map((minutes) => minutes * 60)
  .concat([2, 4, 6, 8, 10, 12, 16, 24].map((hours) => hours * 3600))
const MAX_FADE_SEC = 5 * 60
const FADE_SHARE = 0.1

export interface TimerSettings {
  /** The five durations, in seconds. */
  durations: number[]
  /** The index of the selected one. */
  selected: number
  /** The timer runs; off, a soundscape plays until stopped. */
  enabled: boolean
}

export const DEFAULT_TIMER: TimerSettings = {
  durations: [5 * 60, 15 * 60, 60 * 60, 2 * 60 * 60, 8 * 60 * 60],
  selected: 1,
  enabled: false,
}

/** How long the timer runs, in seconds, or 0 when it is off. */
export function activeTimerSeconds(timer: TimerSettings): number {
  return timer.enabled ? timer.durations[timer.selected] : 0
}

/** The fade an end takes, for something set to play `playSec`: 10% of it, at most five minutes. */
export function fadeSecFor(playSec: number): number {
  return Math.min(playSec * FADE_SHARE, MAX_FADE_SEC)
}

/** `sec` moved `steps` places along DURATIONS_SEC (up positive), stopping at either end. */
export function stepDuration(sec: number, steps: number): number {
  const index = DURATIONS_SEC.indexOf(snapDuration(sec, DURATIONS_SEC[0]))
  return DURATIONS_SEC[Math.max(0, Math.min(DURATIONS_SEC.length - 1, index + steps))]
}

/** A stored duration made safe: the nearest of DURATIONS_SEC. */
function snapDuration(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return DURATIONS_SEC.reduce((best, candidate) => (Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best))
}

export function sanitizeTimer(input: unknown): TimerSettings {
  const record = (input ?? {}) as { durations?: unknown; selected?: unknown; enabled?: unknown }
  const stored = Array.isArray(record.durations) ? record.durations : []
  const durations = DEFAULT_TIMER.durations.map((fallback, index) => snapDuration(stored[index], fallback))
  const selected = typeof record.selected === 'number' && Number.isInteger(record.selected) && record.selected >= 0 && record.selected < durations.length
    ? record.selected
    : DEFAULT_TIMER.selected
  return { durations, selected, enabled: record.enabled === true }
}

/** A duration as its button shows it: minutes up to 90, hours from 2. */
export function durationLabel(sec: number): string {
  return sec < 2 * 3600 ? `${Math.round(sec / 60)} m` : `${Math.round(sec / 3600)} h`
}

/** Time left as h:mm:ss with no leading zeros: 1:05:09, 5:09, 0:09. */
export function remainingText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}
