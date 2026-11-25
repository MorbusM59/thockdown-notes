/**
 * The weekly schedule (schedule.ts) as entries, one per entry, highest
 * priority first, and a "+" below them.
 *
 * An entry is two rows, the width of six of the panel's buttons, on one
 * grid of 36 columns, so the top row's twelve chip columns (3 each) and the
 * day row's nine chips (4 each) share their gaps and their row height:
 *   [on 2x2] [song set 2x2] [soundscape 2x2] [play] [hh] [mm] [grip]
 *                                            [stop] [hh] [mm]
 *   [calendar] Mo Tu We Th Fr Sa Su [bin]
 *
 * - The ON button: a tap turns the entry on or off (a check while on,
 *   blank while off); off, everything else in the entry dims.
 * - The SONG SET and SOUNDSCAPE buttons each open their own picker below
 *   the entry. A soundscape held and slid onto the soundscape button from
 *   the presets becomes the entry's.
 * - The PLAY and STOP chips label the start and the stop time.
 * - A TIME field: a tap puts its picker in place of the top row, 24 hour
 *   chips or 12 minute chips (every MINUTE_STEP); a tap on one sets it.
 * - An open picker, of either kind, closes on a tap on its value or
 *   anywhere outside it.
 * - The GRIP: hold, then slide onto another entry to move it there (the
 *   app's one reorder rule).
 * - The CALENDAR chip: a tap plays every day, a hold no day, and a tap
 *   brings the saved days back; a day changed meanwhile saves what is shown
 *   with that change (schedule.ts).
 * - The BIN: hold to delete the entry.
 * - The "+": a tap adds an empty entry; a soundscape slid onto it from the
 *   presets adds one for that soundscape.
 */
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { selectorDragType, useSelectorReorder } from '@thockdown/interaction/useSelectorReorder'
import { AccordionGroup, AccordionSection } from '@thockdown/interaction/AccordionSection'
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

/** What is open below or in place of an entry's row: a picker grid, or a time's chips. */
type Open =
  | { id: string; kind: 'set' | 'soundscape' }
  | { id: string; kind: 'time'; which: 'start' | 'stop'; unit: TimeUnit }

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

