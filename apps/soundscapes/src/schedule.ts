/**
 * The weekly schedule: a list of ENTRIES, each a soundscape played from a
 * start time to a stop time on chosen days, and what that means as playback.
 *
 * - An entry plays on each of its DAYS from its start; a stop earlier than
 *   the start runs into the next day (22:00 to 06:00 on Friday plays from
 *   Friday 22:00 to Saturday 06:00), and a stop equal to the start is the
 *   whole day from it.
 * - Its days are the SAVED days unless an OVERRIDE is on: `all` (the
 *   calendar chip tapped) or `none` (held). Turning the override off brings
 *   the saved days back; changing a day while it is on saves the override's
 *   days with that change (`toggleDay`).
 * - Only ACTIVE entries with a soundscape play, and where two overlap the
 *   one HIGHER in the list wins: the list's order is the priority.
 *
 * This module is the only place those rules are written. The native
 * session, which must run the schedule with the app closed, is handed the
 * EVENTS they come to (scheduleEvents), at minutes of the WEEK from Monday
 * 00:00, and plays those, so the rules are not restated on the native side.
 */
import { type SoundscapePreset } from '@thockdown/soundscape/soundscape'

export const MINUTES_PER_DAY = 24 * 60
export const DAYS = 7
export const MINUTES_PER_WEEK = DAYS * MINUTES_PER_DAY
/** Times are on a five-minute grid. */
export const MINUTE_STEP = 5

export type DayOverride = 'all' | 'none' | null

export interface ScheduleEntry {
  readonly id: string
  /** The soundscape it plays, or null when that soundscape was deleted. */
  presetId: string | null
  active: boolean
  /** Minutes of the day, on the five-minute grid. */
  start: number
  stop: number
  /** Monday first. */
  days: boolean[]
  override: DayOverride
}

export interface Schedule {
  /** Whether the schedule runs playback (the power button's long press). */
  enabled: boolean
  /** Highest priority first. */
  entries: ScheduleEntry[]
}

/**
 * What the native session does at a minute of the week:
 * - start: begin playing `presetId`, fading in, even if paused by the listener;
 * - switch: crossfade to `presetId` if playing (if paused, it plays when resumed);
 * - stop: fade out and end.
 */
export interface ScheduleEvent {
  minute: number
  kind: 'start' | 'switch' | 'stop'
  presetId: string | null
}

export function emptySchedule(): Schedule {
  return { enabled: false, entries: [] }
}

/** The days an entry plays on: the override's, or the saved ones. */
export function effectiveDays(entry: ScheduleEntry): boolean[] {
  if (entry.override === 'all') return Array.from({ length: DAYS }, () => true)
  if (entry.override === 'none') return Array.from({ length: DAYS }, () => false)
  return entry.days
}

