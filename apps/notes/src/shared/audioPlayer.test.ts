import { describe, expect, it } from 'vitest'
import {
  AUDIO_GRID_COLUMNS,
  getNextActiveSlotsForToggle,
  isPlaylistButtonSlot,
  PLAYLIST_BUTTON_SLOTS,
  PLAYLIST_SLOT_THEMES,
  shouldStopCurrentSongOnSlotToggle,
} from './audioPlayer'

describe('audio player bucket layout', () => {
  it('shows Pop, Rock, Electro, Lounge, and Ambient in the six-cell row', () => {
    expect(PLAYLIST_BUTTON_SLOTS).toEqual([2, 4, 5, 6, 3])
    expect(PLAYLIST_BUTTON_SLOTS.map((slot) => PLAYLIST_SLOT_THEMES[slot]))
      .toEqual(['Pop', 'Rock', 'Electro', 'Lounge', 'Ambient'])
    expect(Object.keys(PLAYLIST_SLOT_THEMES).map(Number)).toEqual([2, 3, 4, 5, 6])
    expect(AUDIO_GRID_COLUMNS).toBe(6)
    expect(isPlaylistButtonSlot(1)).toBe(false)
    expect(isPlaylistButtonSlot(2)).toBe(true)
  })
})

describe('audio bucket toggles', () => {
  it('removes the slot from the active pool when toggled off', () => {
    expect(getNextActiveSlotsForToggle([1, 2, 3], 2)).toEqual([1, 3])
  })

  it('stops the current song when it belongs to the bucket being deactivated', () => {
    expect(
      shouldStopCurrentSongOnSlotToggle({
        currentSongSlot: 2,
        activeSlots: [1, 2, 3],
        toggledSlot: 2,
      })
    ).toBe(true)

    expect(
      shouldStopCurrentSongOnSlotToggle({
        currentSongSlot: 2,
        activeSlots: [1, 2, 3],
        toggledSlot: 3,
      })
    ).toBe(false)
  })
})
