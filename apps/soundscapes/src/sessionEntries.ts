/**
 * What the native session's media controls step through, and how the page
 * follows them (MobileSoundscapeApp.tsx).
 *
 * The cycle is the desktop's (soundscapeCycle: every factory soundscape,
 * then the user's own). Unsaved changes are not a stop: the page is on no
 * entry then, and stepping goes to the first (or, backwards, the last).
 *
 * The page is current on an entry when its settings sound the same as it
 * (soundscapeSettingsSignature, which ignores solo).
 */
import { soundscapeConfiguration } from '@thockdown/soundscape/SoundscapeEngine'
import {
  cloneSettings,
  soundscapeCycle,
  soundscapeSettingsSignature,
  type SoundscapePreferences,
} from '@thockdown/soundscape/soundscape'
import type { SessionEntry, SessionState } from './backgroundAudioHost'

const UNSAVED_NAME = 'Unsaved soundscape'

export function sessionEntries(customPresets: SoundscapePreferences['customPresets']): SessionEntry[] {
  return soundscapeCycle({ customPresets }).map((preset) => ({
    id: preset.id,
    name: preset.name,
    configuration: JSON.stringify(soundscapeConfiguration(preset.settings)),
  }))
}

/** The soundscape (factory or the user's) the settings sound the same as, preferring the active one; null for none. */
export function currentEntryId(preferences: SoundscapePreferences): string | null {
  const signature = soundscapeSettingsSignature(preferences.settings)
  const matching = soundscapeCycle(preferences).filter((preset) => soundscapeSettingsSignature(preset.settings) === signature)
  return (matching.find((preset) => preset.id === preferences.activePresetId) ?? matching[0])?.id ?? null
}

/** The name of the soundscape the settings sound the same as, or the unsaved one's when they match none. */
export function currentSoundscapeName(preferences: SoundscapePreferences): string {
  const id = currentEntryId(preferences)
  return soundscapeCycle(preferences).find((preset) => preset.id === id)?.name ?? UNSAVED_NAME
}

/**
 * The preferences following the session: its soundscape, and the engine
 * playing exactly while regular mode is (what the schedule plays, the
 * session plays itself, with the engine closed). Solo is not carried
 * across: it is a way of listening, and the session plays the soundscape
 * whole.
 */
export function followSession(
  preferences: SoundscapePreferences,
  state: Pick<SessionState, 'regular' | 'currentId'>,
): SoundscapePreferences {
  let next = preferences
  if (state.currentId !== null && state.currentId !== currentEntryId(preferences)) {
    const preset = soundscapeCycle(preferences).find((candidate) => candidate.id === state.currentId)
    // Exactly the soundscape the session now plays, so the engine's next
    // configuration is the one already in force: not applySoundscapePreset,
    // which carries a soloed channel across, while the session switched
    // without it -- and the solo then arrived as a second change in the
    // middle of the schedule's crossfade.
    if (preset) next = { ...next, settings: cloneSettings(preset.settings), activePresetId: preset.id }
  }
  const enabled = state.regular === 'playing'
  return next.enabled === enabled ? next : { ...next, enabled }
}
