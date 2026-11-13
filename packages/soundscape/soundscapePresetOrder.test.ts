import { describe, expect, it } from 'vitest'
import { DEFAULT_SOUNDSCAPE_PREFERENCES, moveSoundscapePreset, orderedSoundscapePresets, SOUNDSCAPE_FACTORY_PRESETS } from './soundscape'

const ids = (preferences: typeof DEFAULT_SOUNDSCAPE_PREFERENCES) => orderedSoundscapePresets(preferences).map((preset) => preset.id)
const natural = SOUNDSCAPE_FACTORY_PRESETS.map((preset) => preset.id)

describe('the soundscapes order', () => {
  it('is the natural order while nothing has been moved', () => {
    expect(ids(DEFAULT_SOUNDSCAPE_PREFERENCES)).toEqual(natural)
  })

  it('moves a soundscape onto its target, the others making room on the side it came from', () => {
    const [a, b, c, d] = natural
    const later = moveSoundscapePreset(DEFAULT_SOUNDSCAPE_PREFERENCES, a, c)
    expect(ids(later).slice(0, 4)).toEqual([b, c, a, d])
    const earlier = moveSoundscapePreset(DEFAULT_SOUNDSCAPE_PREFERENCES, d, b)
    expect(ids(earlier).slice(0, 4)).toEqual([a, d, b, c])
  })

  it('places a soundscape the order does not name after the ones it does', () => {
    const moved = moveSoundscapePreset(DEFAULT_SOUNDSCAPE_PREFERENCES, natural[0], natural[1])
    const custom = { id: 'mine', name: 'Mine', icon: null, settings: DEFAULT_SOUNDSCAPE_PREFERENCES.settings }
    expect(ids({ ...moved, customPresets: [custom] }).at(-1)).toBe('mine')
  })
})
