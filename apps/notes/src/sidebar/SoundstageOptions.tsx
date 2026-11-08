import { useState } from 'react'

import { UnsavedPresetButton } from '@thockdown/interaction/UnsavedPresetButton'

import {
  FACTORY_SOUNDSTAGES,
  MAX_SAVED_SOUNDSTAGES,
  isUnsavedShown,
  type ActiveSoundstage,
  type FactorySoundstageId,
  type SoundstagePreferences,
  type SoundstageSettings,
} from '../shared/soundstages'


interface SoundstageOptionsProps {
  preferences: SoundstagePreferences
  setPreferences: (update: (previous: SoundstagePreferences) => SoundstagePreferences) => void
  active: ActiveSoundstage
  apply: (settings: SoundstageSettings) => void
  selectFactory: (id: FactorySoundstageId) => void
}

function newSoundstageId(): string {
  return `stage-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Music's Presets: one flat list, as Layouts and Soundscapes have. The five
 * factory soundstages, the saved ones, then the unsaved stage's plus while it
 * equals none of them (`UnsavedPresetButton`: a click plays it, a hold saves
 * it). A right-click marks a saved stage for deletion and a click then
 * deletes it. Nothing here stores which stage is active: it is `active`,
 * derived from the live settings.
 */
export function SoundstageOptions({ preferences, setPreferences, active, apply, selectFactory }: SoundstageOptionsProps) {
  const [primedId, setPrimedId] = useState<string | null>(null)

  const save = () => {
    setPreferences((previous) => (
      !isUnsavedShown(previous) || previous.saved.length >= MAX_SAVED_SOUNDSTAGES
        ? previous
        : { ...previous, saved: [...previous.saved, { id: newSoundstageId(), settings: { ...previous.unsaved, eq: previous.unsaved.eq.map((point) => ({ ...point })) } }] }
    ))
  }
  const remove = (id: string) => {
    setPrimedId(null)
    // Deleting the stage that plays keeps it playing: it becomes the unsaved stage.
    setPreferences((previous) => {
      const removed = previous.saved.find((stage) => stage.id === id)
      const saved = previous.saved.filter((stage) => stage.id !== id)
      const unsaved = removed && active.kind === 'saved' && active.id === id ? removed.settings : previous.unsaved
      return { ...previous, saved, unsaved }
    })
  }

  return (
    <div className="options-loadout-grid" role="group" aria-label="Soundstages">
      {FACTORY_SOUNDSTAGES.map((stage) => (
        <button
          key={stage.id}
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn${active.kind === 'factory' && active.id === stage.id ? ' is-active' : ''}`}
          data-tooltip={stage.name}
          aria-label={`${stage.name} soundstage`}
          onClick={() => selectFactory(stage.id)}
        >
          <span className={stage.icon} aria-hidden="true" />
        </button>
      ))}
      {preferences.saved.map((stage, index) => {
        const number = index + 1
        const isPrimed = primedId === stage.id
        return (
          <button
            key={stage.id}
            type="button"
            className={`btn-icon options-color-swatch options-loadout-btn${active.kind === 'saved' && active.id === stage.id ? ' is-active' : ''}${isPrimed ? ' primed' : ''}`}
            data-tooltip={isPrimed ? `Click to delete Soundstage ${number}` : `Soundstage ${number}\nRight-click to mark for deletion, then click.`}
            aria-label={isPrimed ? `Delete Soundstage ${number}` : `Soundstage ${number}`}
            onClick={() => {
              if (isPrimed) {
                remove(stage.id)
                return
              }
              setPrimedId(null)
              apply(stage.settings)
            }}
            data-secondary-press="action"
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setPrimedId(stage.id)
            }}
            onMouseLeave={() => { if (isPrimed) setPrimedId(null) }}
          >
            <span className="options-loadout-index">{number}</span>
          </button>
        )
      })}
      {isUnsavedShown(preferences) ? (
        <UnsavedPresetButton
          active={active.kind === 'unsaved'}
          noun="soundstage"
          canSave={preferences.saved.length < MAX_SAVED_SOUNDSTAGES}
          onSelect={() => apply(preferences.unsaved)}
          onSave={save}
        />
      ) : null}
    </div>
  )
}
