/**
 * The HEALTH LOG: the failures of the playback pipeline (music, soundscape,
 * beat analysis, visualizer), kept as a rolling list of the last
 * `HEALTH_LOG_LINES` entries that survives a restart, and the one RECOVERY
 * rule every component restarts by.
 *
 * Only failures are written: a component reports when something it expected
 * did not happen (a renderer died, a decoder errored, a worker failed to
 * load), never its routine state, so the log stays readable without a filter.
 * A failure identical to the newest entry (same component, same message)
 * bumps that entry's count and time rather than adding a line, so a fault
 * that repeats cannot push everything else out.
 *
 * Kept in `localStorage` (the desktop renderer and the Android WebView alike),
 * written `SAVE_DELAY_MS` after the last change and at `pagehide`, so a failure
 * is on disk within a second and a burst costs one write.
 *
 * Recovery is a RESTART ON A TRIGGER, not a retry loop: a component reports
 * a failure, and `createRecovery` restarts it ONCE after `RECOVERY_DELAYS_MS`;
 * a second failure within the quiet period is logged with one line saying it
 * gave up, so the log shows the fault reproduced rather than a retry cycle. The ladder starts over once a component
 * has gone `RECOVERY_QUIET_MS` without failing, so whether it is healthy is
 * read off the failures themselves and no caller has to judge it: a renderer
 * that dies a second after every restart is restarted once and then left stopped.
 */

export type HealthComponent = 'music' | 'soundscape' | 'beat' | 'visualizer' | 'app'

export type HealthEntry = {
  /** Epoch milliseconds of the latest occurrence. */
  time: number
  component: HealthComponent
  message: string
  /** How many times in a row it happened. */
  count: number
}

export const HEALTH_LOG_LINES = 100
const STORAGE_KEY = 'thockdown:health-log'
const SAVE_DELAY_MS = 500
/** A message is cut here: a report is one concise line, not a stack. */
const MAX_MESSAGE_LENGTH = 240

let entries: HealthEntry[] | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

function load(): HealthEntry[] {
  if (entries) return entries
  entries = []
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? '[]')
    if (Array.isArray(parsed)) {
      entries = parsed.filter((entry): entry is HealthEntry =>
        !!entry && typeof entry.time === 'number' && typeof entry.component === 'string'
        && typeof entry.message === 'string' && typeof entry.count === 'number').slice(-HEALTH_LOG_LINES)
    }
  } catch { /* an unreadable log starts empty */ }
  if (typeof window !== 'undefined') window.addEventListener('pagehide', saveNow)
  return entries
}

function saveNow(): void {
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
  if (!entries) return
  try { storage()?.setItem(STORAGE_KEY, JSON.stringify(entries)) } catch { /* full or unavailable: kept in memory */ }
}

function changed(): void {
  if (saveTimer === null) saveTimer = setTimeout(saveNow, SAVE_DELAY_MS)
  for (const listener of listeners) listener()
}

/** Describes anything thrown as one line. */
export function describeFailure(error: unknown): string {
  if (error instanceof Error) return error.message ? `${error.name}: ${error.message}` : error.name
  return String(error)
}

/** Records a failure (also to the console, where a developer looks first). */
export function reportFailure(component: HealthComponent, message: string, now = Date.now()): void {
  const line = message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : message
  console.error(`[${component}] ${line}`)
  const log = load()
  const last = log[log.length - 1]
  if (last && last.component === component && last.message === line) {
    log[log.length - 1] = { ...last, time: now, count: last.count + 1 }
  } else {
    log.push({ time: now, component, message: line, count: 1 })
    if (log.length > HEALTH_LOG_LINES) log.splice(0, log.length - HEALTH_LOG_LINES)
  }
  changed()
}

export function readHealthLog(): readonly HealthEntry[] {
  return load()
}

export function clearHealthLog(): void {
  load().length = 0
  changed()
}

export function subscribeHealthLog(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** One entry as a line: `2026-11-26 07:12:03  music  message  (x3)`, in local time. */
export function formatHealthEntry(entry: HealthEntry): string {
  const d = new Date(entry.time)
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return `${stamp}  ${entry.component}  ${entry.message}${entry.count > 1 ? `  (x${entry.count})` : ''}`
}

/** Newest first, as the Debugging sections show and copy it. */
export function healthLogText(): string {
  return [...load()].reverse().map(formatHealthEntry).join('\n')
}

/** One restart, a second after the failure: recovery is there to keep the music going and the log to reproduce the fault, not to retry until it holds. */
export const RECOVERY_DELAYS_MS = [1000] as const
/** A failure this long after the previous one is a new fault, not the same one again. */
export const RECOVERY_QUIET_MS = 60_000

export type Recovery = {
  /** Logs the failure and schedules a restart, unless one is pending or the ladder is spent. */
  fail(message: string): void
  /** Cancels a pending restart (the component was stopped on purpose). */
  cancel(): void
}

export function createRecovery(
  component: HealthComponent,
  restart: () => void | Promise<void>,
  delaysMs: readonly number[] = RECOVERY_DELAYS_MS,
  quietMs = RECOVERY_QUIET_MS,
): Recovery {
  let attempts = 0
  let lastFailure = -Infinity
  let timer: ReturnType<typeof setTimeout> | null = null
  let gaveUp = false
  const recovery: Recovery = {
    fail(message) {
      reportFailure(component, message)
      const now = Date.now()
      if (now - lastFailure >= quietMs) { attempts = 0; gaveUp = false }
      lastFailure = now
      if (timer !== null || gaveUp) return
      if (attempts >= delaysMs.length) {
        gaveUp = true
        reportFailure(component, `gave up after ${attempts} restarts`)
        return
      }
      timer = setTimeout(() => {
        timer = null
        try {
          const result = restart()
          if (result) result.catch((error: unknown) => recovery.fail(`restart failed: ${describeFailure(error)}`))
        } catch (error) {
          recovery.fail(`restart failed: ${describeFailure(error)}`)
        }
      }, delaysMs[attempts++])
    },
    cancel() {
      if (timer !== null) { clearTimeout(timer); timer = null }
    },
  }
  return recovery
}

/**
 * Logs what nothing caught: an uncaught exception or a rejected promise
 * nobody handled, as component `app`. Installed once per page at start-up.
 */
export function installUncaughtFailureLog(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('error', (event) => {
    // A resource that failed to load fires a non-ErrorEvent here; only script errors are failures of the app.
    if (!(event instanceof ErrorEvent)) return
    // Chromium reports a ResizeObserver whose callbacks resized again as an error; it is layout churn, not a fault.
    if (event.message.startsWith('ResizeObserver loop')) return
    const where = event.filename ? ` at ${event.filename.split('/').pop()}:${event.lineno}` : ''
    reportFailure('app', `${event.error ? describeFailure(event.error) : event.message}${where}`)
  })
  window.addEventListener('unhandledrejection', (event) => {
    // An interrupted play() (a song switched while starting) rejects with AbortError by design.
    if (event.reason instanceof DOMException && event.reason.name === 'AbortError') return
    reportFailure('app', `unhandled rejection: ${describeFailure(event.reason)}`)
  })
}
