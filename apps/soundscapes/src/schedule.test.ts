import { describe, expect, it } from 'vitest'
import {
  calendarPress,
  effectiveDays,
  MINUTES_PER_DAY,
  MINUTES_PER_WEEK,
  moveEntry,
  newEntry,
  scheduleEvents,
  stepTime,
  toggleDay,
  weekTimeline,
  type Schedule,
  type ScheduleEntry,
} from './schedule'

const entry = (presetId: string, start: number, stop: number, days: number[], extra: Partial<ScheduleEntry> = {}): ScheduleEntry => ({
  ...newEntry(presetId),
  id: `${presetId}-${start}-${stop}`,
  start,
  stop,
  days: Array.from({ length: 7 }, (_, day) => days.includes(day)),
  ...extra,
})
const at = (day: number, hour: number, minute = 0) => (day * MINUTES_PER_DAY) + (hour * 60) + minute
const strip = (events: ReturnType<typeof scheduleEvents>) => events.map(({ fadeSec: _fade, ...event }) => event)
const schedule = (...entries: ScheduleEntry[]): Schedule => ({ enabled: true, entries })

describe('schedule', () => {
  it('plays from start to stop on its days', () => {
    expect(strip(scheduleEvents(schedule(entry('a', 8 * 60, 9 * 60 + 30, [0, 2]))))).toEqual([
      { minute: at(0, 8), kind: 'start', presetId: 'a' },
      { minute: at(0, 9, 30), kind: 'stop', presetId: null },
      { minute: at(2, 8), kind: 'start', presetId: 'a' },
      { minute: at(2, 9, 30), kind: 'stop', presetId: null },
    ])
  })

  it('a stop before the start runs into the next day, the day being the start day (Sunday into Monday)', () => {
    expect(strip(scheduleEvents(schedule(entry('a', 22 * 60, 6 * 60, [6]))))).toEqual([
      { minute: at(0, 6), kind: 'stop', presetId: null },
      { minute: at(6, 22), kind: 'start', presetId: 'a' },
    ])
  })

  it('a stop equal to the start is the whole day', () => {
    const owner = weekTimeline(schedule(entry('a', 0, 0, [3])))
    expect(owner.filter((id) => id === 'a')).toHaveLength(MINUTES_PER_DAY)
    expect(owner[at(3, 0)]).toBe('a')
    expect(owner[at(3, 23, 59)]).toBe('a')
    expect(owner[at(4, 0)]).toBeNull()
  })

  it('the higher entry wins where two overlap, and the lower one carries on around it', () => {
    expect(strip(scheduleEvents(schedule(entry('top', 10 * 60, 11 * 60, [0]), entry('low', 9 * 60, 12 * 60, [0]))))).toEqual([
      { minute: at(0, 9), kind: 'start', presetId: 'low' },
      { minute: at(0, 10), kind: 'switch', presetId: 'top' },
      { minute: at(0, 11), kind: 'switch', presetId: 'low' },
      { minute: at(0, 12), kind: 'stop', presetId: null },
    ])
  })

  it('inactive entries and entries with no soundscape play nothing; all week through is one switch', () => {
    expect(strip(scheduleEvents(schedule(entry('a', 0, 0, [0, 1, 2, 3, 4, 5, 6], { active: false }))))).toEqual([])
    expect(strip(scheduleEvents(schedule({ ...entry('a', 0, 0, [0]), presetId: null })))).toEqual([])
    expect(strip(scheduleEvents(schedule(entry('a', 0, 0, [0, 1, 2, 3, 4, 5, 6]))))).toEqual([{ minute: 0, kind: 'switch', presetId: 'a' }])
  })

  it('a start fades its entry in; a stop or a switch fades out the entry ending, by its play time', () => {
    const fades = scheduleEvents(schedule(entry('top', 10 * 60, 11 * 60, [0]), entry('low', 9 * 60, 12 * 60, [0]))).map((event) => event.fadeSec)
    // low plays 3 h (fade capped at 5 min), top 1 h (6 min, capped at 5): all capped here.
    expect(fades).toEqual([300, 300, 300, 300])
    expect(scheduleEvents(schedule(entry('a', 8 * 60, 8 * 60 + 20, [0]))).map((event) => event.fadeSec)).toEqual([120, 120])
  })

  it('events agree with the timeline at every minute', () => {
    const s = schedule(entry('a', 23 * 60, 1 * 60, [1, 4, 6]), entry('b', 0, 12 * 60, [0, 2]), entry('c', 5 * 60, 5 * 60, [5]))
    const owner = weekTimeline(s)
    const events = scheduleEvents(s)
    let playing: string | null = owner[MINUTES_PER_WEEK - 1]
    for (let minute = 0; minute < MINUTES_PER_WEEK; minute += 1) {
      for (const event of events) if (event.minute === minute) playing = event.kind === 'stop' ? null : event.presetId
      expect(playing).toBe(owner[minute])
    }
  })

  it('the calendar override: all, back, none, back; a day changed under it saves its days with that change', () => {
    const weekend = entry('a', 0, 0, [5, 6])
    const all = calendarPress(weekend, false)
    expect(effectiveDays(all).every(Boolean)).toBe(true)
    expect(effectiveDays(calendarPress(all, false))).toEqual(weekend.days)
    const none = calendarPress(weekend, true)
    expect(effectiveDays(none).some(Boolean)).toBe(false)
    expect(effectiveDays(calendarPress(none, false))).toEqual(weekend.days)
    const allButFriday = toggleDay(all, 4)
    expect(allButFriday.override).toBeNull()
    expect(allButFriday.days).toEqual([true, true, true, true, false, true, true])
  })

  it('times step and cycle; entries reorder by the universal rule', () => {
    expect(stepTime(23 * 60 + 5, 'hour', 1)).toBe(5)
    expect(stepTime(55, 'minute', 1)).toBe(0)
    expect(stepTime(0, 'minute', -1)).toBe(55)
    const s = schedule(entry('a', 0, 0, []), entry('b', 0, 0, []), entry('c', 0, 0, []))
    const ids = (next: Schedule) => next.entries.map((e) => e.presetId)
    expect(ids(moveEntry(s, s.entries[0].id, s.entries[2].id))).toEqual(['b', 'c', 'a'])
    expect(ids(moveEntry(s, s.entries[2].id, s.entries[0].id))).toEqual(['c', 'a', 'b'])
  })
})
