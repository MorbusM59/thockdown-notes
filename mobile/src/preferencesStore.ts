/**
 * The phone's soundscape preferences, kept in the WebView's localStorage.
 * Everything read back goes through the same sanitizer the desktop app uses
 * on its own saved state, so a value from an older build cannot reach the
 * engine out of range.
 */
import {
  DEFAULT_SOUNDSCAPE_PREFERENCES,
  sanitizeSoundscapePreferences,
  type SoundscapePreferences,
} from '../../src/shared/soundscape'

const STORAGE_KEY = 'thockdown:soundscape-preferences'

export function loadPreferences(): SoundscapePreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_SOUNDSCAPE_PREFERENCES
    return sanitizeSoundscapePreferences(JSON.parse(raw))
  } catch {
    return DEFAULT_SOUNDSCAPE_PREFERENCES
  }
}

export function savePreferences(preferences: SoundscapePreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  } catch (error) {
    console.error('Failed to save soundscape preferences', error)
  }
}

/**
 * Which of the desktop's factory visual presets the phone shows: light or
 * dark, and the chosen preset in each, so switching modes returns to the
 * preset last used in that mode, as the desktop does.
 */
export interface MobileLook {
  mode: 'light' | 'dark'
  /** Index into LIGHT_FACTORY_PRESETS / DARK_FACTORY_PRESETS. */
  preset: { light: number; dark: number }
}

const LOOK_STORAGE_KEY = 'thockdown:look'
const PRESET_COUNT = 5
/** Paper, light. */
export const DEFAULT_LOOK: MobileLook = { mode: 'light', preset: { light: 3, dark: 0 } }

function presetIndex(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < PRESET_COUNT ? value : fallback
}

export function loadLook(): MobileLook {
  try {
    const raw = localStorage.getItem(LOOK_STORAGE_KEY)
    if (raw === null) return DEFAULT_LOOK
    const parsed = JSON.parse(raw) as Partial<MobileLook> | null
    return {
      mode: parsed?.mode === 'dark' ? 'dark' : 'light',
      preset: {
        light: presetIndex(parsed?.preset?.light, DEFAULT_LOOK.preset.light),
        dark: presetIndex(parsed?.preset?.dark, DEFAULT_LOOK.preset.dark),
      },
    }
  } catch {
    return DEFAULT_LOOK
  }
}

export function saveLook(look: MobileLook): void {
  try {
    localStorage.setItem(LOOK_STORAGE_KEY, JSON.stringify(look))
  } catch (error) {
    console.error('Failed to save the look', error)
  }
}
