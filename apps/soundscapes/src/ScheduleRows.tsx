/**
 * The weekly schedule (schedule.ts) as rows, one per entry, highest
 * priority first, and a "+" below them.
 *
 * A row is twelve chip columns by two chip rows, the width of six of the
 * panel's buttons:
 *   [soundscape 2x2] [play] [hh] [mm] [calendar 1x2] Mo Tu We Th
 *                    [stop] [hh] [mm]                Fr Sa Su [bin]
 *
 * - The SOUNDSCAPE button: a tap turns the entry on or off; hold, then
 *   slide onto another entry's button to move it there (the app's one
 *   reorder rule). A soundscape held and slid here from the presets below
 *   becomes the entry's.
 * - A TIME field: a tap is one step on (an hour, or five minutes, round the
 *   clock); hold, then drag up or down to step through them (useStepDrag).
 * - The CALENDAR chip: a tap plays every day, a hold no day, and a tap
 *   brings the saved days back; a day changed meanwhile saves what is shown
 *   with that change (schedule.ts).
 * - The BIN: hold to delete the entry.
 * - The "+": a tap adds an entry for the soundscape that plays; a soundscape
 *   slid onto it from the presets adds one for that soundscape.
 */
import { useRef, useState, type DragEvent } from 'react'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { selectorDragType, useSelectorReorder } from '@thockdown/interaction/useSelectorReorder'
import { type SoundscapePreset } from '@thockdown/soundscape/soundscape'
import { SoundscapeMark } from '@thockdown/soundscape/SoundscapeOptions'
import {
  calendarPress,
  effectiveDays,
  moveEntry,
  newEntry,
  stepTime,
  toggleDay,
  type Schedule,
  type ScheduleEntry,
} from './schedule'
import { useStepDrag } from './useStepDrag'

/** A soundscape dragged from the presets grid (MobileSoundscapeApp's preset reorder). */
const SOUNDSCAPE_DRAG = selectorDragType('soundscape')
const DAY_NAMES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

interface ScheduleRowsProps {
  schedule: Schedule
  presets: readonly SoundscapePreset[]
  /** The soundscape that plays: what the "+" adds. */
  currentPresetId: string
  onChange: (update: (schedule: Schedule) => Schedule) => void
}

const pad = (value: number) => String(value).padStart(2, '0')

/** Accept a soundscape dropped from the presets; `target` names the cell highlighted while it is over. */
function useSoundscapeDrop(onDropSoundscape: (target: string, presetId: string) => void) {
  const [over, setOver] = useState<string | null>(null)
  return {
    over,
    handlers: (target: string) => ({
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!event.dataTransfer?.types.includes(SOUNDSCAPE_DRAG)) return false
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setOver(target)
        return true
      },
      onDragLeave: () => setOver((current) => (current === target ? null : current)),
      onDrop: (event: DragEvent<HTMLElement>) => {
        const presetId = event.dataTransfer?.getData(SOUNDSCAPE_DRAG)
        setOver(null)
        if (!presetId) return false
        event.preventDefault()
        onDropSoundscape(target, presetId)
        return true
      },
    }),
  }
}

function TimeField({ time, unit, label, onChange }: { time: number; unit: 'hour' | 'minute'; label: string; onChange: (time: number) => void }) {
  const { handlers } = useStepDrag({
    begin: () => time,
    step: (base, steps) => onChange(stepTime(base, unit, steps)),
    tap: () => onChange(stepTime(time, unit, 1)),
  })
  const value = unit === 'hour' ? Math.floor(time / 60) : time % 60
  return (
    <button
      type="button"
      className={`btn-icon options-color-swatch options-loadout-btn mobile-schedule-chip mobile-schedule-time is-${unit}`}
      aria-label={`${label} ${unit}: ${pad(value)}`}
      data-secondary-press="none"
      {...handlers}
    >
      {pad(value)}
    </button>
  )
}

