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
import { soundscapeConfiguration } from '../../src/sound/SoundscapeEngine'
import {
  SOUNDSCAPE_FACTORY_PRESETS,
  applySoundscapePreset,
  cloneSettings,
  soundscapeCycle,
  soundscapeSettingsSignature,
  type SoundscapePreferences,
  type SoundscapeSettings,
} from '../../src/shared/soundscape'
import type { SessionEntry } from './backgroundAudioHost'

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

/** The preferences on entry `id`, playing or not: what the page does when a media control moved the session. */
export function followSession(
  preferences: SoundscapePreferences,
  scratch: SoundscapeSettings | null,
  state: { playing: boolean; currentId: string | null },
): SoundscapePreferences {
  let next = preferences
  if (state.currentId !== null && state.currentId !== currentEntryId(preferences, scratch)) {
    const preset = soundscapeCycle(preferences).find((candidate) => candidate.id === state.currentId)
    if (preset) next = applySoundscapePreset(next, preset)
    else if (state.currentId === UNSAVED_ENTRY_ID && scratch) next = { ...next, settings: cloneSettings(scratch), activePresetId: null }
  }
  return next.enabled === state.playing ? next : { ...next, enabled: state.playing }
}
