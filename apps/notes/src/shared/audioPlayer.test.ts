import { describe, expect, it } from 'vitest'
import {
  AUDIO_GRID_COLUMNS,
  DEFAULT_MUSIC_SET_PREFERENCES,
  defaultMusicSetName,
  FACTORY_MUSIC_SETS,
  getNextActiveSlotsForSelection,
  isFactoryMusicSet,
  PLAYLIST_BUTTON_SLOTS,
  PLAYLIST_SLOT_THEMES,
  sanitizeMusicSetPreferences,
  shouldStopCurrentSongAfterSlotSelection,
} from './audioPlayer'

describe('audio player set layout', () => {
  it('shows Pop, Rock, Electronic, Lounge, and Ambient in the six-cell row', () => {
    expect(PLAYLIST_BUTTON_SLOTS).toEqual([2, 4, 5, 6, 3])
    expect(PLAYLIST_BUTTON_SLOTS.map((slot) => PLAYLIST_SLOT_THEMES[slot]))
      .toEqual(['Pop', 'Rock', 'Electronic', 'Lounge', 'Ambient'])
    expect(Object.keys(PLAYLIST_SLOT_THEMES).map(Number)).toEqual([2, 3, 4, 5, 6])
    expect(AUDIO_GRID_COLUMNS).toBe(6)
    expect(FACTORY_MUSIC_SETS.map((set) => set.name)).toEqual(['Pop', 'Rock', 'Electronic', 'Lounge', 'Ambient'])
    expect(isFactoryMusicSet(1)).toBe(false)
    expect(isFactoryMusicSet(2)).toBe(true)
  })
})

describe('audio set selection', () => {
  it('selects only the clicked slot unless the selection is additive', () => {
    expect(getNextActiveSlotsForSelection([1, 2, 3], 2, false)).toEqual([2])
    expect(getNextActiveSlotsForSelection([1, 2, 3], 2, true)).toEqual([1, 2, 3])
    expect(getNextActiveSlotsForSelection([1, 3], 2, true)).toEqual([1, 3, 2])
  })

  it('stops the current song only when all of its sets leave the selection', () => {
    expect(
      shouldStopCurrentSongAfterSlotSelection({
        currentSongSetIds: [2],
        nextActiveSlots: [1, 3],
      })
    ).toBe(true)

    expect(
      shouldStopCurrentSongAfterSlotSelection({
        currentSongSetIds: [2, 7],
        nextActiveSlots: [1, 7, 3],
      })
    ).toBe(false)
  })
})

describe('music sets', () => {
  it('keeps legacy factory defaults and continues generated names beyond Z', () => {
    expect(DEFAULT_MUSIC_SET_PREFERENCES.sets).toEqual(FACTORY_MUSIC_SETS)
    expect(defaultMusicSetName(Array.from({ length: 26 }, (_, index) => ({ slot: index + 10, name: `Set ${String.fromCharCode(65 + index)}` }))))
      .toBe('Set AA')
  })

  it('sanitizes persisted rows while restoring missing, non-deletable factory sets', () => {
    expect(sanitizeMusicSetPreferences({
      sets: [
        { slot: 7, name: '  My set  ' },
        { slot: 2, name: 'Changed factory name' },
        { slot: 8, name: '   ' },
        { slot: 7, name: 'Duplicate id' },
        { slot: 1, name: 'Legacy slot' },
      ],
      nextSlot: 4,
    })).toEqual({
      sets: [
        { slot: 7, name: 'My set' },
        { slot: 2, name: 'Pop' },
        { slot: 4, name: 'Rock' },
        { slot: 5, name: 'Electronic' },
        { slot: 6, name: 'Lounge' },
        { slot: 3, name: 'Ambient' },
      ],
      nextSlot: 8,
    })
  })
})
