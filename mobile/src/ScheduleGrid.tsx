/**
 * The daily schedule's 24 hourly slots (schedule.ts), drawn as one row of
 * the panel's six cells with four half-size slots in each: the top half of
 * the row is 0h to 11h, the bottom half 12h to 23h.
 *
 * A slot shows the icon of its soundscape (a custom soundscape's number, as
 * on its own button), dimmed when the slot is off, or the minute when it is
 * a run's start or end. The current hour is outlined.
 *
 * A soundscape PICKED UP in the panel below (a long press on it) is what a
 * slot is filled with: while one is picked up every slot shows its HOUR,
 * so the hours can be found, and every tap puts it into the tapped slot
 * and turns the slot on -- slot after slot, until it is put down. That is
 * the only thing a slot does while one is picked up.
 *
 * With nothing picked up, a slot is worked by TAP and DRAG, told apart by
 * how far the finger travels (DRAG_THRESHOLD_PX, the app's one threshold
 * for a press becoming a drag):
 * - a TAP turns a slot holding a soundscape on or off; an off slot keeps its
 *   soundscape, dimmed;
 * - a DRAG, in any direction, on an INACTIVE slot (off, or empty) clears it;
 * - a DRAG up or down on a run's START or END slot moves its minute: up is
 *   later, down is earlier, 5 minutes per step, wrapping past :55 and :00.
 *   A step is the slot's own height, so the minute moves by a slot's worth
 *   of travel at a time and can be set exactly; it is measured from where
 *   the drag began, so moving back undoes it.
 * Dragging the inside of a run does nothing. The page does not scroll under
 * a finger (PageScrollbar.tsx), so a drag here is always the slot's.
 */
import { useEffect, useRef, useState } from 'react'
import { DRAG_THRESHOLD_PX } from '../../src/shared/pointerDrag'
import { FACTORY_SOUNDSCAPE_ICONS, type SoundscapePreset } from '../../src/shared/soundscape'
import {
  HOURS,
  allPresets,
  slotRole,
  type Schedule,
  type ScheduleSlot,
  type SlotRole,
} from './schedule'

const CELLS = 6
const MINUTE_STEP = 5

interface ScheduleGridProps {
  schedule: Schedule
  customPresets: readonly SoundscapePreset[]
  /** The soundscape picked up, which a tap puts into a slot; null for none. */
  pickedPresetId: string | null
  onChange: (schedule: Schedule) => void
}

/** A press on a slot, until its release decides whether it was a tap. */
interface SlotPress {
  pointerId: number
  hour: number
  x: number
  y: number
  /** Decided when the press began: what a drag on this slot does. */
  role: SlotRole
  minute: number
  /** One 5-minute step of vertical travel, in px: the slot's own height. */
  stepPx: number
  dragging: boolean
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

export function ScheduleGrid({ schedule, customPresets, pickedPresetId, onChange }: ScheduleGridProps) {
  const currentHour = useCurrentHour()
  const pressRef = useRef<SlotPress | null>(null)

  const withSlot = (hour: number, change: Partial<ScheduleSlot>): Schedule => ({
    ...schedule,
    slots: schedule.slots.map((slot, index) => (index === hour ? { ...slot, ...change } : slot)),
  })

  const tap = (hour: number) => {
    const slot = schedule.slots[hour]
    if (pickedPresetId !== null) {
      if (!(slot.on && slot.presetId === pickedPresetId)) onChange(withSlot(hour, { presetId: pickedPresetId, on: true }))
      return
    }
    if (slot.presetId !== null) onChange(withSlot(hour, { on: !slot.on }))
  }

  /** The press has moved: start the drag once past the threshold, then apply it. */
  const drag = (press: SlotPress, x: number, y: number) => {
    if (!press.dragging) {
      if (Math.hypot(x - press.x, y - press.y) < DRAG_THRESHOLD_PX) return
      press.dragging = true
      if (pickedPresetId !== null) return
      if (press.role === 'inactive') {
        const slot = schedule.slots[press.hour]
        if (slot.presetId !== null || slot.on) onChange(withSlot(press.hour, { presetId: null, on: false, minute: 0 }))
        return
      }
    }
    if (pickedPresetId !== null || (press.role !== 'start' && press.role !== 'end')) return
    // Up is later: screen y grows downwards.
    const steps = Math.round((press.y - y) / press.stepPx)
    const minute = (((press.minute + (steps * MINUTE_STEP)) % 60) + 60) % 60
    if (minute !== schedule.slots[press.hour].minute) onChange(withSlot(press.hour, { minute }))
  }

  const label = (slot: ScheduleSlot, hour: number) => {
    if (pickedPresetId !== null) return <span className="mobile-schedule-minute">{hour}</span>
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
        data-pick-target=""
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          pressRef.current = {
            pointerId: event.pointerId,
            hour,
            x: event.clientX,
            y: event.clientY,
            role,
            minute: slot.minute,
            stepPx: Math.max(1, event.currentTarget.offsetHeight),
            dragging: false,
          }
        }}
        onPointerMove={(event) => {
          const press = pressRef.current
          if (press && press.pointerId === event.pointerId) drag(press, event.clientX, event.clientY)
        }}
        onPointerUp={(event) => {
          const press = pressRef.current
          if (!press || press.pointerId !== event.pointerId) return
          pressRef.current = null
          if (!press.dragging) tap(press.hour)
        }}
        onPointerCancel={() => { pressRef.current = null }}
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
