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

  // Saved presets are user-created libraries; live and unsaved settings return to factory values.
  return {
    ...defaultMenu,
    keystrokeSoundPresets: {
      ...defaultKeystrokePreferences,
      saved: currentKeystrokePreferences.saved,
    },
    musicSoundstages: {
      ...defaultSoundstagePreferences,
      saved: currentSoundstagePreferences.saved,
    },
    soundscapes: {
      ...defaultSoundscapePreferences,
      customPresets: currentSoundscapePreferences.customPresets,
    },
    flashingPresets: {
      ...defaultFlashingPreferences,
      saved: currentFlashingPreferences.saved,
    },
  }
}
