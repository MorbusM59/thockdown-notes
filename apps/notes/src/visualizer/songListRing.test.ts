import { describe, expect, it } from 'vitest'
import { shortestSongListDistance, songListCycle, wrapSongListIndex } from './songListRing'

describe('song list ring', () => {
  it('wraps a larger pool without repeating an entry in the visible slots', () => {
    const ring = songListCycle(['a', 'b', 'c', 'd', 'e', 'f'])

    for (let offset = 0; offset < ring.length; offset += 1) {
      const visible = Array.from({ length: 4 }, (_, slot) => ring[wrapSongListIndex(offset + slot, ring.length)])
      expect(new Set(visible).size).toBe(4)
    }
  })

  it('keeps a smaller pool contiguous while backfilling each departed song', () => {
    const ring = songListCycle(['a', 'b', 'c'])

    expect(ring).toEqual(['a', 'b', 'c'])
    for (let offset = 0; offset < ring.length; offset += 1) {
      const visible = Array.from({ length: 5 }, (_, slot) => (
        slot < ring.length ? ring[wrapSongListIndex(offset + slot, ring.length)] : null
      ))
      const songs = visible.filter((song) => song !== null)
      expect(new Set(songs).size).toBe(songs.length)
      expect(songs).toEqual([...ring.slice(offset), ...ring.slice(0, offset)])
      expect(visible.slice(songs.length)).toEqual([null, null])
    }
  })

  it('wraps indices and takes the shortest route back to the playing song', () => {
    expect(wrapSongListIndex(-1, 5)).toBe(4)
    expect(wrapSongListIndex(5, 5)).toBe(0)
    expect(shortestSongListDistance(4, 1, 6)).toBe(3)
    expect(shortestSongListDistance(0, 4, 6)).toBe(-2)
    expect(shortestSongListDistance(0, 3, 6)).toBe(3)
  })
})
