import { useState } from 'react'

import { CompactScrollbarSlider } from '@thockdown/interaction/CompactScrollbarSlider'
import { OptionsSliderRows } from '@thockdown/interaction/OptionsSliderRows'
import { UnsavedPresetButton } from '@thockdown/interaction/UnsavedPresetButton'

import {
  DEFAULT_FLASHING_SETTINGS,
  FACTORY_FLASH_SHAPES,
  FLASH_CYCLE_MAX_MS,
  FLASH_CYCLE_MIN_MS,
  FLASH_CYCLE_STEP_MS,
  FLASH_DEFAULT_HANDLE,
  FLASH_HANDLE_STEP,
  FLASH_MATCHINGS,
  FLASH_PLANE,
  FLASH_SEGMENTS,
  FLASH_X_STEP,
  FLASH_Y_STEP,
  MAX_SAVED_FLASH_SHAPES,
  isUnsavedFlashShapeShown,
  type ActiveFlashShape,
  type FlashShape,
  type FlashShapePreferences,
  type FlashingSettings,
} from '../shared/flashing'
import { CurveEditor, type CurveAxisFormat, type CurveGridLine } from './CurveEditor'

/** Twelve segments of a bar: dashed on the beats (every third), dotted between. */
const VERTICALS: readonly CurveGridLine[] = Array.from({ length: FLASH_SEGMENTS + 1 }, (_, k) => ({
  at: k / FLASH_SEGMENTS,
  kind: k % 3 === 0 ? 'dashed' : 'dotted',
}))
/** Solid at no opacity and at full. */
const HORIZONTALS: readonly CurveGridLine[] = [{ at: 0, kind: 'solid' }, { at: 1, kind: 'solid' }]

/** The cycle's x read in twelfths, the grid's segments: 0 to 12, in quarters. */
const POSITION: CurveAxisFormat = {
  display: (x) => String(Math.round(x * FLASH_SEGMENTS * 4) / 4),
  raw: (x) => String(Math.round(x * FLASH_SEGMENTS * 4) / 4),
  parse: (twelfths) => Math.round((twelfths / FLASH_SEGMENTS) / FLASH_X_STEP) * FLASH_X_STEP,
  noun: 'place in the cycle, 0 to 12',
}

const OPACITY: CurveAxisFormat = {
  display: (y) => `${Math.round(y * 100)}%`,
  raw: (y) => String(Math.round(y * 100)),
  parse: (percent) => Math.round((percent / 100) / FLASH_Y_STEP) * FLASH_Y_STEP,
  noun: 'opacity in percent',
}

interface FlashingOptionsProps {
  flashing: FlashingSettings
  /** An edit of the curve or the cycle (it becomes the unsaved preset). */
  editShape: (patch: Partial<FlashShape>) => void
  /** A preset chosen. */
  applyShape: (shape: FlashShape) => void
  setMatching: (matching: number) => void
  preferences: FlashShapePreferences
  setPreferences: (update: (previous: FlashShapePreferences) => FlashShapePreferences) => void
  active: ActiveFlashShape
  /** Whether a beat can be followed at all: Grid Beat is on. */
  beatAvailable: boolean
}

