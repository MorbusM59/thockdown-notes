import { useState } from 'react'

import { OptionsSubsectionLabel } from '@thockdown/interaction/OptionsSubsectionLabel'

import {
  CUSTOM_SOUNDSTAGE_ICON,
  FACTORY_SOUNDSTAGES,
  MAX_SAVED_SOUNDSTAGES,
  NEUTRAL_SOUNDSTAGE,
  type ActiveSoundstage,
  type FactorySoundstageId,
  type SoundstagePreferences,
  type SoundstageSettings,
} from '../shared/soundstages'


interface SoundstageOptionsProps {
  preferences: SoundstagePreferences
  setPreferences: (update: (previous: SoundstagePreferences) => SoundstagePreferences) => void
  live: SoundstageSettings
  active: ActiveSoundstage
  apply: (settings: SoundstageSettings) => void
  selectFactory: (id: FactorySoundstageId) => void
}

function newSoundstageId(): string {
  return `stage-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * The stage bar (the five factory soundstages and the custom one) and the
 * Custom Soundstages subsection, laid out and operated like the layout bar
 * and Custom Layouts: a right-click marks a saved stage for deletion and a
 * click then deletes it; reset asks for a second click. Nothing here stores
 * which stage is active: it is `active`, derived from the live settings.
 */
export function SoundstageOptions({ preferences, setPreferences, live, active, apply, selectFactory }: SoundstageOptionsProps) {
  const [primedId, setPrimedId] = useState<string | null>(null)
  const [resetPrimed, setResetPrimed] = useState(false)
  const isUnsaved = active.kind === 'custom'
  const canSave = isUnsaved && preferences.saved.length < MAX_SAVED_SOUNDSTAGES

  const save = () => {
    if (!canSave) return
    setPreferences((previous) => ({ ...previous, saved: [...previous.saved, { id: newSoundstageId(), settings: { ...live } }] }))
  }
  const remove = (id: string) => {
    setPrimedId(null)
    setPreferences((previous) => ({ ...previous, saved: previous.saved.filter((stage) => stage.id !== id) }))
  }
  const reset = () => {
    if (!resetPrimed) {
      setResetPrimed(true)
      return
    }
    setResetPrimed(false)
    setPreferences((previous) => ({ ...previous, custom: { ...NEUTRAL_SOUNDSTAGE } }))
    apply(NEUTRAL_SOUNDSTAGE)
  }

  return (
    <>
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
        <button
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn${active.kind !== 'factory' ? ' is-active' : ''}`}
          data-tooltip="Custom"
          aria-label="Custom soundstage"
          onClick={() => apply(preferences.custom)}
        >
          <span className={CUSTOM_SOUNDSTAGE_ICON} aria-hidden="true" />
        </button>
      </div>

      <OptionsSubsectionLabel>Custom Soundstages</OptionsSubsectionLabel>
      <div className="options-loadout-grid" role="group" aria-label="Custom soundstages">
        {preferences.saved.map((stage, index) => {
          const number = index + 1
          const isPrimed = primedId === stage.id
          return (
            <button
              key={stage.id}
              type="button"
              className={`btn-icon options-color-swatch options-loadout-btn${active.kind === 'saved' && active.id === stage.id ? ' is-active' : ''}${isPrimed ? ' primed' : ''}`}
              data-tooltip={isPrimed ? `Click to delete Custom Soundstage ${number}` : `Custom Soundstage ${number}\nRight-click to mark for deletion, then click.`}
              aria-label={isPrimed ? `Delete Custom Soundstage ${number}` : `Custom Soundstage ${number}`}
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
        <button
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn options-loadout-plus${isUnsaved ? ' is-active' : ''}`}
          data-tooltip={preferences.saved.length >= MAX_SAVED_SOUNDSTAGES
            ? 'Custom soundstage limit reached'
            : isUnsaved ? 'Save the current settings as a custom soundstage' : 'No unsaved soundstage changes'}
          aria-label="Save the current settings as a custom soundstage"
          aria-disabled={!canSave}
          onClick={save}
        >
          <span className="options-loadout-plus-glyph fa-solid fa-plus" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn${resetPrimed ? ' primed' : ''}`}
          data-tooltip={resetPrimed ? 'Click again to reset the custom soundstage to neutral' : 'Reset the custom soundstage to neutral'}
          aria-label={resetPrimed ? 'Confirm reset of the custom soundstage' : 'Reset the custom soundstage to neutral'}
          onClick={reset}
          onMouseLeave={() => setResetPrimed(false)}
          data-secondary-press="none"
          onContextMenu={(event) => event.preventDefault()}
        >
          <span className="fa-solid fa-rotate-left" aria-hidden="true" />
        </button>
      </div>
    </>
  )
}
