import {
  DEFAULT_KEYSTROKE_SOUND_PREFERENCES,
  sanitizeKeystrokeSoundPreferences,
} from './keystrokeSounds'
import {
  DEFAULT_SOUNDSTAGE_PREFERENCES,
  sanitizeSoundstagePreferences,
} from './soundstages'
import {
  DEFAULT_FLASH_SHAPE_PREFERENCES,
  sanitizeFlashShapePreferences,
} from './flashing'
import {
  DEFAULT_SOUNDSCAPE_PREFERENCES,
  sanitizeSoundscapePreferences,
} from '@thockdown/soundscape/soundscape'
import type { PersistedMenuState } from './appState'

export function resetMenuWithPreservedPresets(
  defaults: PersistedMenuState | undefined,
  current?: PersistedMenuState,
): PersistedMenuState {
  const defaultMenu = defaults ?? {
    sidebarMode: 'date',
    selectedMonths: [],
    selectedYears: [],
    searchQuery: '',
  }

  const defaultKeystrokePreferences = sanitizeKeystrokeSoundPreferences(
    defaultMenu.keystrokeSoundPresets ?? DEFAULT_KEYSTROKE_SOUND_PREFERENCES,
  )
  const currentKeystrokePreferences = sanitizeKeystrokeSoundPreferences(current?.keystrokeSoundPresets)
  const defaultSoundstagePreferences = sanitizeSoundstagePreferences(
    defaultMenu.musicSoundstages ?? DEFAULT_SOUNDSTAGE_PREFERENCES,
  )
  const currentSoundstagePreferences = sanitizeSoundstagePreferences(current?.musicSoundstages)
  const defaultSoundscapePreferences = sanitizeSoundscapePreferences(
    defaultMenu.soundscapes ?? DEFAULT_SOUNDSCAPE_PREFERENCES,
  )
  const currentSoundscapePreferences = sanitizeSoundscapePreferences(current?.soundscapes)
  const defaultFlashingPreferences = sanitizeFlashShapePreferences(
    defaultMenu.flashingPresets ?? DEFAULT_FLASH_SHAPE_PREFERENCES,
  )
  const currentFlashingPreferences = sanitizeFlashShapePreferences(current?.flashingPresets)

  // The reader's own presets are kept; the active entry and every edit of a factory preset return to as shipped.
  return {
    ...defaultMenu,
    keystrokeSoundPresets: {
      ...defaultKeystrokePreferences,
      custom: currentKeystrokePreferences.custom,
    },
    musicSoundstages: {
      ...defaultSoundstagePreferences,
      custom: currentSoundstagePreferences.custom,
    },
    soundscapes: {
      ...defaultSoundscapePreferences,
      customPresets: currentSoundscapePreferences.customPresets,
    },
    flashingPresets: {
      ...defaultFlashingPreferences,
      custom: currentFlashingPreferences.custom,
    },
  }
}
