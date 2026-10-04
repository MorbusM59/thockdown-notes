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
 * so the hours can be found -- except the slots already holding it, which
 * keep its icon, so what has been placed shows -- and every tap puts it
 * into the tapped slot and turns the slot on, slot after slot, until it is
 * put down. That is the only thing a slot does while one is picked up.
 *
 * With nothing picked up, a slot is worked by TAP and DRAG. A press becomes
 * a drag only once the finger LEAVES THE SLOT, and the edge it leaves by
 * decides the axis -- so a finger that wobbles inside the slot is still a
 * tap, and a drag never starts in a direction the reader did not mean:
 * - a TAP turns a slot holding a soundscape on or off; an off slot keeps its
 *   soundscape, dimmed;
 * - a DRAG in any direction out of a slot that is OFF clears that slot, and
 *   only that slot;
 * - a drag LEFT or RIGHT out of an EMPTY slot paints emptiness: it clears
 *   every slot the finger passes, by the same hour rule as painting below;
 * - LEFT or RIGHT out of an ACTIVE slot PAINTS its soundscape, turned on,
 *   onto every slot the finger passes. Extending a run carries its EDGE MINUTES with it: the minute its first
 *   slot starts at moves to the new first slot, the minute its last slot
 *   stops at to the new last slot -- when that new edge is one this drag
 *   painted (merging into another run leaves that run's edge its own). It
 *   goes by HOURS, not by what is under the finger: each slot's width of
 *   travel is the next hour round the clock, so a drag carried past the end
 *   of a row continues at the matching end of the other one (past 11h into
 *   12h, past 23h into 0h, and the same leftwards), and a fast finger that
 *   jumps slots between two moves still fills every hour between;
 * - UP or DOWN out of a run's START or END slot moves the minute: up is
 *   later, down is earlier, 5 minutes per step, wrapping past :55 and :00. A step is the slot's own height, measured
 *   from where the press began, so leaving the slot is the first step, each
 *   slot's worth of travel after it is another, and moving back undoes
 *   them. Up or down on the inside of a run does nothing.
 * The page does not scroll under a finger (PageScrollbar.tsx), so a drag
 * here is always the slot's.
 */
import { useEffect, useRef, useState } from 'react'
import { FACTORY_SOUNDSCAPE_ICONS, type SoundscapePreset } from '../../../src/shared/soundscape'
import {
  HOURS,
  allPresets,
  runAround,
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
  /** The slot's box when pressed: leaving it is what starts a drag. */
  box: DOMRect
  /** Decided when the press began: what a drag on this slot does. */
  role: SlotRole
  minute: number
  /** One 5-minute step of vertical travel, in px: the slot's own height. */
  stepPx: number
  dragging: boolean
  /** Set when the drag starts: sideways (painting), or up and down (moving the minute). */
  axis: 'horizontal' | 'vertical' | null
  /** The pressed slot held no soundscape: a sideways drag clears what it passes. */
  empty: boolean
  /** What a sideways drag paints: the slot's soundscape, or null for emptiness. */
  presetId: string | null
  /** One hour of sideways travel, in px: the distance from one slot to the next in a row. */
  pitchPx: number
  /** How many hours from the pressed one the paint has reached, either way. */
  reached: number
  /** The run's start and stop minutes when the press began, carried to the edges a drag extends; null for a run of one slot. */
  startMinute: number | null
  stopMinute: number | null
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

  /**
   * Paint the hours `from` to `to` hours away from `hour` (round the clock,
   * either way) with `presetId` turned on, or with emptiness for null.
   */
  const paint = (press: SlotPress, from: number, to: number) => {
    const { hour, presetId } = press
    const painted = new Set<number>()
    for (let offset = Math.min(from, to); offset <= Math.max(from, to); offset += 1) {
      painted.add((((hour + offset) % HOURS) + HOURS) % HOURS)
    }
    const next = schedule.slots.map((slot, index) => {
      if (!painted.has(index)) return slot
      return presetId === null ? { presetId: null, on: false, minute: 0 } : { ...slot, presetId, on: true }
    })
    if (presetId !== null) {
      const run = runAround({ ...schedule, slots: next }, hour)
      if (run && press.startMinute !== null && painted.has(run.first)) next[run.first] = { ...next[run.first], minute: press.startMinute }
      if (run && press.stopMinute !== null && painted.has(run.last)) next[run.last] = { ...next[run.last], minute: press.stopMinute }
    }
    if (next.some((slot, index) => slot.presetId !== schedule.slots[index].presetId || slot.on !== schedule.slots[index].on || slot.minute !== schedule.slots[index].minute)) {
      onChange({ ...schedule, slots: next })
    }
  }

  /** The start and stop minutes of the run `hour` is in, for a drag to carry; none for a single slot. */
  const edgeMinutes = (hour: number) => {
    const run = runAround(schedule, hour)
    if (!run || run.first === run.last) return { startMinute: null, stopMinute: null }
    return { startMinute: schedule.slots[run.first].minute, stopMinute: schedule.slots[run.last].minute }
  }

  /** The press has moved: start the drag once the finger leaves the slot, then apply it. */
  const drag = (press: SlotPress, x: number, y: number) => {
    if (!press.dragging) {
      const { box } = press
      const outsideX = x < box.left || x > box.right
      const outsideY = y < box.top || y > box.bottom
      if (!outsideX && !outsideY) return
      press.dragging = true
      if (pickedPresetId !== null) return
      // The edge it left by; through a corner, the larger overshoot.
      const overX = Math.max(box.left - x, x - box.right, 0)
      const overY = Math.max(box.top - y, y - box.bottom, 0)
      press.axis = overX > overY ? 'horizontal' : 'vertical'
      if (press.role === 'inactive') paint(press, 0, 0)
    }
    if (pickedPresetId !== null) return
    // An off slot's drag cleared that slot when it began, and that is all it
    // does; an empty slot's sideways drag goes on clearing (presetId null).
    if (press.role === 'inactive' && !(press.empty && press.axis === 'horizontal')) return
    if (press.axis === 'horizontal') {
      const offset = Math.round((x - press.x) / press.pitchPx)
      if (offset === press.reached) return
      paint(press, press.reached, offset)
      press.reached = offset
      return
    }
    if (press.role !== 'start' && press.role !== 'end') return
    // Up is later: screen y grows downwards.
    const steps = Math.round((press.y - y) / press.stepPx)
    const minute = (((press.minute + (steps * MINUTE_STEP)) % 60) + 60) % 60
    if (minute !== schedule.slots[press.hour].minute) onChange(withSlot(press.hour, { minute }))
  }

  const label = (slot: ScheduleSlot, hour: number) => {
    const holdsPicked = pickedPresetId !== null && slot.on && slot.presetId === pickedPresetId
    if (pickedPresetId !== null && !holdsPicked) return <span className="mobile-schedule-minute">{hour}</span>
    const role = slotRole(schedule, hour)
    // While picking up, the slots already holding it show its icon, minutes and all.
    if (!holdsPicked && (role === 'start' || role === 'end')) {
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
        data-schedule-hour={hour}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          pressRef.current = {
            pointerId: event.pointerId,
            hour,
            x: event.clientX,
            y: event.clientY,
            box: event.currentTarget.getBoundingClientRect(),
            role,
            minute: slot.minute,
            stepPx: Math.max(1, event.currentTarget.offsetHeight),
            dragging: false,
            axis: null,
            empty: slot.presetId === null,
            presetId: role === 'inactive' ? null : slot.presetId,
            pitchPx: Math.max(1, (event.currentTarget.closest('.mobile-schedule-grid')?.getBoundingClientRect().width ?? 0) / (HOURS / 2)),
            reached: 0,
            ...edgeMinutes(hour),
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
