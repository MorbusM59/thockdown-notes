import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SOUNDSTAGE_PREFERENCES,
  FACTORY_SOUNDSTAGES,
  isUnsavedShown,
  matchingSoundstage,
  sanitizeSoundstagePreferences,
  steppedFactorySoundstage,
  unsavedAfterEdit,
} from './soundstages'

const someCustom = { eq: [{ hz: 20, db: 1, handle: 0 }, { hz: 440, db: -3, handle: 0.5 }, { hz: 20000, db: 0, handle: 0 }], width: 1.03, reverb: 0.3, size: 0.5, room: 0.6 }

describe('soundstages', () => {
  it('derives the active stage from the live settings: factory, then saved, then unsaved', () => {
    for (const stage of FACTORY_SOUNDSTAGES) {
      expect(matchingSoundstage({ ...stage.settings }, DEFAULT_SOUNDSTAGE_PREFERENCES)).toEqual({ kind: 'factory', id: stage.id })
    }
    const preferences = { ...DEFAULT_SOUNDSTAGE_PREFERENCES, saved: [{ id: 'a', settings: someCustom }] }
    expect(matchingSoundstage({ ...someCustom, room: 0.6 + 1e-9 }, preferences)).toEqual({ kind: 'saved', id: 'a' })
    expect(matchingSoundstage({ ...someCustom, room: 0.61 }, preferences)).toEqual({ kind: 'unsaved' })
  })

  it('keeps an edit as the unsaved stage, shown only while it equals no other stage', () => {
    const changed = unsavedAfterEdit(someCustom, DEFAULT_SOUNDSTAGE_PREFERENCES)
    expect(changed.unsaved).toEqual(someCustom)
    expect(isUnsavedShown(changed)).toBe(true)
    expect(unsavedAfterEdit({ ...someCustom }, changed)).toBe(changed)
    // Editing onto a factory stage: that stage is the edit, and no plus.
    const back = unsavedAfterEdit(FACTORY_SOUNDSTAGES[3].settings, changed)
    expect(isUnsavedShown(back)).toBe(false)
    // Saving it: equal to the saved stage, so no plus.
    expect(isUnsavedShown({ ...changed, saved: [{ id: 'a', settings: someCustom }] })).toBe(false)
  })

  it('steps the factory stages in the solids\' order and stops at the ends', () => {
    expect(steppedFactorySoundstage('muted', -1)).toBe('muted')
    expect(steppedFactorySoundstage('muted', 1)).toBe('neutral')
    expect(steppedFactorySoundstage('thocky', 1)).toBe('thocky')
  })

  it('sanitizes a stored record into range, dropping what is unusable', () => {
    const out = sanitizeSoundstagePreferences({
      factory: 'nope',
      unsaved: { eq: 'old', width: 'x', room: -1 },
      saved: [{ id: 'a', settings: someCustom }, { id: 'a', settings: someCustom }, { settings: someCustom }, null],
    })
    expect(out.factory).toBe('neutral')
    expect(out.unsaved.eq).toEqual([{ hz: 20, db: 0, handle: 0 }, { hz: 20000, db: 0, handle: 0 }])
    expect(out.unsaved.width).toBe(1)
    expect(out.unsaved.room).toBe(0)
    expect(out.saved.map((stage) => stage.id)).toEqual(['a'])
    expect(sanitizeSoundstagePreferences(undefined)).toEqual(DEFAULT_SOUNDSTAGE_PREFERENCES)
  })
})
