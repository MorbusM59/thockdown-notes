/**
 * The daily schedule: 24 hourly slots, each holding a soundscape and an
 * on/off state, and what that means as playback.
 *
 * A slot is ACTIVE when it is on and holds a soundscape that exists. Active
 * slots form RUNS around the clock (23h and 0h are neighbours, so a run may
 * cross midnight). Within a run each slot plays its own soundscape for its
 * hour, and a change of soundscape from one hour to the next is a
 * crossfade. A run's first slot is its START, which carries the minute the
 * run starts at; its last slot is its END, which carries the minute it stops
 * at: an end slot at 06h:00 stops at 6:00, so plays nothing of its hour. A
 * run of ONE slot is that whole hour and carries no minute. When every slot
 * is active there is no start or end: the soundscapes play round the clock.
 *
 * This module is the only place those rules are written. The native
 * session, which must run the schedule with the app closed, is handed the
 * EVENTS they come to (scheduleEvents) and plays those, so the rules are
 * not restated on the native side.
 */
import { SOUNDSCAPE_FACTORY_PRESETS, type SoundscapePreset } from '../../src/shared/soundscape'

export const HOURS = 24
const MINUTES_PER_DAY = HOURS * 60

export interface ScheduleSlot {
  /** The soundscape this hour plays, or null for none. */
  presetId: string | null
  on: boolean
  /** For a start slot, the minute the run starts at; for an end slot, the minute it stops at. 0, 5 .. 55. */
  minute: number
}

export interface Schedule {
  /** Whether the schedule runs playback (the power button's long press). */
  enabled: boolean
  slots: ScheduleSlot[]
}

export type SlotRole = 'inactive' | 'whole' | 'start' | 'end' | 'interior'

/**
 * What the native session does at a minute of the day:
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
  return { enabled: false, slots: Array.from({ length: HOURS }, () => ({ presetId: null, on: false, minute: 0 })) }
}

export function allPresets(customPresets: readonly SoundscapePreset[]): SoundscapePreset[] {
  return [...SOUNDSCAPE_FACTORY_PRESETS, ...customPresets]
}

/** `schedule` as stored, made safe: 24 slots, known soundscapes only (a deleted one empties its slots), minutes on the 5-minute grid. */
export function sanitizeSchedule(input: unknown, customPresets: readonly SoundscapePreset[]): Schedule {
  const known = new Set(allPresets(customPresets).map((preset) => preset.id))
  const record = (input ?? {}) as { enabled?: unknown; slots?: unknown }
  const slots = Array.isArray(record.slots) ? record.slots : []
  return {
    enabled: record.enabled === true,
    slots: Array.from({ length: HOURS }, (_, hour) => {
      const slot = (slots[hour] ?? {}) as Partial<ScheduleSlot>
      const presetId = typeof slot.presetId === 'string' && known.has(slot.presetId) ? slot.presetId : null
      const minute = typeof slot.minute === 'number' && Number.isInteger(slot.minute) && slot.minute >= 0 && slot.minute < 60 && slot.minute % 5 === 0
        ? slot.minute
        : 0
      return { presetId, on: presetId !== null && slot.on === true, minute }
    }),
  }
}

const isActive = (schedule: Schedule, hour: number) => {
  const slot = schedule.slots[((hour % HOURS) + HOURS) % HOURS]
  return slot.on && slot.presetId !== null
}

export function slotRole(schedule: Schedule, hour: number): SlotRole {
  if (!isActive(schedule, hour)) return 'inactive'
  const before = isActive(schedule, hour - 1)
  const after = isActive(schedule, hour + 1)
  if (before && after) return 'interior'
  if (!before && !after) return 'whole'
  return before ? 'end' : 'start'
}

/** A single tap on a start or end slot: the next 5 minutes, wrapping. */
export function tappedMinute(minute: number): number {
  return (minute + 5) % 60
}

/**
 * A double tap: to :00, or from :00 to :30. Its first tap has already
 * stepped the minute on (tappedMinute), so it reads the minute from before
 * that tap: a double tap at :00 arrives at :05 and goes to :30, one at :30
 * arrives at :35 and goes to :00.
 */
export function doubleTappedMinute(minuteAfterFirstTap: number): number {
  const before = (minuteAfterFirstTap + 55) % 60
  return before === 0 ? 30 : 0
}

/** The events the schedule comes to, in order of their minute of the day. */
export function scheduleEvents(schedule: Schedule): ScheduleEvent[] {
  const events: ScheduleEvent[] = []
  const preset = (hour: number) => schedule.slots[hour % HOURS].presetId
  const activeCount = schedule.slots.filter((_, hour) => isActive(schedule, hour)).length
  if (activeCount === HOURS) {
    // Round the clock: only the changes of soundscape, or one switch at
    // midnight if there are none, which says what plays all day.
    for (let hour = 0; hour < HOURS; hour += 1) {
      if (preset(hour) !== preset(hour + HOURS - 1)) events.push({ minute: hour * 60, kind: 'switch', presetId: preset(hour) })
    }
    if (events.length === 0) events.push({ minute: 0, kind: 'switch', presetId: preset(0) })
    return events
  }
  for (let first = 0; first < HOURS; first += 1) {
    if (!isActive(schedule, first) || isActive(schedule, first - 1)) continue
    let length = 1
    while (isActive(schedule, first + length)) length += 1
    const at = (hour: number, minute: number) => ((hour * 60) + minute) % MINUTES_PER_DAY
    if (length === 1) {
      events.push({ minute: at(first, 0), kind: 'start', presetId: preset(first) })
      events.push({ minute: at(first + 1, 0), kind: 'stop', presetId: null })
      continue
    }
    events.push({ minute: at(first, schedule.slots[first].minute), kind: 'start', presetId: preset(first) })
    for (let offset = 1; offset < length; offset += 1) {
      const hour = first + offset
      const isEnd = offset === length - 1
      const stopMinute = schedule.slots[hour % HOURS].minute
      // An end slot at :00 stops on the hour, so its soundscape never plays.
      if (!(isEnd && stopMinute === 0) && preset(hour) !== preset(hour - 1)) {
        events.push({ minute: at(hour, 0), kind: 'switch', presetId: preset(hour) })
      }
      if (isEnd) events.push({ minute: at(hour, stopMinute), kind: 'stop', presetId: null })
    }
  }
  return events.sort((a, b) => a.minute - b.minute)
}

/** What the schedule plays at `minute` of the day, by its events: the latest at or before it, round the clock; null for nothing. */
export function scheduledPresetAt(events: readonly ScheduleEvent[], minute: number): string | null {
  const due = events.filter((event) => event.minute <= minute)
  const last = due.length > 0 ? due[due.length - 1] : events[events.length - 1]
  return last && last.kind !== 'stop' ? last.presetId : null
}