/** A picker grid: fa-ban (none) first, then each choice; the assigned one lit. */
function PickerGrid<K>({ label, choices, assigned, onPick }: {
  label: string
  choices: ReadonlyArray<{ key: K; name: string; mark: JSX.Element }>
  assigned: K | null
  onPick: (key: K | null) => void
}) {
  const cell = (key: K | null, name: string, mark: JSX.Element) => (
    <button
      key={key === null ? 'none' : String(key)}
      type="button"
      className={`btn-icon options-color-swatch options-loadout-btn${assigned === key ? ' is-active' : ''}`}
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
      {cell(null, `No ${label.toLowerCase()}`, <span className="fa-solid fa-ban" aria-hidden="true" />)}
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

export function ScheduleRows({ schedule, presets, musicSets, onChange }: ScheduleRowsProps) {
  const [open, setOpen] = useState<Open | null>(null)
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const openerRef = useRef<HTMLButtonElement | null>(null)
  useCloseOnPressOutside(open !== null, () => [pickerRef.current, openerRef.current], () => setOpen(null))
  const reorder = useSelectorReorder('schedule-entry', (dragged, target) => onChange((current) => moveEntry(current, dragged, target)), { picture: 'copy' })
  const drop = useSoundscapeDrop((target, presetId) => onChange((current) => (target === '+'
    ? { ...current, entries: [...current.entries, newEntry(presetId)] }
    : { ...current, entries: current.entries.map((entry) => (entry.id === target ? { ...entry, presetId } : entry)) })))
  const update = (id: string, change: (entry: ScheduleEntry) => ScheduleEntry) => onChange((current) => ({
    ...current,
    entries: current.entries.map((entry) => (entry.id === id ? change(entry) : entry)),
  }))
  const togglePicker = (id: string, kind: 'set' | 'soundscape') =>
    setOpen((current) => (current?.id === id && current.kind === kind ? null : { id, kind }))

  const row = (entry: ScheduleEntry) => {
    const preset = presets.find((candidate) => candidate.id === entry.presetId) ?? null
    const set = musicSets.find((candidate) => candidate.slot === entry.setId) ?? null
    const opened = open?.id === entry.id ? open : null
    const cell = reorder(entry.id)
    const accepts = drop.handlers(entry.id)
    const days = effectiveDays(entry)
    const chip = 'btn-icon options-color-swatch options-loadout-btn mobile-schedule-chip'
    const time = (which: 'start' | 'stop', unit: TimeUnit) => {
      const value = unit === 'hour' ? Math.floor(entry[which] / 60) : entry[which] % 60
      return (
        <button
          type="button"
          className={`${chip} mobile-schedule-time`}
          aria-label={`${which === 'start' ? 'Start' : 'Stop'} ${unit}: ${pad(value)}`}
          data-secondary-press="none"
          onClick={() => setOpen({ id: entry.id, kind: 'time', which, unit })}
        >
          {pad(value)}
        </button>
      )
    }
    const timeChips = (which: 'start' | 'stop', unit: TimeUnit) => {
      const selected = unit === 'hour' ? Math.floor(entry[which] / 60) : entry[which] % 60
      return (unit === 'hour' ? HOURS : MINUTES).map((value) => (
        <button
          key={value}
          type="button"
          className={`${chip} mobile-schedule-pick is-${unit}${value === selected ? ' is-active' : ''}`}
          aria-pressed={value === selected}
          aria-label={`${which === 'start' ? 'Start' : 'Stop'} ${unit} ${pad(value)}`}
          data-secondary-press="none"
          onClick={() => {
            update(entry.id, (current) => ({ ...current, [which]: setTimePart(current[which], unit, value) }))
            setOpen(null)
          }}
        >
          {pad(value)}
        </button>
      ))
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
    const pickerButton = (kind: 'set' | 'soundscape', label: string, mark: JSX.Element | null, extra: object = {}) => (
      <button
        type="button"
        ref={opened?.kind === kind ? openerRef : undefined}
        className={`btn-icon options-color-swatch options-loadout-btn mobile-schedule-button${opened?.kind === kind ? ' is-active' : ''}`}
        aria-expanded={opened?.kind === kind}
        aria-label={label}
        data-secondary-press="none"
        onClick={() => togglePicker(entry.id, kind)}
        {...extra}
      >
        {mark}
      </button>
    )
    return (
      <div
        key={entry.id}
        className="mobile-schedule-entry"
        data-drag-state={cell.props['data-drag-state']}
        onDragOver={cell.props.onDragOver}
        onDrop={cell.props.onDrop}
      >
        <div className={`mobile-schedule-grid${entry.active ? '' : ' is-off'}`}>
          {opened?.kind === 'time' ? (
            <div ref={pickerRef} className="mobile-schedule-times" role="group" aria-label={`${opened.which === 'start' ? 'Start' : 'Stop'} ${opened.unit}`}>
              {timeChips(opened.which, opened.unit)}
            </div>
          ) : (
            <>
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
                className="btn-icon options-color-swatch options-loadout-btn mobile-schedule-grip"
                aria-label="Hold and slide to move"
                data-secondary-press="none"
                onPointerDown={cell.onPointerDown}
                data-drag-source={cell.props['data-drag-source']}
                onDragStart={cell.props.onDragStart}
                onDragEnd={cell.props.onDragEnd}
                onContextMenu={(event) => event.preventDefault()}
              >
                <span className="fa-solid fa-grip-vertical" aria-hidden="true" />
              </button>
              <button type="button" tabIndex={-1} className={`${chip} mobile-schedule-label`} aria-hidden="true"><span className="fa-solid fa-stop" /></button>
              {time('stop', 'hour')}
              {time('stop', 'minute')}
            </>
          )}
          <HoldChip
            className={`mobile-schedule-calendar${entry.override ? ' is-active' : ''}`}
            label={entry.override === null ? 'Every day' : 'Back to the chosen days'}
            icon="fa-calendar-days"
            tap={() => update(entry.id, (current) => calendarPress(current, false))}
            held={() => update(entry.id, (current) => calendarPress(current, true))}
          />
          {DAY_NAMES.map((_, index) => day(index))}
          <HoldChip
            className="mobile-schedule-bin"
            label="Delete"
            icon="fa-trash-can"
            held={() => onChange((current) => ({ ...current, entries: current.entries.filter((candidate) => candidate.id !== entry.id) }))}
          />
        </div>
        {opened?.kind === 'set' ? (
          <div ref={pickerRef}>
            <AccordionGroup>
              <AccordionSection ariaLabel="Song Set" heading="Song Set" iconClass="fa-music" defaultOpen>
                <PickerGrid
                  label="Song set"
                  choices={musicSets.map((candidate) => ({ key: candidate.slot, name: candidate.name, mark: <SetMark set={candidate} /> }))}
                  assigned={entry.setId}
                  onPick={(setId) => update(entry.id, (current) => ({ ...current, setId }))}
                />
              </AccordionSection>
            </AccordionGroup>
          </div>
        ) : null}
        {opened?.kind === 'soundscape' ? (
          <div ref={pickerRef}>
            <AccordionGroup>
              <AccordionSection ariaLabel="Soundscape" heading="Soundscape" iconClass="fa-podcast" defaultOpen>
                <PickerGrid
                  label="Soundscape"
                  choices={presets.map((candidate) => ({ key: candidate.id, name: candidate.name, mark: <SoundscapeMark preset={candidate} /> }))}
                  assigned={entry.presetId}
                  onPick={(presetId) => update(entry.id, (current) => ({ ...current, presetId }))}
                />
              </AccordionSection>
            </AccordionGroup>
          </div>
        ) : null}
      </div>
    )
  }

  const plus = drop.handlers('+')
  return (
    <div className="mobile-schedule" role="group" aria-label="Weekly schedule">
      {schedule.entries.map(row)}
      <div className="mobile-schedule-grid">
        <button
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn mobile-schedule-button${drop.over === '+' ? ' is-drop-target' : ''}`}
          aria-label="New schedule entry"
          data-secondary-press="none"
          onDragOver={plus.onDragOver}
          onDragLeave={plus.onDragLeave}
          onDrop={plus.onDrop}
          onClick={() => onChange((current) => ({ ...current, entries: [...current.entries, newEntry(null)] }))}
        >
          <span className="fa-solid fa-plus" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
