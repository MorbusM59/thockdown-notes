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
 * - An entry assigns a soundscape, a song set, or both: two CHANNELS. Only
 *   ACTIVE entries play, and each channel is decided on its own: where two
 *   entries that assign the same channel overlap, the one HIGHER in the list
 *   wins it, and an entry that leaves a channel empty does not claim it. So
 *   a song set scheduled over an all-night soundscape plays with it.
 *
 * This module is the only place those rules are written. The native
 * session, which must run the schedule with the app closed, is handed the
 * EVENTS they come to (scheduleEvents), at minutes of the WEEK from Monday
 * 00:00, and plays those, so the rules are not restated on the native side.
 */
import { type SoundscapePreset } from '@thockdown/soundscape/soundscape'
import { fadeSecFor } from './timer'

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
  /** The song set it plays (musicLibrary.ts's set slot), or null for none. */
  setId: number | null
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
  /**
   * How long the change takes (timer.ts's fade rule). A stop or a switch
   * fades out the entry that ENDS, finishing at `minute`, so it begins this
   * long before; a start fades the entry it starts in from `minute`.
   */
  fadeSec: number
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
    setId: null,
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

/** `time` with its hour (`unit` hour, 0..23) or its minute (`unit` minute, a multiple of MINUTE_STEP) set to `value`, the other part kept. */
export function setTimePart(time: number, unit: 'hour' | 'minute', value: number): number {
  return unit === 'hour' ? (value * 60) + (time % 60) : (Math.floor(time / 60) * 60) + value
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
        setId: typeof entry.setId === 'number' && Number.isInteger(entry.setId) ? entry.setId : null,
        active: entry.active === true,
        start: isTime(entry.start) ? entry.start : 0,
        stop: isTime(entry.stop) ? entry.stop : 0,
        days: Array.from({ length: DAYS }, (_, day) => days[day] === true),
        override: entry.override === 'all' || entry.override === 'none' ? entry.override : null,
      }]
    }),
  }
}

/** How long `entry` plays each time: start to stop, round midnight, the whole day when they are equal. */
function entryMinutes(entry: ScheduleEntry): number {
  return entry.stop > entry.start ? entry.stop - entry.start
    : entry.stop < entry.start ? entry.stop + MINUTES_PER_DAY - entry.start
    : MINUTES_PER_DAY
}

/** A channel of the schedule: what an entry assigns to it, or null when it leaves it empty. */
type Channel<K> = (entry: ScheduleEntry) => K | null

const soundscapeChannel: Channel<string> = (entry) => entry.presetId
const musicChannel: Channel<number> = (entry) => entry.setId

/** The entry that owns `channel` at each minute of the week, by the rules above. */
function weekOwners<K>(schedule: Schedule, channel: Channel<K>): Array<ScheduleEntry | null> {
  const owner: Array<ScheduleEntry | null> = Array.from({ length: MINUTES_PER_WEEK }, () => null)
  // Lowest priority first, so a higher entry paints over it.
  for (const entry of [...schedule.entries].reverse()) {
    if (!entry.active || channel(entry) === null) continue
    const length = entryMinutes(entry)
    effectiveDays(entry).forEach((on, day) => {
      if (!on) return
      const from = (day * MINUTES_PER_DAY) + entry.start
      for (let offset = 0; offset < length; offset += 1) owner[(from + offset) % MINUTES_PER_WEEK] = entry
    })
  }
  return owner
}

/** What `channel` plays at each minute of the week. */
function timeline<K>(schedule: Schedule, channel: Channel<K>): Array<K | null> {
  return weekOwners(schedule, channel).map((entry) => (entry === null ? null : channel(entry)))
}

/** The changes `channel` comes to, in order of their minute of the week. */
function channelEvents<K>(schedule: Schedule, channel: Channel<K>): Array<{ minute: number; kind: ScheduleEvent['kind']; value: K | null; fadeSec: number }> {
  const owner = weekOwners(schedule, channel)
  const valueAt = (minute: number) => {
    const entry = owner[minute]
    return entry === null ? null : channel(entry)
  }
  const events: Array<{ minute: number; kind: ScheduleEvent['kind']; value: K | null; fadeSec: number }> = []
  for (let minute = 0; minute < MINUTES_PER_WEEK; minute += 1) {
    const previous = (minute + MINUTES_PER_WEEK - 1) % MINUTES_PER_WEEK
    const now = valueAt(minute)
    const before = valueAt(previous)
    if (now === before) continue
    // A start fades the entry in; a stop or a switch fades out the one ending.
    const fading = before === null ? owner[minute]! : owner[previous]!
    events.push({
      minute,
      kind: before === null ? 'start' : now === null ? 'stop' : 'switch',
      value: now,
      fadeSec: fadeSecFor(entryMinutes(fading) * 60),
    })
  }
  // Playing all week through one value: one switch says what plays.
  const always = valueAt(0)
  if (events.length === 0 && always !== null) events.push({ minute: 0, kind: 'switch', value: always, fadeSec: 0 })
  return events
}

/** What soundscape plays at each minute of the week. */
export function weekTimeline(schedule: Schedule): Array<string | null> {
  return timeline(schedule, soundscapeChannel)
}

/** What song set plays at each minute of the week. */
export function weekMusicTimeline(schedule: Schedule): Array<number | null> {
  return timeline(schedule, musicChannel)
}

/** The soundscape's events, in order of their minute of the week. */
export function scheduleEvents(schedule: Schedule): ScheduleEvent[] {
  return channelEvents(schedule, soundscapeChannel).map(({ value, ...event }) => ({ ...event, presetId: value }))
}

/** A change of the scheduled song set, as ScheduleEvent is of the soundscape. */
export interface MusicScheduleEvent {
  minute: number
  kind: ScheduleEvent['kind']
  setId: number | null
  fadeSec: number
}

/** The song set's events, in order of their minute of the week. */
export function musicScheduleEvents(schedule: Schedule): MusicScheduleEvent[] {
  return channelEvents(schedule, musicChannel).map(({ value, ...event }) => ({ ...event, setId: value }))
}
