import { type ComponentProps, useEffect, useRef, useSyncExternalStore } from 'react'
import { DockEntryRow } from '@thockdown/interaction/DockEntryRow'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { SoundscapeMark, SoundscapeView } from '@thockdown/soundscape/SoundscapeOptions'
import {
  activeSoundscape,
  deleteSoundscape,
  editSoundscape,
  isFactorySoundscape,
  moveSoundscapePreset,
  renameSoundscape,
  restoreFactorySoundscape,
  setSoundscapeIcon,
  soundscapePresets,
  type SoundscapePreferences,
} from '@thockdown/soundscape/soundscape'
import { neutralSoundscape } from '@thockdown/soundscape/soundscapeFile'
import { SelectorRows } from './SelectorRows'
import { useSelectorReorder } from './useSelectorReorder'
import { IconPicker } from './iconPicker/IconPicker'
import { closeIconPick, isPickingIconFor, readIconPick, subscribeIconPick, toggleIconPick } from './iconPicker/iconPick'

/**
 * The sidebar's Soundscapes view: the package's view, its presets shown in a
 * window of whole rows (SelectorRows) and reordered by dragging
 * (useSelectorReorder), which sets `presetOrder`.
 */
export function SoundscapesView({ preferences, onChange, filter }: Pick<ComponentProps<typeof SoundscapeView>, 'preferences' | 'onChange' | 'filter'>) {
  const reorder = useSelectorReorder('soundscape', (dragged, target) => onChange(moveSoundscapePreset(preferences, dragged, target)))
  return (
    <SoundscapeView
      preferences={preferences}
      onChange={onChange}
      filter={filter}
      framePresets={(grid) => <SelectorRows>{grid}</SelectorRows>}
      presetReorder={reorder}
    />
  )
}

interface SoundscapeHostProps {
  preferences: SoundscapePreferences
  onChange: (preferences: SoundscapePreferences) => void
}

/** The icon picker for the soundscape that plays (iconPicker/iconPick.ts). */
export function SoundscapeIconPicker({ preferences, onChange, query }: SoundscapeHostProps & { query: string }) {
  const pick = useSyncExternalStore(subscribeIconPick, readIconPick)
  const id = pick?.target.kind === 'soundscape' ? pick.target.id : null
  const preset = soundscapePresets(preferences).find((candidate) => candidate.id === id)
  if (!preset) return null
  return (
    <IconPicker
      label={preset.name}
      current={preset.icon}
      query={query}
      onPick={(icon) => {
        closeIconPick()
        onChange(setSoundscapeIcon(preferences, preset.id, icon))
      }}
    />
  )
}

/**
 * The Soundscapes view's dock, the music library's in shape: the soundscape
 * that plays, its mark (the icon picker) and name, then resetting it (every
 * channel off at its defaults, the environment at its defaults, as an edit
 * of the soundscape like any other), and a hold that trashes one of the
 * listener's own or restores a factory one as shipped.
 */
export function SoundscapeDock({ preferences, onChange }: SoundscapeHostProps) {
  const pick = useSyncExternalStore(subscribeIconPick, readIconPick)
  const preset = activeSoundscape(preferences)
  const factory = isFactorySoundscape(preset.id)
  // A factory soundscape as shipped has nothing to restore.
  const unchanged = factory && !preferences.factoryEdits.some((edit) => edit.id === preset.id)
  const cancelHoldRef = useRef<(() => void) | null>(null)
  const cancelHold = () => {
    cancelHoldRef.current?.()
    cancelHoldRef.current = null
  }
  useEffect(() => cancelHold, [])
  const target = { kind: 'soundscape', id: preset.id } as const
  return (
    <div className="options-curve-rows options-dock-rows">
      <DockEntryRow
        className="preset-dock-row"
        name={preset.name}
        takenNames={soundscapePresets(preferences).filter((other) => other.id !== preset.id).map((other) => other.name)}
        onRename={(name) => onChange(renameSoundscape(preferences, preset.id, name))}
        mark={<SoundscapeMark preset={preset} />}
        picking={isPickingIconFor(pick, target)}
        onTogglePicker={() => toggleIconPick(target)}
        onResetMark={() => onChange(setSoundscapeIcon(preferences, preset.id, null))}
      >
        <button
          type="button"
          className="options-curve-cell options-curve-button"
          data-tooltip={`Reset ${preset.name}: every channel off at its defaults, the environment at its defaults`}
          aria-label={`Reset ${preset.name}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onChange(editSoundscape(preferences, neutralSoundscape()))}
        >
          <span className="fa-solid fa-rotate-left" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="options-curve-cell options-curve-button"
          data-tooltip={factory ? `Hold to restore ${preset.name} as shipped` : `Hold to trash ${preset.name}`}
          aria-label={factory ? `Restore ${preset.name} as shipped` : `Trash ${preset.name}`}
          data-secondary-press="none"
          disabled={unchanged}
          onPointerDown={(event) => {
            event.stopPropagation()
            if (event.button !== 0) return
            cancelHold()
            cancelHoldRef.current = armHold(() => {
              cancelHoldRef.current = null
              onChange(factory ? restoreFactorySoundscape(preferences, preset.id) : deleteSoundscape(preferences, preset.id))
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
