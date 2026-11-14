import { describe, expect, it } from 'vitest'

import {
  DEFAULT_KEYSTROKE_SOUND,
  FACTORY_KEYSTROKE_SOUNDS,
  sameKeystrokeSound,
  sanitizeKeystrokeSoundPreferences,
} from './keystrokeSounds'

describe('keystroke sound presets', () => {
  it('has five distinct factory presets with distinct ids and bare icons', () => {
    expect(FACTORY_KEYSTROKE_SOUNDS).toHaveLength(5)
    expect(new Set(FACTORY_KEYSTROKE_SOUNDS.map((entry) => entry.id)).size).toBe(5)
    for (const [i, a] of FACTORY_KEYSTROKE_SOUNDS.entries()) {
      expect(a.icon).toMatch(/^fa-[a-z0-9-]+$/)
      for (const b of FACTORY_KEYSTROKE_SOUNDS.slice(i + 1)) expect(sameKeystrokeSound(a.settings, b.settings)).toBe(false)
    }
  })

  it('survives the sanitizer and clamps what it reads', () => {
    const edited = { ...FACTORY_KEYSTROKE_SOUNDS[1].settings, pitch: 900, channels: { ...FACTORY_KEYSTROKE_SOUNDS[1].settings.channels, forge: { on: 'yes', volume: -3, jitter: 2 } } }
    const prefs = { activeId: 'a', custom: [{ id: 'a', name: 'Mine', icon: null, settings: edited }, { id: 'a' }, null], factoryEdits: [] }
    const out = sanitizeKeystrokeSoundPreferences(JSON.parse(JSON.stringify(prefs)))
    expect(out.activeId).toBe('a')
    expect(out.custom).toHaveLength(1)
    expect(out.custom[0].settings.pitch).toBe(100)
    expect(out.custom[0].settings.channels.forge).toEqual({ on: DEFAULT_KEYSTROKE_SOUND.channels.forge.on, volume: 0, jitter: 0.5, pitch: 0 })
  })
})
