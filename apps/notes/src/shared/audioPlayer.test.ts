import { describe, expect, it } from 'vitest'
import {
  AUDIO_GRID_COLUMNS,
  getNextActiveSlotsForSelection,
  isPlaylistButtonSlot,
  PLAYLIST_BUTTON_SLOTS,
  PLAYLIST_SLOT_THEMES,
  shouldStopCurrentSongAfterSlotSelection,
} from './audioPlayer'

describe('audio player bucket layout', () => {
  it('shows Pop, Rock, Electronic, Lounge, and Ambient in the six-cell row', () => {
    expect(PLAYLIST_BUTTON_SLOTS).toEqual([2, 4, 5, 6, 3])
    expect(PLAYLIST_BUTTON_SLOTS.map((slot) => PLAYLIST_SLOT_THEMES[slot]))
      .toEqual(['Pop', 'Rock', 'Electronic', 'Lounge', 'Ambient'])
    expect(Object.keys(PLAYLIST_SLOT_THEMES).map(Number)).toEqual([2, 3, 4, 5, 6])
    expect(AUDIO_GRID_COLUMNS).toBe(6)
    expect(isPlaylistButtonSlot(1)).toBe(false)
    expect(isPlaylistButtonSlot(2)).toBe(true)
  })
})

describe('audio bucket selection', () => {
  it('selects only the clicked slot unless the selection is additive', () => {
    expect(getNextActiveSlotsForSelection([1, 2, 3], 2, false)).toEqual([2])
    expect(getNextActiveSlotsForSelection([1, 2, 3], 2, true)).toEqual([1, 2, 3])
    expect(getNextActiveSlotsForSelection([1, 3], 2, true)).toEqual([1, 3, 2])
  })

  it('stops the current song only when its slot leaves the selection', () => {
    expect(
      shouldStopCurrentSongAfterSlotSelection({
        currentSongSlot: 2,
        nextActiveSlots: [1, 3],
      })
    ).toBe(true)

    expect(
      shouldStopCurrentSongAfterSlotSelection({
        currentSongSlot: 2,
        nextActiveSlots: [1, 2, 3],
      })
    ).toBe(false)
  })
})
