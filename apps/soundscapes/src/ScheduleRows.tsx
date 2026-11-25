/**
 * The weekly schedule (schedule.ts) as entries, highest priority first, each
 * a subsection of the tab headed by its name, and a "New schedule"
 * subsection holding the "+" below them.
 *
 * An entry is two rows, the width of six of the panel's buttons, on one
 * grid of 72 columns (a button 12, a chip 6, a time field 9, a day 9), so
 * both rows share their gaps and their row height:
 *   [on 2x2] [song set 2x2] [soundscape 2x2] [play] [hh] [mm] [edit 2x2]
 *                                            [stop] [hh] [mm]
 *   [calendar] Mo Tu We Th Fr Sa Su
 *
 * - The ON button: a tap turns the entry on or off (a check while on,
 *   blank while off); off, everything else in the entry dims.
 * - The SONG SET and SOUNDSCAPE buttons, and each TIME field (its hour or
 *   its minute), open the entry's PICKER below it: one grid, the same for
 *   every kind, a tap on a choice taking it. A soundscape held and slid onto
 *   the soundscape button from the presets becomes the entry's.
 * - An open picker closes on a tap on what opened it or anywhere outside.
 * - The PLAY and STOP chips label the start and the stop time.
 * - The EDIT button docks the entry (its name, renamed there, and the
 *   delete) and undocks it again.
 * - The CALENDAR chip: a tap plays every day, a hold no day, and a tap
 *   brings the saved days back; a day changed meanwhile saves what is shown
 *   with that change (schedule.ts).
 * - The HEADING moves the entry: held and slid onto another entry, the whole
 *   entry is dragged there (useSelectorReorder; the entry is the source and
 *   each entry a target, but only the heading arms it).
 * - The "+": a tap adds an empty entry; a soundscape slid onto it from the
 *   presets adds one for that soundscape.
 */
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { DockEntryRow } from '@thockdown/interaction/DockEntryRow'
import { OptionsFixedSection } from '@thockdown/interaction/OptionsFixedSection'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { selectorDragType, useSelectorReorder } from '@thockdown/interaction/useSelectorReorder'
import { type SoundscapePreset } from '@thockdown/soundscape/soundscape'
import { musicSetMarkOf, type MusicSet } from '@thockdown/visualizer/shared/audioPlayer'
import { SoundscapeMark } from '@thockdown/soundscape/SoundscapeOptions'
import {
  calendarPress,
  effectiveDays,
  moveEntry,
  newEntry,
  MINUTE_STEP,
  setTimePart,
  toggleDay,
  type Schedule,
  type ScheduleEntry,
} from './schedule'

/** A soundscape dragged from the presets grid (MobileSoundscapeApp's preset reorder). */
const SOUNDSCAPE_DRAG = selectorDragType('soundscape')
const DAY_NAMES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

interface ScheduleRowsProps {
  schedule: Schedule
  presets: readonly SoundscapePreset[]
  /** The song sets an entry may play. */
  musicSets: readonly MusicSet[]
  onChange: (update: (schedule: Schedule) => Schedule) => void
  /** The entry docked for editing (its name and its delete), if any. */
  editingId: string | null
  onEdit: (id: string | null) => void
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

type TimeUnit = 'hour' | 'minute'
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, step) => step * MINUTE_STEP)

/** What an entry's picker is open on: its song set, its soundscape, or one part of one of its times. */
type Open =
  | { id: string; kind: 'set' | 'soundscape' }
  | { id: string; kind: 'time'; which: 'start' | 'stop'; unit: TimeUnit }

const sameOpen = (a: Open | null, b: Open) => a !== null && a.id === b.id && a.kind === b.kind
  && (a.kind !== 'time' || (b.kind === 'time' && a.which === b.which && a.unit === b.unit))

/**
 * Close `open` on a press outside `inside` (the picker and, for a picker
 * grid, the button that toggles it, whose own tap closes it). The press goes
 * on to whatever it landed on: a tap on another time field opens that one.
 */
function useCloseOnPressOutside(isOpen: boolean, inside: () => Array<HTMLElement | null>, close: () => void) {
  const insideRef = useRef(inside)
  insideRef.current = inside
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    if (!isOpen) return undefined
    const onPress = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (insideRef.current().some((element) => element && target && element.contains(target))) return
      closeRef.current()
    }
    window.addEventListener('pointerdown', onPress, true)
    return () => window.removeEventListener('pointerdown', onPress, true)
  }, [isOpen])
}

