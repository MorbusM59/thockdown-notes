import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SOUNDSCAPE_PREFERENCES,
  SOUNDSCAPE_FACTORY_PRESETS,
  applySoundscapePreset,
  type SoundscapePreferences,
} from '@thockdown/soundscape/soundscape'
import { UNSAVED_ENTRY_ID, currentEntryId, currentSoundscapeName, followSession, nextScratch, sessionEntries } from './sessionEntries'

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
    const away = followSession(changed, scratch, { regular: 'playing', currentId: SOUNDSCAPE_FACTORY_PRESETS[1].id })
    const kept = nextScratch(away, scratch)
    expect(kept).toEqual(scratch)
    expect(currentEntryId(away, kept)).toBe(SOUNDSCAPE_FACTORY_PRESETS[1].id)
    // ... and stepping back restores exactly the changes.
    const back = followSession(away, kept, { regular: 'playing', currentId: UNSAVED_ENTRY_ID })
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
    const paused = followSession(playing, null, { regular: 'paused', currentId: SOUNDSCAPE_FACTORY_PRESETS[2].id })
    expect(paused.enabled).toBe(false)
    expect(paused.settings).toBe(playing.settings)
  })
  it('follows the session to exactly the soundscape it plays, a soloed channel included', () => {
    const playing = onPreset(0)
    const soloed = { ...playing, settings: { ...playing.settings, channels: playing.settings.channels.map((channel, index) => ({ ...channel, solo: index === 0 })) } }
    const target = SOUNDSCAPE_FACTORY_PRESETS[1]
    const followed = followSession(soloed, null, { regular: 'playing', currentId: target.id })
    expect(followed.settings).toEqual(target.settings)
    expect(followed.settings.channels.some((channel) => channel.solo)).toBe(false)
  })
});

describe('the name the notification shows', () => {
  it('names a factory soundscape even when the user has their own, which leaves it out of the cycle', () => {
    const custom = { id: 'mine', name: 'Custom soundscape 1', settings: edited(onPreset(0)).settings }
    const temple = { ...onPreset(SOUNDSCAPE_FACTORY_PRESETS.length - 1), customPresets: [custom] }
    expect(currentEntryId(temple, null)).toBeNull()
    expect(currentSoundscapeName(temple, null)).toBe(SOUNDSCAPE_FACTORY_PRESETS[SOUNDSCAPE_FACTORY_PRESETS.length - 1].name)
    expect(currentSoundscapeName({ ...temple, activePresetId: 'mine', settings: custom.settings }, null)).toBe('Custom soundscape 1')
  })

  it('names unsaved changes, and nothing when the settings match nothing at all', () => {
    const changed = edited(onPreset(0))
    expect(currentSoundscapeName(changed, nextScratch(changed, null))).toBe('Unsaved soundscape')
    expect(currentSoundscapeName(changed, null)).toBeNull()
  })
})
