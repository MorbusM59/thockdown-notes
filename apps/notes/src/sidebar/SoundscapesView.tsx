import { type ComponentProps, useSyncExternalStore } from 'react'
import { SoundscapeDock as SharedSoundscapeDock } from '@thockdown/soundscape/SoundscapeDock'
import { SoundscapeView } from '@thockdown/soundscape/SoundscapeOptions'
import {
  activeSoundscape,
  moveSoundscapePreset,
  setSoundscapeIcon,
  soundscapePresets,
  type SoundscapePreferences,
} from '@thockdown/soundscape/soundscape'
import { SelectorRows } from './SelectorRows'
import { useSelectorReorder } from '@thockdown/interaction/useSelectorReorder'
import { IconPicker } from '@thockdown/interaction/iconPicker/IconPicker'
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
 * The Soundscapes view's dock (the package's SoundscapeDock), its icon
 * picker opened through the sidebar's one picker store (iconPick.ts).
 */
export function SoundscapeDock({ preferences, onChange }: SoundscapeHostProps) {
  const pick = useSyncExternalStore(subscribeIconPick, readIconPick)
  const target = { kind: 'soundscape', id: activeSoundscape(preferences).id } as const
  return (
    <SharedSoundscapeDock
      preferences={preferences}
      onChange={onChange}
      picking={isPickingIconFor(pick, target)}
      onTogglePicker={() => toggleIconPick(target)}
    />
  )
}