function SetMark({ set }: { set: MusicSet }) {
  const mark = musicSetMarkOf(set)
  return 'iconClass' in mark ? <span className={mark.iconClass} aria-hidden="true" /> : <span aria-hidden="true">{mark.letters}</span>
}

/** The picker's grid: (with `none`) fa-ban first, then each choice; the assigned one lit. */
function PickerGrid<K>({ label, choices, assigned, onPick, none = true, className = '' }: {
  label: string
  choices: ReadonlyArray<{ key: K; name: string; mark: JSX.Element }>
  assigned: K | null
  onPick: (key: K | null) => void
  none?: boolean
  className?: string
}) {
  const cell = (key: K | null, name: string, mark: JSX.Element) => (
    <button
      key={key === null ? 'none' : String(key)}
      type="button"
      className={`btn-icon options-color-swatch options-loadout-btn${className}${assigned === key ? ' is-active' : ''}`}
      aria-pressed={assigned === key}
      aria-label={name}
      data-secondary-press="none"
      onClick={() => onPick(key)}
    >
      {mark}
    </button>
  )
  return (
    <div className="options-loadout-grid" role="group" aria-label={label}>
      {none ? cell(null, `No ${label.toLowerCase()}`, <span className="fa-solid fa-ban" aria-hidden="true" />) : null}
      {choices.map((choice) => cell(choice.key, choice.name, choice.mark))}
    </div>
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

export function ScheduleRows({ schedule, presets, musicSets, onChange, editingId, onEdit }: ScheduleRowsProps) {
  const [open, setOpen] = useState<Open | null>(null)
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const openerRef = useRef<HTMLButtonElement | null>(null)
  useCloseOnPressOutside(open !== null, () => [pickerRef.current, openerRef.current], () => setOpen(null))
  const drop = useSoundscapeDrop((target, presetId) => onChange((current) => (target === '+'
    ? { ...current, entries: [...current.entries, newEntry(presetId, current.entries.map((entry) => entry.name))] }
    : { ...current, entries: current.entries.map((entry) => (entry.id === target ? { ...entry, presetId } : entry)) })))
  const update = (id: string, change: (entry: ScheduleEntry) => ScheduleEntry) => onChange((current) => ({
    ...current,
    entries: current.entries.map((entry) => (entry.id === id ? change(entry) : entry)),
  }))
  const toggle = (next: Open) => setOpen((current) => (sameOpen(current, next) ? null : next))
  // An entry is moved by holding its DIVIDER and sliding it: the whole entry
  // is the drag source and each entry a drop target, but only a press on the
  // divider arms the drag, so the chips inside keep their own presses.
  const reorder = useSelectorReorder('schedule-entry', (dragged, target) => onChange((current) => moveEntry(current, dragged, target)), {
    picture: 'copy',
    onStart: () => setOpen(null),
  })

  const row = (entry: ScheduleEntry) => {
    const preset = presets.find((candidate) => candidate.id === entry.presetId) ?? null
    const set = musicSets.find((candidate) => candidate.slot === entry.setId) ?? null
    const opened = open?.id === entry.id ? open : null
    const accepts = drop.handlers(entry.id)
    const days = effectiveDays(entry)
    const chip = 'btn-icon options-color-swatch options-loadout-btn mobile-schedule-chip'
    const opener = (target: Open) => ({
      ref: sameOpen(opened, target) ? openerRef : undefined,
      'aria-expanded': sameOpen(opened, target),
      onClick: () => toggle(target),
    })
    const time = (which: 'start' | 'stop', unit: TimeUnit) => {
      const value = unit === 'hour' ? Math.floor(entry[which] / 60) : entry[which] % 60
      const target: Open = { id: entry.id, kind: 'time', which, unit }
      return (
        <button
          type="button"
          className={`${chip} mobile-schedule-time${sameOpen(opened, target) ? ' is-active' : ''}`}
          aria-label={`${which === 'start' ? 'Start' : 'Stop'} ${unit}: ${pad(value)}`}
          data-secondary-press="none"
          {...opener(target)}
        >
          {pad(value)}
        </button>
      )
    }
    const day = (index: number) => (
      <button
        key={index}
        type="button"
        className={`${chip} mobile-schedule-day${days[index] ? ' is-active' : ''}`}
        aria-pressed={days[index]}
        aria-label={DAY_NAMES[index]}
        data-secondary-press="none"
        onClick={() => update(entry.id, (current) => toggleDay(current, index))}
      >
        {DAY_NAMES[index]}
      </button>
    )
    const pickerButton = (kind: 'set' | 'soundscape', label: string, mark: JSX.Element | null, extra: object = {}) => {
      const target: Open = { id: entry.id, kind }
      return (
        <button
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn mobile-schedule-button${sameOpen(opened, target) ? ' is-active' : ''}`}
          aria-label={label}
          data-secondary-press="none"
          {...opener(target)}
          {...extra}
        >
          {mark}
        </button>
      )
    }
    const picker = (() => {
      if (opened === null) return null
      if (opened.kind === 'set') return (
        <PickerGrid
          label="Song set"
          choices={musicSets.map((candidate) => ({ key: candidate.slot, name: candidate.name, mark: <SetMark set={candidate} /> }))}
          assigned={entry.setId}
          onPick={(setId) => update(entry.id, (current) => ({ ...current, setId }))}
        />
      )
      if (opened.kind !== 'time') return (
        <PickerGrid
          label="Soundscape"
          choices={presets.map((candidate) => ({ key: candidate.id, name: candidate.name, mark: <SoundscapeMark preset={candidate} /> }))}
          assigned={entry.presetId}
          onPick={(presetId) => update(entry.id, (current) => ({ ...current, presetId }))}
        />
      )
      const { which, unit } = opened
      const selected = unit === 'hour' ? Math.floor(entry[which] / 60) : entry[which] % 60
      return (
        <PickerGrid
          label={`${which === 'start' ? 'Start' : 'Stop'} ${unit}`}
          none={false}
          className=" mobile-schedule-pick"
          choices={(unit === 'hour' ? HOURS : MINUTES).map((value) => ({ key: value, name: `${which === 'start' ? 'Start' : 'Stop'} ${unit} ${pad(value)}`, mark: <span>{pad(value)}</span> }))}
          assigned={selected}
          onPick={(value) => {
            if (value === null) return
            update(entry.id, (current) => ({ ...current, [which]: setTimePart(current[which], unit, value) }))
            setOpen(null)
          }}
        />
      )
    })()
    const move = reorder(entry.id)
    return (
      <div
        key={entry.id}
        className="mobile-schedule-slot"
        {...move.props}
        onPointerDown={(event) => {
          if ((event.target as Element).closest('.sidebar-options-section-heading')) move.onPointerDown(event)
        }}
      >
      <OptionsFixedSection heading={entry.name} iconClass="fa-clock">
        <div className="mobile-schedule-entry">
          <div className={`mobile-schedule-grid${entry.active ? '' : ' is-off'}`}>
            <button
              type="button"
              className={`btn-icon options-color-swatch options-loadout-btn mobile-schedule-button mobile-schedule-on${entry.active ? ' is-active' : ''}`}
              aria-pressed={entry.active}
              aria-label={entry.active ? 'Turn off' : 'Turn on'}
              data-secondary-press="none"
              onClick={() => update(entry.id, (current) => ({ ...current, active: !current.active }))}
            >
              {entry.active ? <span className="fa-solid fa-check" aria-hidden="true" /> : null}
            </button>
            {pickerButton('set', `Song set: ${set?.name ?? 'none'}`, set ? <SetMark set={set} /> : null)}
            {pickerButton('soundscape', `Soundscape: ${preset?.name ?? 'none'}`, preset ? <SoundscapeMark preset={preset} /> : null, {
              className: `btn-icon options-color-swatch options-loadout-btn mobile-schedule-button${opened?.kind === 'soundscape' ? ' is-active' : ''}${drop.over === entry.id ? ' is-drop-target' : ''}`,
              onDragOver: accepts.onDragOver,
              onDragLeave: accepts.onDragLeave,
              onDrop: accepts.onDrop,
            })}
            <button type="button" tabIndex={-1} className={`${chip} mobile-schedule-label`} aria-hidden="true"><span className="fa-solid fa-play" /></button>
            {time('start', 'hour')}
            {time('start', 'minute')}
            <button
              type="button"
              className={`btn-icon options-color-swatch options-loadout-btn mobile-schedule-button mobile-schedule-edit${editingId === entry.id ? ' is-active' : ''}`}
              aria-pressed={editingId === entry.id}
              aria-label={editingId === entry.id ? `Stop editing ${entry.name}` : `Edit ${entry.name}`}
              data-secondary-press="none"
              onClick={() => onEdit(editingId === entry.id ? null : entry.id)}
            >
              <span className="fa-solid fa-pen-to-square" aria-hidden="true" />
            </button>
            <button type="button" tabIndex={-1} className={`${chip} mobile-schedule-label`} aria-hidden="true"><span className="fa-solid fa-stop" /></button>
            {time('stop', 'hour')}
            {time('stop', 'minute')}
            <HoldChip
              className={`mobile-schedule-calendar${entry.override ? ' is-active' : ''}`}
              label={entry.override === null ? 'Every day' : 'Back to the chosen days'}
              icon="fa-calendar-days"
              tap={() => update(entry.id, (current) => calendarPress(current, false))}
              held={() => update(entry.id, (current) => calendarPress(current, true))}
            />
            {DAY_NAMES.map((_, index) => day(index))}
          </div>
          {picker ? <div ref={pickerRef} className="mobile-schedule-picker">{picker}</div> : null}
        </div>
      </OptionsFixedSection>
      </div>
    )
  }

  const plus = drop.handlers('+')
  return (
    <div className="mobile-schedule" role="group" aria-label="Weekly schedule">
      {schedule.entries.map(row)}
      <OptionsFixedSection heading="New schedule" iconClass="fa-plus">
      <div className="mobile-schedule-entry"><div className="mobile-schedule-grid">
        <button
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn mobile-schedule-button${drop.over === '+' ? ' is-drop-target' : ''}`}
          aria-label="New schedule entry"
          data-secondary-press="none"
          onDragOver={plus.onDragOver}
          onDragLeave={plus.onDragLeave}
          onDrop={plus.onDrop}
          onClick={() => onChange((current) => ({ ...current, entries: [...current.entries, newEntry(null, current.entries.map((entry) => entry.name))] }))}
        >
          <span className="fa-solid fa-plus" aria-hidden="true" />
        </button>
      </div></div>
      </OptionsFixedSection>
    </div>
  )
}

/**
 * The Schedules tab's dock while an entry is docked for editing (its EDIT
 * button): the entry's name, renamed there as a song set's is, a hold on the
 * bin to delete it, and `trailing` (the help) last.
 */
export function ScheduleDock({ schedule, editingId, onChange, onEdit, trailing }: {
  schedule: Schedule
  editingId: string
  onChange: (update: (schedule: Schedule) => Schedule) => void
  onEdit: (id: string | null) => void
  trailing: ReactNode
}) {
  const cancelHoldRef = useRef<(() => void) | null>(null)
  const cancelHold = () => {
    cancelHoldRef.current?.()
    cancelHoldRef.current = null
  }
  useEffect(() => cancelHold, [])
  const entry = schedule.entries.find((candidate) => candidate.id === editingId)
  if (!entry) return null
  return (
    <div className="options-curve-rows options-dock-rows">
      <DockEntryRow
        className="preset-dock-row mobile-schedule-dock-row"
        name={entry.name}
        takenNames={schedule.entries.filter((other) => other.id !== entry.id).map((other) => other.name)}
        onRename={(name) => onChange((current) => ({ ...current, entries: current.entries.map((candidate) => (candidate.id === entry.id ? { ...candidate, name } : candidate)) }))}
      >
        <button
          type="button"
          className="options-curve-cell options-curve-button"
          aria-label={`Delete ${entry.name}`}
          data-secondary-press="none"
          onPointerDown={(event) => {
            event.stopPropagation()
            if (event.button !== 0) return
            cancelHold()
            cancelHoldRef.current = armHold(() => {
              cancelHoldRef.current = null
              onEdit(null)
              onChange((current) => ({ ...current, entries: current.entries.filter((candidate) => candidate.id !== entry.id) }))
            }, HOLD_CONFIRM_MS)
          }}
          onPointerUp={cancelHold}
          onPointerCancel={cancelHold}
          onMouseLeave={cancelHold}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <span className="fa-solid fa-trash-can" aria-hidden="true" />
        </button>
        {trailing}
      </DockEntryRow>
    </div>
  )
}
