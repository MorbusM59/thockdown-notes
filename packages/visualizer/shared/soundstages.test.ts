import { describe, expect, it } from 'vitest'

import { createPreset, deletePreset, editActivePreset, selectPreset } from '@thockdown/interaction/presetList'
import {
  activeSoundstage,
  DEFAULT_SOUNDSTAGE_PREFERENCES,
  sanitizeSoundstagePreferences,
  SOUNDSTAGE_KIND,
  steppedFactorySoundstage,
  withActiveSoundstage,
} from './soundstages'

const someCustom = { eq: [{ hz: 20, db: 1, handle: 0 }, { hz: 440, db: -3, handle: 0.5 }, { hz: 20000, db: 0, handle: 0 }], width: 1.03, reverb: 0.3, size: 0.5, room: 0.6 }

describe('soundstages', () => {
  it('starts on Neutral, as shipped', () => {
    expect(activeSoundstage(DEFAULT_SOUNDSTAGE_PREFERENCES).id).toBe('neutral')
  })

  it('writes an edit into the active stage and follows the active stage with factory and lastCustom', () => {
    const wide = withActiveSoundstage(DEFAULT_SOUNDSTAGE_PREFERENCES, selectPreset(SOUNDSTAGE_KIND, DEFAULT_SOUNDSTAGE_PREFERENCES, 'wide'))
    expect(wide.factory).toBe('wide')
    const edited = { ...wide, ...editActivePreset(SOUNDSTAGE_KIND, wide, someCustom) }
    expect(activeSoundstage(edited).settings).toEqual(someCustom)
    expect(edited.factoryEdits.map((stage) => stage.id)).toEqual(['wide'])
    const created = createPreset(SOUNDSTAGE_KIND, edited, 'mine')!
    const mine = withActiveSoundstage(edited, created)
    expect(mine.lastCustom).toBe('mine')
    expect(mine.factory).toBe('wide')
    expect(activeSoundstage(mine).name).toBe('Soundstage A')
    const deleted = withActiveSoundstage(mine, deletePreset(SOUNDSTAGE_KIND, mine, 'mine'))
    expect(deleted.lastCustom).toBeNull()
    expect(deleted.activeId).toBe('neutral')
  })

  it('steps the factory stages in the solids\' order and stops at the ends', () => {
    expect(steppedFactorySoundstage('muted', -1)).toBe('muted')
    expect(steppedFactorySoundstage('muted', 1)).toBe('neutral')
    expect(steppedFactorySoundstage('thocky', 1)).toBe('thocky')
  })

  it('sanitizes a stored record into range, dropping what is unusable', () => {
    const out = sanitizeSoundstagePreferences({
      factory: 'nope',
      activeId: 'gone',
      lastCustom: 'gone',
      factoryEdits: [{ id: 'wide', settings: { eq: 'old', width: 'x', room: -1 } }, { id: 'nope', settings: someCustom }],
      custom: [{ id: 'a', settings: someCustom }, { id: 'a', settings: someCustom }, { settings: someCustom }, null],
    })
    expect(out.factory).toBe('neutral')
    expect(out.activeId).toBe('neutral')
    expect(out.lastCustom).toBeNull()
    expect(out.factoryEdits).toHaveLength(1)
    expect(out.factoryEdits[0].name).toBe('Wide')
    expect(out.factoryEdits[0].settings.eq).toEqual([{ hz: 20, db: 0, handle: 0 }, { hz: 20000, db: 0, handle: 0 }])
    expect(out.factoryEdits[0].settings.width).toBe(1)
    expect(out.factoryEdits[0].settings.room).toBe(0)
    expect(out.custom.map((stage) => stage.id)).toEqual(['a'])
    expect(out.custom[0].name).toBe('Soundstage A')
    expect(sanitizeSoundstagePreferences(undefined)).toEqual(DEFAULT_SOUNDSTAGE_PREFERENCES)
  })
})
