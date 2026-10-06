import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SOUNDSCAPE_PREFERENCES,
  SOUNDSCAPE_FACTORY_PRESETS,
  applySoundscapePreset,
  type SoundscapePreferences,
} from '@thockdown/soundscape/soundscape'
import { currentEntryId, currentSoundscapeName, followSession, sessionEntries } from './sessionEntries'

const onPreset = (index: number): SoundscapePreferences => applySoundscapePreset(DEFAULT_SOUNDSCAPE_PREFERENCES, SOUNDSCAPE_FACTORY_PRESETS[index])

/** `preferences` with one setting changed, so they match no soundscape. */
function edited(preferences: SoundscapePreferences): SoundscapePreferences {
  return { ...preferences, activePresetId: null, settings: { ...preferences.settings, volume: preferences.settings.volume * 0.5 } }
}

describe('media-control cycle', () => {
  it('steps through every factory soundscape and then the user\'s own, with no stop for unsaved changes', () => {
    const changed = edited(onPreset(0))
    const mine = { ...changed, customPresets: [{ id: 'mine', name: 'Mine', settings: onPreset(1).settings }] }
    expect(sessionEntries(mine.customPresets).map((entry) => entry.id))
      .toEqual([...SOUNDSCAPE_FACTORY_PRESETS.map((preset) => preset.id), 'mine'])
    expect(currentEntryId(changed)).toBeNull()
  })

  it('follows play and pause without touching the settings', () => {
    const playing = onPreset(2)
    const paused = followSession(playing, { regular: 'paused', currentId: SOUNDSCAPE_FACTORY_PRESETS[2].id })
    expect(paused.enabled).toBe(false)
    expect(paused.settings).toBe(playing.settings)
  })

  it('follows the session to exactly the soundscape it plays, a soloed channel included', () => {
    const playing = onPreset(0)
    const soloed = { ...playing, settings: { ...playing.settings, channels: playing.settings.channels.map((channel, index) => ({ ...channel, solo: index === 0 })) } }
    const target = SOUNDSCAPE_FACTORY_PRESETS[1]
    const followed = followSession(soloed, { regular: 'playing', currentId: target.id })
    expect(followed.settings).toEqual(target.settings)
    expect(followed.settings.channels.some((channel) => channel.solo)).toBe(false)
  })
})

describe('the name the notification shows', () => {
  it('names a factory soundscape and the user\'s own alike', () => {
    const custom = { id: 'mine', name: 'Custom soundscape 1', settings: edited(onPreset(0)).settings }
    const last = { ...onPreset(SOUNDSCAPE_FACTORY_PRESETS.length - 1), customPresets: [custom] }
    expect(currentSoundscapeName(last)).toBe(SOUNDSCAPE_FACTORY_PRESETS[SOUNDSCAPE_FACTORY_PRESETS.length - 1].name)
    expect(currentSoundscapeName({ ...last, activePresetId: 'mine', settings: custom.settings })).toBe('Custom soundscape 1')
  })

  it('names unsaved changes', () => {
    expect(currentSoundscapeName(edited(onPreset(0)))).toBe('Unsaved soundscape')
  })
})