/** A chip that does `action` when held, and `tap` (if any) when tapped. */
function HoldChip({ className, label, icon, tap, held }: { className: string; label: string; icon: string; tap?: () => void; held: () => void }) {
  const cancelRef = useRef<(() => void) | null>(null)
  const claimedRef = useRef(false)
  const cancel = () => {
    cancelRef.current?.()
    cancelRef.current = null
  }
  return (
    <button
      type="button"
      className={`btn-icon options-color-swatch options-loadout-btn mobile-schedule-chip ${className}`}
      aria-label={label}
      data-secondary-press="none"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        claimedRef.current = false
        cancel()
        cancelRef.current = armHold(() => {
          cancelRef.current = null
          claimedRef.current = true
          held()
        }, HOLD_CONFIRM_MS)
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onClick={() => {
        if (claimedRef.current) {
          claimedRef.current = false
          return
        }
        tap?.()
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className={`fa-solid ${icon}`} aria-hidden="true" />
    </button>
  )
}

export function ScheduleRows({ schedule, presets, currentPresetId, onChange }: ScheduleRowsProps) {
  const reorder = useSelectorReorder('schedule-entry', (dragged, target) => onChange((current) => moveEntry(current, dragged, target)), { picture: 'copy' })
  const drop = useSoundscapeDrop((target, presetId) => onChange((current) => (target === '+'
    ? { ...current, entries: [...current.entries, newEntry(presetId)] }
    : { ...current, entries: current.entries.map((entry) => (entry.id === target ? { ...entry, presetId } : entry)) })))
  const update = (id: string, change: (entry: ScheduleEntry) => ScheduleEntry) => onChange((current) => ({
    ...current,
    entries: current.entries.map((entry) => (entry.id === id ? change(entry) : entry)),
  }))

  const row = (entry: ScheduleEntry) => {
    const preset = presets.find((candidate) => candidate.id === entry.presetId) ?? null
    const cell = reorder(entry.id)
    const accepts = drop.handlers(entry.id)
    const days = effectiveDays(entry)
    const time = (which: 'start' | 'stop', unit: 'hour' | 'minute') => (
      <TimeField
        time={entry[which]}
        unit={unit}
        label={which === 'start' ? 'Start' : 'Stop'}
        onChange={(next) => update(entry.id, (current) => ({ ...current, [which]: next }))}
      />
    )
    const day = (index: number) => (
      <button
        key={index}
        type="button"
        className={`btn-icon options-color-swatch options-loadout-btn mobile-schedule-chip mobile-schedule-day${days[index] ? ' is-active' : ''}`}
        aria-pressed={days[index]}
        aria-label={DAY_NAMES[index]}
        data-secondary-press="none"
        onClick={() => update(entry.id, (current) => toggleDay(current, index))}
      >
        {DAY_NAMES[index]}
      </button>
    )
    return (
      <div key={entry.id} className={`mobile-schedule-row${entry.active ? '' : ' is-off'}`}>
        <button
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn mobile-schedule-soundscape${entry.active ? ' is-active' : ''}${drop.over === entry.id ? ' is-drop-target' : ''}`}
          aria-pressed={entry.active}
          aria-label={`${preset?.name ?? 'No soundscape'}, ${entry.active ? 'on' : 'off'}`}
          data-secondary-press="none"
          onPointerDown={cell.onPointerDown}
          {...cell.props}
          onDragOver={(event) => { if (!accepts.onDragOver(event)) cell.props.onDragOver(event) }}
          onDragLeave={accepts.onDragLeave}
          onDrop={(event) => { if (!accepts.onDrop(event)) cell.props.onDrop(event) }}
          onClick={() => update(entry.id, (current) => ({ ...current, active: !current.active }))}
          onContextMenu={(event) => event.preventDefault()}
        >
          {preset ? <SoundscapeMark preset={preset} /> : null}
        </button>
        <button type="button" tabIndex={-1} className="btn-icon options-color-swatch options-loadout-btn mobile-schedule-chip mobile-schedule-label is-start" aria-hidden="true"><span className="fa-solid fa-play" /></button>
        {time('start', 'hour')}
        {time('start', 'minute')}
        <HoldChip
          className={`mobile-schedule-calendar${entry.override ? ' is-active' : ''}`}
          label={entry.override === null ? 'Every day' : 'Back to the chosen days'}
          icon="fa-calendar-days"
          tap={() => update(entry.id, (current) => calendarPress(current, false))}
          held={() => update(entry.id, (current) => calendarPress(current, true))}
        />
        {[0, 1, 2, 3].map(day)}
        <button type="button" tabIndex={-1} className="btn-icon options-color-swatch options-loadout-btn mobile-schedule-chip mobile-schedule-label is-stop" aria-hidden="true"><span className="fa-solid fa-stop" /></button>
        {time('stop', 'hour')}
        {time('stop', 'minute')}
        {[4, 5, 6].map(day)}
        <HoldChip
          className="mobile-schedule-bin"
          label="Delete"
          icon="fa-trash-can"
          held={() => onChange((current) => ({ ...current, entries: current.entries.filter((candidate) => candidate.id !== entry.id) }))}
        />
      </div>
    )
  }

  const plus = drop.handlers('+')
  return (
    <div className="mobile-schedule" role="group" aria-label="Weekly schedule">
      {schedule.entries.map(row)}
      <div className="mobile-schedule-row">
        <button
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn mobile-schedule-soundscape${drop.over === '+' ? ' is-drop-target' : ''}`}
          aria-label="New schedule entry"
          data-secondary-press="none"
          onDragOver={plus.onDragOver}
          onDragLeave={plus.onDragLeave}
          onDrop={plus.onDrop}
          onClick={() => onChange((current) => ({ ...current, entries: [...current.entries, newEntry(currentPresetId)] }))}
        >
          <span className="fa-solid fa-plus" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