function newFlashShapeId(): string {
  return `flash-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Options > Advanced > Animations > Flashing (`shared/flashing.ts`): the
 * presets of the flash's shape (the same flat list as every preset list:
 * factory, saved, then the unsaved preset's plus while it equals none of
 * them; a right-click marks a saved one for deletion and a click deletes it),
 * the curve over one cycle, and the cycle's length and its matching to the
 * music.
 */
export function FlashingOptions({ flashing, editShape, applyShape, setMatching, preferences, setPreferences, active, beatAvailable }: FlashingOptionsProps) {
  const [primedId, setPrimedId] = useState<string | null>(null)

  const save = () => {
    setPreferences((previous) => (
      !isUnsavedFlashShapeShown(previous) || previous.saved.length >= MAX_SAVED_FLASH_SHAPES
        ? previous
        : { ...previous, saved: [...previous.saved, { id: newFlashShapeId(), shape: previous.unsaved }] }
    ))
  }
  const remove = (id: string) => {
    setPrimedId(null)
    // Deleting the preset in use keeps it in use: it becomes the unsaved preset.
    setPreferences((previous) => {
      const removed = previous.saved.find((entry) => entry.id === id)
      const saved = previous.saved.filter((entry) => entry.id !== id)
      const unsaved = removed && active.kind === 'saved' && active.id === id ? removed.shape : previous.unsaved
      return { ...previous, saved, unsaved }
    })
  }

  const matching = FLASH_MATCHINGS[flashing.matching]
  const matchingTooltip = !beatAvailable
    ? 'Matching to the music needs Grid Beat: switch it on (the drum) under Quick Access. Until then the cycle runs on its own'
    : "How the cycle follows the music's beat, in bar notation: 4/4 is one cycle a beat, 1/4 one a bar. Off runs the cycle on its own. Whenever no beat is found the cycle runs on its own"

  return (
    <>
      <div className="options-loadout-grid" role="group" aria-label="Flashing presets">
        {FACTORY_FLASH_SHAPES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`btn-icon options-color-swatch options-loadout-btn${active.kind === 'factory' && active.id === entry.id ? ' is-active' : ''}`}
            data-tooltip={entry.name}
            aria-label={`${entry.name} flashing`}
            onClick={() => applyShape(entry.shape)}
          >
            <span className={entry.icon} aria-hidden="true" />
          </button>
        ))}
        {preferences.saved.map((entry, index) => {
          const number = index + 1
          const isPrimed = primedId === entry.id
          return (
            <button
              key={entry.id}
              type="button"
              className={`btn-icon options-color-swatch options-loadout-btn${active.kind === 'saved' && active.id === entry.id ? ' is-active' : ''}${isPrimed ? ' primed' : ''}`}
              data-tooltip={isPrimed ? `Click to delete Flashing ${number}` : `Flashing ${number}\nRight-click to mark for deletion, then click.`}
              aria-label={isPrimed ? `Delete Flashing ${number}` : `Flashing ${number}`}
              onClick={() => {
                if (isPrimed) {
                  remove(entry.id)
                  return
                }
                setPrimedId(null)
                applyShape(entry.shape)
              }}
              data-secondary-press="action"
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setPrimedId(entry.id)
              }}
              onMouseLeave={() => { if (isPrimed) setPrimedId(null) }}
            >
              <span className="options-loadout-index">{number}</span>
            </button>
          )
        })}
        {isUnsavedFlashShapeShown(preferences) ? (
          <UnsavedPresetButton
            active={active.kind === 'unsaved'}
            noun="preset"
            canSave={preferences.saved.length < MAX_SAVED_FLASH_SHAPES}
            onSelect={() => applyShape(preferences.unsaved)}
            onSave={save}
          />
        ) : null}
      </div>
      <CurveEditor
        plane={FLASH_PLANE}
        curve={flashing.curve}
        onChange={(curve) => editShape({ curve })}
        xStep={FLASH_X_STEP}
        yStep={FLASH_Y_STEP}
        handleStep={FLASH_HANDLE_STEP}
        defaultHandle={FLASH_DEFAULT_HANDLE}
        verticals={VERTICALS}
        horizontals={HORIZONTALS}
        x={POSITION}
        y={OPACITY}
        endLabels={['start', 'end']}
        ariaLabel="Flashing curve"
        tooltip={'Flashing curve: the opacity over one cycle, drawn on a bar of twelve (dashed on the beats). The end runs on into the start, so the two are one point'}
      />
      <div className="utility-setting-slider-stack" aria-label="Flashing timing">
        <OptionsSliderRows rows={[2]}>
          <CompactScrollbarSlider
            id="flash-cycle"
            min={FLASH_CYCLE_MIN_MS}
            max={FLASH_CYCLE_MAX_MS}
            step={FLASH_CYCLE_STEP_MS}
            value={flashing.cycleMs}
            trackLabel="cycle"
            tooltipLabel="Milliseconds: how long one cycle takes when it is not following the music"
            ariaLabel="Length of one flashing cycle in milliseconds"
            defaultValue={DEFAULT_FLASHING_SETTINGS.cycleMs}
            onCommit={(value) => editShape({ cycleMs: Math.max(FLASH_CYCLE_MIN_MS, Math.min(FLASH_CYCLE_MAX_MS, Math.round(value / FLASH_CYCLE_STEP_MS) * FLASH_CYCLE_STEP_MS)) })}
          />
          <CompactScrollbarSlider
            id="flash-matching"
            min={0}
            max={FLASH_MATCHINGS.length - 1}
            step={1}
            value={flashing.matching}
            trackLabel="matching"
            tooltipLabel={matchingTooltip}
            ariaLabel={`Flashing matched to the music: ${matching.label}`}
            defaultValue={DEFAULT_FLASHING_SETTINGS.matching}
            formatValue={(value) => FLASH_MATCHINGS[Math.round(value)]?.label ?? ''}
            dimmed={!beatAvailable && matching.cyclesPerBeat > 0}
            onCommit={(value) => setMatching(Math.max(0, Math.min(FLASH_MATCHINGS.length - 1, Math.round(value))))}
          />
        </OptionsSliderRows>
      </div>
    </>
  )
}
