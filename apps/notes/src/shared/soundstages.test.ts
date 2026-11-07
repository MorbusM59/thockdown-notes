import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SOUNDSTAGE_PREFERENCES,
  FACTORY_SOUNDSTAGES,
  customAfterLiveChange,
  matchingSoundstage,
  sanitizeSoundstagePreferences,
  steppedFactorySoundstage,
} from './soundstages'

const someCustom = { skew: 0.4, shape: 1.3, stretch: 2, amount: 5, width: 1.03, reverb: 0.3, size: 0.5, room: 0.6 }

describe('soundstages', () => {
  it('derives the active stage from the live settings: factory, then saved, then custom', () => {
    for (const stage of FACTORY_SOUNDSTAGES) {
      expect(matchingSoundstage({ ...stage.settings }, DEFAULT_SOUNDSTAGE_PREFERENCES)).toEqual({ kind: 'factory', id: stage.id })
    }
    const preferences = { ...DEFAULT_SOUNDSTAGE_PREFERENCES, saved: [{ id: 'a', settings: someCustom }] }
    expect(matchingSoundstage({ ...someCustom, room: 0.6 + 1e-9 }, preferences)).toEqual({ kind: 'saved', id: 'a' })
    expect(matchingSoundstage({ ...someCustom, room: 0.61 }, preferences)).toEqual({ kind: 'custom' })
  })

  it('keeps the custom stage as the last non-factory settings, and leaves it alone on a factory stage', () => {
    const changed = customAfterLiveChange(someCustom, DEFAULT_SOUNDSTAGE_PREFERENCES)
    expect(changed.custom).toEqual(someCustom)
    expect(customAfterLiveChange(FACTORY_SOUNDSTAGES[3].settings, changed)).toBe(changed)
    expect(customAfterLiveChange({ ...someCustom }, changed)).toBe(changed)
  })

  it('steps the factory stages in the solids\' order and stops at the ends', () => {
    expect(steppedFactorySoundstage('muted', -1)).toBe('muted')
    expect(steppedFactorySoundstage('muted', 1)).toBe('neutral')
    expect(steppedFactorySoundstage('thocky', 1)).toBe('thocky')
  })

  it('sanitizes a stored record into range, dropping what is unusable', () => {
    const out = sanitizeSoundstagePreferences({
      factory: 'nope',
      custom: { skew: 5, width: 'x', room: -1 },
      saved: [{ id: 'a', settings: someCustom }, { id: 'a', settings: someCustom }, { settings: someCustom }, null],
    })
    expect(out.factory).toBe('neutral')
    expect(out.custom.skew).toBe(3)
    expect(out.custom.width).toBe(1)
    expect(out.custom.room).toBe(0)
    expect(out.saved.map((stage) => stage.id)).toEqual(['a'])
    expect(sanitizeSoundstagePreferences(undefined)).toEqual(DEFAULT_SOUNDSTAGE_PREFERENCES)
  })
})
