/**
 * What the native session's media controls step through, and how the page
 * follows them (MobileSoundscapeApp.tsx).
 *
 * The cycle is the desktop's (soundscapeCycle: the user's own soundscapes
 * if there are any, otherwise the factory ones), plus ONE stop for unsaved
 * changes: the settings as they were last left when they matched no
 * soundscape (the SCRATCH). Stepping away from unsaved changes therefore
 * loses nothing -- stepping round comes back to them -- and saving them
 * removes the stop, since they are then a soundscape of the cycle.
 *
 * The page is current on an entry when its settings sound the same as it
 * (soundscapeSettingsSignature, which ignores solo).
 */
import { soundscapeConfiguration } from '../../../src/sound/SoundscapeEngine'
import {
  SOUNDSCAPE_FACTORY_PRESETS,
  cloneSettings,
  soundscapeCycle,
  soundscapeSettingsSignature,
  type SoundscapePreferences,
  type SoundscapeSettings,
} from '../../../src/shared/soundscape'
import type { SessionEntry, SessionState } from './backgroundAudioHost'

export const UNSAVED_ENTRY_ID = 'unsaved'
const UNSAVED_NAME = 'Unsaved soundscape'

function matchesAnyPreset(preferences: SoundscapePreferences, settings: SoundscapeSettings): boolean {
  const signature = soundscapeSettingsSignature(settings)
  return [...SOUNDSCAPE_FACTORY_PRESETS, ...preferences.customPresets]
    .some((preset) => soundscapeSettingsSignature(preset.settings) === signature)
}

/** The scratch after `preferences` changed: their settings if they match no soundscape, otherwise the scratch kept (or dropped, once it is one). */
export function nextScratch(preferences: SoundscapePreferences, scratch: SoundscapeSettings | null): SoundscapeSettings | null {
  if (!matchesAnyPreset(preferences, preferences.settings)) return cloneSettings(preferences.settings)
  return scratch && !matchesAnyPreset(preferences, scratch) ? scratch : null
}

export function sessionEntries(customPresets: SoundscapePreferences['customPresets'], scratch: SoundscapeSettings | null): SessionEntry[] {
  const entries = soundscapeCycle({ customPresets }).map((preset) => ({
    id: preset.id,
    name: preset.name,
    configuration: JSON.stringify(soundscapeConfiguration(preset.settings)),
  }))
  if (scratch) {
    entries.push({ id: UNSAVED_ENTRY_ID, name: UNSAVED_NAME, configuration: JSON.stringify(soundscapeConfiguration(scratch)) })
  }
  return entries
}

/** The entry the page is on, or null when it is on none of them (a soundscape outside the cycle). */
export function currentEntryId(preferences: SoundscapePreferences, scratch: SoundscapeSettings | null): string | null {
  const signature = soundscapeSettingsSignature(preferences.settings)
  const cycle = soundscapeCycle(preferences)
  const matching = cycle.filter((preset) => soundscapeSettingsSignature(preset.settings) === signature)
  const current = matching.find((preset) => preset.id === preferences.activePresetId) ?? matching[0]
  if (current) return current.id
  if (scratch && soundscapeSettingsSignature(scratch) === signature) return UNSAVED_ENTRY_ID
  return null
}

/** The soundscape (factory or the user's) the settings sound the same as, preferring the active one; null for none. */
export function matchingPresetId(preferences: SoundscapePreferences): string | null {
  const signature = soundscapeSettingsSignature(preferences.settings)
  const matching = [...SOUNDSCAPE_FACTORY_PRESETS, ...preferences.customPresets]
    .filter((preset) => soundscapeSettingsSignature(preset.settings) === signature)
  return (matching.find((preset) => preset.id === preferences.activePresetId) ?? matching[0])?.id ?? null
}

/**
 * The preferences following the session: its soundscape, and the engine
 * playing exactly while regular mode is (what the schedule plays, the
 * session plays itself, with the engine closed). The schedule may name a
 * soundscape outside the cycle, so any soundscape is looked up. Solo is not
 * carried across: it is a way of listening, and the session plays the
 * soundscape whole.
 */
export function followSession(
  preferences: SoundscapePreferences,
  scratch: SoundscapeSettings | null,
  state: Pick<SessionState, 'regular' | 'currentId'>,
): SoundscapePreferences {
  let next = preferences
  if (state.currentId !== null && state.currentId !== currentEntryId(preferences, scratch) && state.currentId !== matchingPresetId(preferences)) {
    const preset = [...SOUNDSCAPE_FACTORY_PRESETS, ...preferences.customPresets].find((candidate) => candidate.id === state.currentId)
    // Exactly the soundscape the session now plays, so the engine's next
    // configuration is the one already in force: not applySoundscapePreset,
    // which carries a soloed channel across, while the session switched
    // without it -- and the solo then arrived as a second change in the
    // middle of the schedule's crossfade.
    if (preset) next = { ...next, settings: cloneSettings(preset.settings), activePresetId: preset.id }
    else if (state.currentId === UNSAVED_ENTRY_ID && scratch) next = { ...next, settings: cloneSettings(scratch), activePresetId: null }
  }
  const enabled = state.regular === 'playing'
  return next.enabled === enabled ? next : { ...next, enabled }
}
