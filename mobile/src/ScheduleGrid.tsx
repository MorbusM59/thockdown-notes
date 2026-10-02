/**
 * The daily schedule's 24 hourly slots (schedule.ts), drawn as one row of
 * the panel's six cells with four half-size slots in each: the top half of
 * the row is 0h to 11h, the bottom half 12h to 23h.
 *
 * A slot shows the icon of its soundscape (a custom soundscape's number, as
 * on its own button), dimmed when the slot is off, or the minute when it is
 * a run's start or end. The current hour is outlined.
 *
 * Touch, the only input on a phone:
 * - a TAP on an empty or off slot, or the inside of a run, puts the
 *   soundscape playing now into it (and turns it on); on a start or end slot
 *   it steps the minute by 5;
 * - a DOUBLE TAP on a start or end slot sets :00, or from :00 :30
 *   (doubleTappedMinute, which accounts for the first tap's step);
 * - a LONG PRESS turns a slot holding a soundscape on or off; an off slot
 *   keeps its soundscape.
 * The click after a long press is swallowed, as in the soundscape panel.
 */
import { useEffect, useRef, useState } from 'react'
import { armHold, HOLD_CONFIRM_MS } from '../../src/shared/holdTiming'
import { FACTORY_SOUNDSCAPE_ICONS, type SoundscapePreset } from '../../src/shared/soundscape'
import {
  HOURS,
  allPresets,
  doubleTappedMinute,
  slotRole,
  tappedMinute,
  type Schedule,
  type ScheduleSlot,
} from './schedule'

/** Two taps on one slot this close together are a double tap (the soundscape panel's interval). */
const DOUBLE_TAP_MS = 300
const CELLS = 6

interface ScheduleGridProps {
  schedule: Schedule
  customPresets: readonly SoundscapePreset[]
  /** The soundscape a tap puts into a slot: the one playing now, or null when the settings are unsaved. */
  assignablePresetId: string | null
  onChange: (schedule: Schedule) => void
}

function useCurrentHour(): number {
  const [hour, setHour] = useState(() => new Date().getHours())
  useEffect(() => {
    // Re-read at the next hour; a timer that wakes once an hour, not a poll.
    const now = new Date()
    const untilNextHour = ((60 - now.getMinutes()) * 60 - now.getSeconds()) * 1000
    const timer = window.setTimeout(() => setHour(new Date().getHours()), untilNextHour + 500)
    return () => window.clearTimeout(timer)
  }, [hour])
  return hour
}

export function ScheduleGrid({ schedule, customPresets, assignablePresetId, onChange }: ScheduleGridProps) {
  const currentHour = useCurrentHour()
  const holdRef = useRef<{ pointerId: number; cancel: () => void } | null>(null)
  const swallowClickRef = useRef(false)
  const lastTapRef = useRef<{ hour: number; at: number } | null>(null)
  useEffect(() => () => holdRef.current?.cancel(), [])

  const withSlot = (hour: number, change: Partial<ScheduleSlot>): Schedule => ({
    ...schedule,
    slots: schedule.slots.map((slot, index) => (index === hour ? { ...slot, ...change } : slot)),
  })

  const tap = (hour: number, timeStamp: number) => {
    const slot = schedule.slots[hour]
    const role = slotRole(schedule, hour)
    const last = lastTapRef.current
    const isDouble = last !== null && last.hour === hour && timeStamp - last.at < DOUBLE_TAP_MS
    lastTapRef.current = isDouble ? null : { hour, at: timeStamp }
    if (role === 'start' || role === 'end') {
      onChange(withSlot(hour, { minute: isDouble ? doubleTappedMinute(slot.minute) : tappedMinute(slot.minute) }))
      return
    }
    if (assignablePresetId === null || (slot.on && slot.presetId === assignablePresetId)) return
    onChange(withSlot(hour, { presetId: assignablePresetId, on: true }))
  }

  const label = (slot: ScheduleSlot, hour: number) => {
    const role = slotRole(schedule, hour)
    if (role === 'start' || role === 'end') {
      return <span className="mobile-schedule-minute">{String(slot.minute).padStart(2, '0')}</span>
    }
    if (slot.presetId === null) return null
    const factoryIcon = FACTORY_SOUNDSCAPE_ICONS[slot.presetId]
    if (factoryIcon) return <span className={`fa-solid ${factoryIcon}`} aria-hidden="true" />
    const number = customPresets.findIndex((preset) => preset.id === slot.presetId) + 1
    return <span className="options-loadout-index">{number}</span>
  }

  const button = (hour: number) => {
    const slot = schedule.slots[hour]
    const role = slotRole(schedule, hour)
    const name = slot.presetId === null
      ? 'empty'
      : allPresets(customPresets).find((preset) => preset.id === slot.presetId)?.name ?? slot.presetId
    const minuteText = role === 'start' ? `, starts at :${String(slot.minute).padStart(2, '0')}`
      : role === 'end' ? `, stops at :${String(slot.minute).padStart(2, '0')}` : ''
    return (
      <button
        key={hour}
        type="button"
        className={`btn-icon options-color-swatch mobile-schedule-slot${role !== 'inactive' ? ' is-active' : ''}${slot.presetId !== null && !slot.on ? ' is-off' : ''}${hour === currentHour ? ' is-now' : ''}`}
        aria-label={`${hour}h: ${name}${slot.presetId !== null && !slot.on ? ', off' : ''}${minuteText}`}
        data-secondary-press="none"
        onClick={(event) => {
          if (swallowClickRef.current) {
            swallowClickRef.current = false
            return
          }
          tap(hour, event.timeStamp)
        }}
        onPointerDown={(event) => {
          swallowClickRef.current = false
          holdRef.current?.cancel()
          if (slot.presetId === null) return
          const cancel = armHold(() => {
            holdRef.current = null
            swallowClickRef.current = true
            onChange(withSlot(hour, { on: !slot.on }))
          }, HOLD_CONFIRM_MS)
          holdRef.current = { pointerId: event.pointerId, cancel }
        }}
        onPointerUp={() => { holdRef.current?.cancel(); holdRef.current = null }}
        onPointerCancel={() => { holdRef.current?.cancel(); holdRef.current = null }}
        onPointerLeave={() => { holdRef.current?.cancel(); holdRef.current = null }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {label(slot, hour)}
      </button>
    )
  }

  const half = HOURS / 2
  return (
    <div className="options-loadout-grid mobile-schedule-grid" role="group" aria-label="Daily schedule">
      {Array.from({ length: CELLS }, (_, cell) => (
        <div key={cell} className="mobile-schedule-cell">
          {button(cell * 2)}
          {button((cell * 2) + 1)}
          {button(half + (cell * 2))}
          {button(half + (cell * 2) + 1)}
        </div>
      ))}
    </div>
  )
}
