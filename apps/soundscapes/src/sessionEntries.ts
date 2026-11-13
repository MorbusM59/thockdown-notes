/**
 * What the native session's media controls step through, and how the page
 * follows them (MobileSoundscapeApp.tsx).
 *
 * The cycle is the desktop's (soundscapeCycle: every factory soundscape,
 * then the user's own). The page is always on an entry: the soundscape
 * that plays (`activePresetId`), whose edits are written to it.
 */
import { soundscapeConfiguration } from '@thockdown/soundscape/SoundscapeEngine'
import {
  activeSoundscape,
  cloneSettings,
  soundscapeCycle,
  type SoundscapePreferences,
  type SoundscapePreset,
} from '@thockdown/soundscape/soundscape'
import type { SessionEntry, SessionState } from './backgroundAudioHost'

export function sessionEntries(presets: readonly SoundscapePreset[]): SessionEntry[] {
  return presets.map((preset) => ({
    id: preset.id,
    name: preset.name,
    configuration: JSON.stringify(soundscapeConfiguration(preset.settings)),
  }))
}

/** The entry the page is on: the soundscape that plays. */
export function currentEntryId(preferences: SoundscapePreferences): string {
  return activeSoundscape(preferences).id
}

/** The name of the soundscape that plays. */
export function currentSoundscapeName(preferences: SoundscapePreferences): string {
  return activeSoundscape(preferences).name
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