/** A new entry for `presetId`: 00:00 to 00:00, no days, active. */
export function newEntry(presetId: string | null): ScheduleEntry {
  return {
    id: `entry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    presetId,
    active: true,
    start: 0,
    stop: 0,
    days: Array.from({ length: DAYS }, () => false),
    override: null,
  }
}

/** Change one day: from an override, its days with that change become the saved days. */
export function toggleDay(entry: ScheduleEntry, day: number): ScheduleEntry {
  const days = effectiveDays(entry).map((on, index) => (index === day ? !on : on))
  return { ...entry, days, override: null }
}

/** The calendar chip: a tap turns an override off, or on as `all`; a hold makes it `none`. */
export function calendarPress(entry: ScheduleEntry, held: boolean): ScheduleEntry {
  if (held) return { ...entry, override: 'none' }
  return { ...entry, override: entry.override === null ? 'all' : null }
}

/** `time` moved by `steps` hours (`unit` hour) or five-minute steps (`unit` minute), cycling within its hour or day. */
export function stepTime(time: number, unit: 'hour' | 'minute', steps: number): number {
  const hour = Math.floor(time / 60)
  const minute = time % 60
  if (unit === 'hour') return (((hour + steps) % 24 + 24) % 24) * 60 + minute
  return hour * 60 + ((((minute / MINUTE_STEP) + steps) % 12 + 12) % 12) * MINUTE_STEP
}

/** Move `draggedId` to `targetId`'s place, the way every reorder in the app does. */
export function moveEntry(schedule: Schedule, draggedId: string, targetId: string): Schedule {
  const from = schedule.entries.findIndex((entry) => entry.id === draggedId)
  const to = schedule.entries.findIndex((entry) => entry.id === targetId)
  if (from < 0 || to < 0 || from === to) return schedule
  const entries = [...schedule.entries]
  const [moved] = entries.splice(from, 1)
  entries.splice(to, 0, moved)
  return { ...schedule, entries }
}

const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)
  && value >= 0 && value < MINUTES_PER_DAY && value % MINUTE_STEP === 0

/** `schedule` as stored, made safe: known soundscapes only (a deleted one leaves its entry empty), times on the grid. Anything else starts empty. */
export function sanitizeSchedule(input: unknown, presets: readonly SoundscapePreset[]): Schedule {
  const known = new Set(presets.map((preset) => preset.id))
  const record = (input ?? {}) as { enabled?: unknown; entries?: unknown }
  const entries = Array.isArray(record.entries) ? record.entries : []
  return {
    enabled: record.enabled === true,
    entries: entries.flatMap((raw): ScheduleEntry[] => {
      const entry = (raw ?? {}) as Partial<ScheduleEntry>
      if (typeof entry.id !== 'string') return []
      const days = Array.isArray(entry.days) ? entry.days : []
      return [{
        id: entry.id,
        presetId: typeof entry.presetId === 'string' && known.has(entry.presetId) ? entry.presetId : null,
        active: entry.active === true,
        start: isTime(entry.start) ? entry.start : 0,
        stop: isTime(entry.stop) ? entry.stop : 0,
        days: Array.from({ length: DAYS }, (_, day) => days[day] === true),
        override: entry.override === 'all' || entry.override === 'none' ? entry.override : null,
      }]
    }),
  }
}

/** What plays at each minute of the week, by the rules above. */
export function weekTimeline(schedule: Schedule): Array<string | null> {
  const owner: Array<string | null> = Array.from({ length: MINUTES_PER_WEEK }, () => null)
  // Lowest priority first, so a higher entry paints over it.
  for (const entry of [...schedule.entries].reverse()) {
    if (!entry.active || entry.presetId === null) continue
    const length = entry.stop > entry.start ? entry.stop - entry.start
      : entry.stop < entry.start ? entry.stop + MINUTES_PER_DAY - entry.start
      : MINUTES_PER_DAY
    effectiveDays(entry).forEach((on, day) => {
      if (!on) return
      const from = (day * MINUTES_PER_DAY) + entry.start
      for (let offset = 0; offset < length; offset += 1) owner[(from + offset) % MINUTES_PER_WEEK] = entry.presetId
    })
  }
  return owner
}

/** The events the schedule comes to, in order of their minute of the week. */
export function scheduleEvents(schedule: Schedule): ScheduleEvent[] {
  const owner = weekTimeline(schedule)
  const events: ScheduleEvent[] = []
  for (let minute = 0; minute < MINUTES_PER_WEEK; minute += 1) {
    const now = owner[minute]
    const before = owner[(minute + MINUTES_PER_WEEK - 1) % MINUTES_PER_WEEK]
    if (now === before) continue
    events.push({ minute, kind: before === null ? 'start' : now === null ? 'stop' : 'switch', presetId: now })
  }
  // Playing all week through one soundscape: one switch says what plays.
  if (events.length === 0 && owner[0] !== null) events.push({ minute: 0, kind: 'switch', presetId: owner[0] })
  return events
}
