import { describe, expect, it } from 'vitest'
import { getNextActiveSlotsForToggle, shouldStopCurrentSongOnSlotToggle } from './audioPlayer'

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
