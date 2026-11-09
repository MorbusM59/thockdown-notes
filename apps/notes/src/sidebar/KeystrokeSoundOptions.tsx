import { useState } from 'react'

import { UnsavedPresetButton } from '@thockdown/interaction/UnsavedPresetButton'

import {
  FACTORY_KEYSTROKE_SOUNDS,
  MAX_SAVED_KEYSTROKE_SOUNDS,
  isUnsavedKeystrokeSoundShown,
  type ActiveKeystrokeSound,
  type KeystrokeSoundPreferences,
  type KeystrokeSoundSettings,
} from '../shared/keystrokeSounds'


interface KeystrokeSoundOptionsProps {
  preferences: KeystrokeSoundPreferences
  setPreferences: (update: (previous: KeystrokeSoundPreferences) => KeystrokeSoundPreferences) => void
  active: ActiveKeystrokeSound
  apply: (settings: KeystrokeSoundSettings) => void
}

function newKeystrokeSoundId(): string {
  return `keys-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Keystroke Sounds' presets, the same flat list as Music's
 * (`SoundstageOptions.tsx`): the ten factory presets (named after the factory
 * layouts whose sounds they are), the saved ones, then the unsaved preset's
 * plus while it equals none of them (a click selects it, a hold saves it). A
 * right-click marks a saved preset for deletion and a click then deletes it.
 * Which preset is active is `active`, derived from the live settings.
 */
export function KeystrokeSoundOptions({ preferences, setPreferences, active, apply }: KeystrokeSoundOptionsProps) {
  const [primedId, setPrimedId] = useState<string | null>(null)

  const save = () => {
    setPreferences((previous) => (
      !isUnsavedKeystrokeSoundShown(previous) || previous.saved.length >= MAX_SAVED_KEYSTROKE_SOUNDS
        ? previous
        : { ...previous, saved: [...previous.saved, { id: newKeystrokeSoundId(), settings: { ...previous.unsaved } }] }
    ))
  }
  const remove = (id: string) => {
    setPrimedId(null)
    // Deleting the preset in use keeps it in use: it becomes the unsaved preset.
    setPreferences((previous) => {
      const removed = previous.saved.find((stage) => stage.id === id)
      const saved = previous.saved.filter((stage) => stage.id !== id)
      const unsaved = removed && active.kind === 'saved' && active.id === id ? removed.settings : previous.unsaved
      return { ...previous, saved, unsaved }
    })
  }

  return (
    <div className="options-loadout-grid" role="group" aria-label="Keystroke sound presets">
      {FACTORY_KEYSTROKE_SOUNDS.map((stage) => (
        <button
          key={stage.id}
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn${active.kind === 'factory' && active.id === stage.id ? ' is-active' : ''}`}
          data-tooltip={stage.name}
          aria-label={`${stage.name} keystroke sounds`}
          onClick={() => apply(stage.settings)}
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
            data-tooltip={isPrimed ? `Click to delete Keystroke Sounds ${number}` : `Keystroke Sounds ${number}\nRight-click to mark for deletion, then click.`}
            aria-label={isPrimed ? `Delete Keystroke Sounds ${number}` : `Keystroke Sounds ${number}`}
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
      {isUnsavedKeystrokeSoundShown(preferences) ? (
        <UnsavedPresetButton
          active={active.kind === 'unsaved'}
          noun="preset"
          canSave={preferences.saved.length < MAX_SAVED_KEYSTROKE_SOUNDS}
          onSelect={() => apply(preferences.unsaved)}
          onSave={save}
        />
      ) : null}
    </div>
  )
}
