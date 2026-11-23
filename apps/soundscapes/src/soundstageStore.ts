/** The phone's soundstage list (shared/soundstages.ts), kept in the WebView's localStorage like its other preferences. */
import {
  DEFAULT_SOUNDSTAGE_PREFERENCES,
  sanitizeSoundstagePreferences,
  type SoundstagePreferences,
} from '@thockdown/visualizer/shared/soundstages'

const STORAGE_KEY = 'thockdown:soundstages'

export function loadSoundstages(): SoundstagePreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? sanitizeSoundstagePreferences(JSON.parse(raw)) : DEFAULT_SOUNDSTAGE_PREFERENCES
  } catch {
    return DEFAULT_SOUNDSTAGE_PREFERENCES
  }
}

export function saveSoundstages(preferences: SoundstagePreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Storage refused: the stages last until the app closes.
  }
}
