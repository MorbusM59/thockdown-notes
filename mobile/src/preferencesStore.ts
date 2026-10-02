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
