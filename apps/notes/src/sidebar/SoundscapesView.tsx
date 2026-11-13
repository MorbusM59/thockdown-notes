import type { ComponentProps } from 'react'
import { SoundscapeView } from '@thockdown/soundscape/SoundscapeOptions'
import { moveSoundscapePreset } from '@thockdown/soundscape/soundscape'
import { SelectorRows } from './SelectorRows'
import { useSelectorReorder } from './useSelectorReorder'

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
