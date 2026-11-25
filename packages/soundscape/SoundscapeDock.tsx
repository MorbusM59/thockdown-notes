import { type ReactNode, useEffect, useRef } from 'react'
import { DockEntryRow } from '@thockdown/interaction/DockEntryRow'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { SoundscapeMark } from './SoundscapeOptions'
import {
  activeSoundscape,
  deleteSoundscape,
  editSoundscape,
  isFactorySoundscape,
  renameSoundscape,
  restoreFactorySoundscape,
  setSoundscapeIcon,
  soundscapePresets,
  type SoundscapePreferences,
} from './soundscape'
import { neutralSoundscape } from './soundscapeFile'

export interface SoundscapeDockProps {
  preferences: SoundscapePreferences
  onChange: (preferences: SoundscapePreferences) => void
  /** Whether the host's icon picker is open for the soundscape that plays. */
  picking: boolean
  onTogglePicker: () => void
  /** A line under the name (the phone's time left), or nothing. */
  detail?: ReactNode
  /** A cell after the dock's own actions (the phone's help button), or nothing. */
  trailing?: ReactNode
}

/**
 * The soundscape dock, the music library's in shape: the soundscape
 * that plays, its mark (the icon picker) and name, then resetting it (every
 * channel off at its defaults, the environment at its defaults, as an edit
 * of the soundscape like any other), and a hold that trashes one of the
 * listener's own or restores a factory one as shipped. Shared by the
 * desktop's Soundscapes view and the phone, so the two cannot drift; the
 * icon picker it opens is the host's to show (`picking`, `onTogglePicker`).
 *
 * Every gesture here is a press or a still hold, so a finger needs nothing
 * of its own: `armHold` abandons a hold that leaves the grace radius, and a
 * pan the browser takes cancels the pointer.
 */
export function SoundscapeDock({ preferences, onChange, picking, onTogglePicker, detail, trailing }: SoundscapeDockProps) {
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
  return (
    <div className="options-curve-rows options-dock-rows">
      <DockEntryRow
        className="preset-dock-row"
        name={preset.name}
        takenNames={soundscapePresets(preferences).filter((other) => other.id !== preset.id).map((other) => other.name)}
        onRename={(name) => onChange(renameSoundscape(preferences, preset.id, name))}
        mark={{
          node: <SoundscapeMark preset={preset} />,
          picking: picking,
          onTogglePicker: onTogglePicker,
          onResetMark: () => onChange(setSoundscapeIcon(preferences, preset.id, null)),
        }}
        detail={detail}
      >
        <button
          type="button"
          className="options-curve-cell options-curve-button"
          data-tooltip={`Reset ${preset.name}`}
          aria-label={`Reset ${preset.name}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onChange(editSoundscape(preferences, neutralSoundscape()))}
        >
          <span className="fa-solid fa-circle-notch" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="options-curve-cell options-curve-button"
          data-tooltip={factory ? `Restore ${preset.name}` : `Trash ${preset.name}`}
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
          <span className={`fa-solid ${factory ? 'fa-rotate-left' : 'fa-trash-can'}`} aria-hidden="true" />
        </button>
        {trailing}
      </DockEntryRow>
    </div>
  )
}
