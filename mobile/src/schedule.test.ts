import { describe, expect, it } from 'vitest'
import {
  HOURS,
  doubleTappedMinute,
  emptySchedule,
  scheduleEvents,
  scheduledPresetAt,
  slotRole,
  tappedMinute,
  type Schedule,
} from './schedule'

/** `spec` maps an hour to [presetId, minute]. */
function scheduleOf(spec: Record<number, [string, number?]>): Schedule {
  const schedule = emptySchedule()
  for (const [hour, [presetId, minute]] of Object.entries(spec)) {
    schedule.slots[Number(hour)] = { presetId, on: true, minute: minute ?? 0 }
  }
  return schedule
}

/** What plays at `minute`, read straight off the slots: the oracle the events must agree with. */
function playingBySlots(schedule: Schedule, minute: number): string | null {
  const hour = Math.floor(minute / 60)
  const role = slotRole(schedule, hour)
  const slot = schedule.slots[hour]
  const into = minute % 60
  if (role === 'inactive') return null
  if (role === 'start' && into < slot.minute) return null
  if (role === 'end' && into >= slot.minute) return null
  return slot.presetId
}

function expectAgreement(schedule: Schedule) {
  const events = scheduleEvents(schedule)
  for (let minute = 0; minute < HOURS * 60; minute += 1) {
    expect(scheduledPresetAt(events, minute), `at ${Math.floor(minute / 60)}:${minute % 60}`).toBe(playingBySlots(schedule, minute))
  }
}

describe('schedule', () => {
  it('a single slot is its whole hour, whatever minute it holds', () => {
    const schedule = scheduleOf({ 4: ['rain', 25] })
    expect(slotRole(schedule, 4)).toBe('whole')
    expect(scheduleEvents(schedule)).toEqual([
      { minute: 240, kind: 'start', presetId: 'rain' },
      { minute: 300, kind: 'stop', presetId: null },
    ])
    expectAgreement(schedule)
  })

  it('a run starts at its start slot\'s minute and stops at its end slot\'s, switching on the hour', () => {
    const schedule = scheduleOf({ 22: ['rain', 30], 23: ['rain'], 0: ['wind'], 1: ['wind', 15] })
    expect([22, 23, 0, 1].map((hour) => slotRole(schedule, hour))).toEqual(['start', 'interior', 'interior', 'end'])
    expect(scheduleEvents(schedule)).toEqual([
      { minute: 0, kind: 'switch', presetId: 'wind' },
      { minute: 75, kind: 'stop', presetId: null },
      { minute: 22 * 60 + 30, kind: 'start', presetId: 'rain' },
    ])
    expectAgreement(schedule)
  })

  it('an end slot at :00 stops on the hour and never plays its own soundscape', () => {
    const schedule = scheduleOf({ 5: ['rain', 0], 6: ['wind', 0] })
    expect(scheduleEvents(schedule)).toEqual([
      { minute: 300, kind: 'start', presetId: 'rain' },
      { minute: 360, kind: 'stop', presetId: null },
    ])
    expectAgreement(schedule)
  })

  it('round the clock there is no start or stop', () => {
    const all: Record<number, [string]> = {}
    for (let hour = 0; hour < HOURS; hour += 1) all[hour] = [hour < 8 ? 'rain' : 'wind']
    const schedule = scheduleOf(all)
    expect(scheduleEvents(schedule).map((event) => event.kind)).toEqual(['switch', 'switch'])
    expectAgreement(schedule)
  })

  it('agrees with the slots at every minute for many schedules', () => {
    let seed = 7
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    for (let trial = 0; trial < 60; trial += 1) {
      const schedule = emptySchedule()
      for (let hour = 0; hour < HOURS; hour += 1) {
        if (random() < 0.5) schedule.slots[hour] = { presetId: random() < 0.5 ? 'a' : 'b', on: random() < 0.85, minute: Math.floor(random() * 12) * 5 }
      }
      expectAgreement(schedule)
    }
  })

  it('a tap steps 5 minutes and a double tap goes to :00, or from :00 to :30', () => {
    expect(tappedMinute(55)).toBe(0)
    // A double tap's first tap has already stepped the minute.
    expect(doubleTappedMinute(tappedMinute(0))).toBe(30)
    expect(doubleTappedMinute(tappedMinute(30))).toBe(0)
    expect(doubleTappedMinute(tappedMinute(45))).toBe(0)
  })
})
