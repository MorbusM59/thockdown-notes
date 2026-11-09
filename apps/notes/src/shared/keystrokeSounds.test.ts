import { describe, expect, it } from 'vitest'

import {
  DEFAULT_KEYSTROKE_SOUND,
  DEFAULT_KEYSTROKE_SOUND_PREFERENCES,
  FACTORY_KEYSTROKE_SOUNDS,
  isUnsavedKeystrokeSoundShown,
  matchingKeystrokeSound,
  sameKeystrokeSound,
  sanitizeKeystrokeSoundPreferences,
  unsavedKeystrokeSoundAfterEdit,
} from './keystrokeSounds'

describe('keystroke sound presets', () => {
  it('has ten distinct factory presets with distinct ids, so the active one is never ambiguous', () => {
    expect(FACTORY_KEYSTROKE_SOUNDS).toHaveLength(10)
    expect(new Set(FACTORY_KEYSTROKE_SOUNDS.map((entry) => entry.id)).size).toBe(10)
    for (const [i, a] of FACTORY_KEYSTROKE_SOUNDS.entries()) {
      for (const b of FACTORY_KEYSTROKE_SOUNDS.slice(i + 1)) expect(sameKeystrokeSound(a.settings, b.settings)).toBe(false)
    }
  })

  it('shows the plus only while the unsaved preset equals no other', () => {
    expect(isUnsavedKeystrokeSoundShown(DEFAULT_KEYSTROKE_SOUND_PREFERENCES)).toBe(false)
    const edited = { ...FACTORY_KEYSTROKE_SOUNDS[3].settings, pitch: 7 }
    const after = unsavedKeystrokeSoundAfterEdit(edited, DEFAULT_KEYSTROKE_SOUND_PREFERENCES)
    expect(isUnsavedKeystrokeSoundShown(after)).toBe(true)
    expect(matchingKeystrokeSound(edited, after)).toEqual({ kind: 'unsaved' })
    const saved = { ...after, saved: [{ id: 'x', settings: edited }] }
    expect(matchingKeystrokeSound(edited, saved)).toEqual({ kind: 'saved', id: 'x' })
    expect(isUnsavedKeystrokeSoundShown(saved)).toBe(false)
  })

  it('survives the sanitizer and clamps what it reads', () => {
    const prefs = { unsaved: { ...FACTORY_KEYSTROKE_SOUNDS[1].settings, pitch: 900, set: 'Z' }, saved: [{ id: 'a', settings: FACTORY_KEYSTROKE_SOUNDS[2].settings }, { id: 'a' }, null] }
    const out = sanitizeKeystrokeSoundPreferences(JSON.parse(JSON.stringify(prefs)))
    expect(out.unsaved.pitch).toBe(100)
    expect(out.unsaved.set).toBe(DEFAULT_KEYSTROKE_SOUND.set)
    expect(out.saved).toHaveLength(1)
    expect(sameKeystrokeSound(out.saved[0].settings, FACTORY_KEYSTROKE_SOUNDS[2].settings)).toBe(true)
  })
})
