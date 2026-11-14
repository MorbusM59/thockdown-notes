import { useEffect, useRef, useSyncExternalStore } from 'react'

import { DockEntryRow } from '@thockdown/interaction/DockEntryRow'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { PresetMark } from '@thockdown/interaction/PresetMark'
import {
  createPreset,
  defaultPresetIcon,
  deletePreset,
  editActivePreset,
  isEditedFactoryPreset,
  isFactoryPreset,
  newPresetId,
  presetsOf,
  renamePreset,
  restoreFactoryPreset,
  selectPreset,
  setPresetIcon,
} from '@thockdown/interaction/presetList'

import {
  activeSoundstage,
  NEUTRAL_SOUNDSTAGE,
  SOUNDSTAGE_KIND,
  type SoundstagePreferences,
} from '../shared/soundstages'
import { IconPicker } from './iconPicker/IconPicker'
import { closeIconPick, isPickingIconFor, readIconPick, subscribeIconPick, toggleIconPick } from './iconPicker/iconPick'

interface SoundstageHostProps {
  preferences: SoundstagePreferences
  /** Every change to the list; App plays the active stage when it changed. */
  onChange: (preferences: SoundstagePreferences) => void
}

/**
 * Soundstages' Presets: the factory stages (as the reader left them), the
 * reader's own, then the plus, which makes a copy of the stage playing.
 * Renaming, icons, resetting and trashing are the dock's (SoundstageDock).
 */
export function SoundstageOptions({ preferences, onChange }: SoundstageHostProps) {
  const canCreate = preferences.custom.length < SOUNDSTAGE_KIND.maxCustom
  return (
    <div className="options-loadout-grid" role="group" aria-label="Soundstages">
      {presetsOf(SOUNDSTAGE_KIND, preferences).map((stage) => (
        <button
          key={stage.id}
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn${preferences.activeId === stage.id ? ' is-active' : ''}`}
          data-tooltip={stage.name}
          aria-label={stage.name}
          aria-pressed={preferences.activeId === stage.id}
          onClick={() => onChange({ ...preferences, ...selectPreset(SOUNDSTAGE_KIND, preferences, stage.id) })}
        >
          <PresetMark preset={stage} />
        </button>
      ))}
      <button
        type="button"
        className="btn-icon options-color-swatch options-loadout-btn options-loadout-plus"
        aria-label="Create a soundstage"
        data-tooltip={canCreate ? 'Create a soundstage\nA copy of the one playing.' : 'No room for another soundstage.'}
        disabled={!canCreate}
        onClick={() => {
          const created = createPreset(SOUNDSTAGE_KIND, preferences, newPresetId('stage'))
          if (created) onChange({ ...preferences, ...created })
        }}
      >
        <span className="options-loadout-plus-glyph fa-solid fa-plus" aria-hidden="true" />
      </button>
    </div>
  )
}

/** The icon picker for the soundstage playing (iconPicker/iconPick.ts). */
export function SoundstageIconPicker({ preferences, onChange, query }: SoundstageHostProps & { query: string }) {
  const pick = useSyncExternalStore(subscribeIconPick, readIconPick)
  const id = pick?.target.kind === 'soundstage' ? pick.target.id : null
  const stage = presetsOf(SOUNDSTAGE_KIND, preferences).find((candidate) => candidate.id === id)
  if (!stage) return null
  return (
    <IconPicker
      label={stage.name}
      current={stage.icon}
      query={query}
      onPick={(icon) => {
        closeIconPick()
        onChange({ ...preferences, ...setPresetIcon(SOUNDSTAGE_KIND, preferences, stage.id, icon) })
      }}
    />
  )
}

/**
 * Soundstages' dock, the soundscapes' in shape: the stage playing, its mark
 * (the icon picker) and name, then resetting it (the EQ flat and the room at
 * its defaults, as an edit like any other), and a hold that trashes one of
 * the reader's own or restores a factory one as shipped.
 */
export function SoundstageDock({ preferences, onChange }: SoundstageHostProps) {
  const pick = useSyncExternalStore(subscribeIconPick, readIconPick)
  const stage = activeSoundstage(preferences)
  const factory = isFactoryPreset(SOUNDSTAGE_KIND, stage.id)
  const unchanged = factory && !isEditedFactoryPreset(preferences, stage.id)
  const cancelHoldRef = useRef<(() => void) | null>(null)
  const cancelHold = () => {
    cancelHoldRef.current?.()
    cancelHoldRef.current = null
  }
  useEffect(() => cancelHold, [])
  const target = { kind: 'soundstage', id: stage.id } as const
  const change = (list: Partial<SoundstagePreferences>) => onChange({ ...preferences, ...list })
  return (
    <div className="options-curve-rows options-dock-rows">
      <DockEntryRow
        className="preset-dock-row"
        name={stage.name}
        takenNames={presetsOf(SOUNDSTAGE_KIND, preferences).filter((other) => other.id !== stage.id).map((other) => other.name)}
        onRename={(name) => change(renamePreset(SOUNDSTAGE_KIND, preferences, stage.id, name))}
        mark={<PresetMark preset={stage} />}
        picking={isPickingIconFor(pick, target)}
        onTogglePicker={() => toggleIconPick(target)}
        onResetMark={() => change(setPresetIcon(SOUNDSTAGE_KIND, preferences, stage.id, defaultPresetIcon(SOUNDSTAGE_KIND, stage.id)))}
      >
        <button
          type="button"
          className="options-curve-cell options-curve-button"
          data-tooltip={`Reset ${stage.name}: the EQ flat, the room and width at their defaults`}
          aria-label={`Reset ${stage.name}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => change(editActivePreset(SOUNDSTAGE_KIND, preferences, NEUTRAL_SOUNDSTAGE))}
        >
          <span className="fa-solid fa-rotate-left" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="options-curve-cell options-curve-button"
          data-tooltip={factory ? `Hold to restore ${stage.name} as shipped` : `Hold to trash ${stage.name}`}
          aria-label={factory ? `Restore ${stage.name} as shipped` : `Trash ${stage.name}`}
          data-secondary-press="none"
          disabled={unchanged}
          onPointerDown={(event) => {
            event.stopPropagation()
            if (event.button !== 0) return
            cancelHold()
            cancelHoldRef.current = armHold(() => {
              cancelHoldRef.current = null
              change(factory ? restoreFactoryPreset(preferences, stage.id) : deletePreset(SOUNDSTAGE_KIND, preferences, stage.id))
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
          <span className={`fa-solid ${factory ? 'fa-clock-rotate-left' : 'fa-trash-can'}`} aria-hidden="true" />
        </button>
      </DockEntryRow>
    </div>
  )
}
