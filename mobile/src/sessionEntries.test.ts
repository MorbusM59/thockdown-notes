import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SOUNDSCAPE_PREFERENCES,
  SOUNDSCAPE_FACTORY_PRESETS,
  applySoundscapePreset,
  type SoundscapePreferences,
} from '../../src/shared/soundscape'
import { UNSAVED_ENTRY_ID, currentEntryId, followSession, nextScratch, sessionEntries } from './sessionEntries'

const onPreset = (index: number): SoundscapePreferences => applySoundscapePreset(DEFAULT_SOUNDSCAPE_PREFERENCES, SOUNDSCAPE_FACTORY_PRESETS[index])

/** `preferences` with one setting changed, so they match no soundscape. */
function edited(preferences: SoundscapePreferences): SoundscapePreferences {
  return { ...preferences, activePresetId: null, settings: { ...preferences.settings, volume: preferences.settings.volume * 0.5 } }
}

describe('media-control cycle', () => {
  it('adds one stop for unsaved changes, and steps back to them unchanged', () => {
    const changed = edited(onPreset(0))
    const scratch = nextScratch(changed, null)
    expect(currentEntryId(changed, scratch)).toBe(UNSAVED_ENTRY_ID)
    expect(sessionEntries(changed.customPresets, scratch).map((entry) => entry.id))
      .toEqual([...SOUNDSCAPE_FACTORY_PRESETS.map((preset) => preset.id), UNSAVED_ENTRY_ID])

    // A media control steps to another soundscape: the scratch survives it ...
    const away = followSession(changed, scratch, { playing: true, currentId: SOUNDSCAPE_FACTORY_PRESETS[1].id })
    const kept = nextScratch(away, scratch)
    expect(kept).toEqual(scratch)
    expect(currentEntryId(away, kept)).toBe(SOUNDSCAPE_FACTORY_PRESETS[1].id)
    // ... and stepping back restores exactly the changes.
    const back = followSession(away, kept, { playing: true, currentId: UNSAVED_ENTRY_ID })
    expect(back.settings).toEqual(changed.settings)
    expect(currentEntryId(back, nextScratch(back, kept))).toBe(UNSAVED_ENTRY_ID)
  })

  it('drops the stop once the changes are saved', () => {
    const changed = edited(onPreset(0))
    const scratch = nextScratch(changed, null)
    const saved: SoundscapePreferences = {
      ...changed,
      customPresets: [{ id: 'mine', name: 'Mine', settings: changed.settings }],
      activePresetId: 'mine',
    }
    expect(nextScratch(saved, scratch)).toBeNull()
    expect(sessionEntries(saved.customPresets, null).map((entry) => entry.id)).toEqual(['mine'])
  })

  it('follows play and pause without touching the settings', () => {
    const playing = onPreset(2)
    const paused = followSession(playing, null, { playing: false, currentId: SOUNDSCAPE_FACTORY_PRESETS[2].id })
    expect(paused.enabled).toBe(false)
    expect(paused.settings).toBe(playing.settings)
  })
})
