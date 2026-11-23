import { describe, expect, it } from 'vitest'
import { listRing, shortestListDistance, wrapListIndex } from './songListRing'

describe('visualizer list ring', () => {
  it('wraps a longer list without repeating an entry in the visible slots', () => {
    const ring = listRing(['a', 'b', 'c', 'd', 'e', 'f'])

    for (let offset = 0; offset < ring.length; offset += 1) {
      const visible = Array.from({ length: 4 }, (_, slot) => ring[wrapListIndex(offset + slot, ring.length)])
      expect(new Set(visible).size).toBe(4)
    }
  })

  it('keeps a shorter list contiguous while leaving unused slots at the bottom', () => {
    const ring = listRing(['a', 'b', 'c'])

    expect(ring).toEqual(['a', 'b', 'c'])
    for (let offset = 0; offset < ring.length; offset += 1) {
      const visible = Array.from({ length: 5 }, (_, slot) => (
        slot < ring.length ? ring[wrapListIndex(offset + slot, ring.length)] : null
      ))
      const songs = visible.filter((song) => song !== null)
      expect(new Set(songs).size).toBe(songs.length)
      expect(songs).toEqual([...ring.slice(offset), ...ring.slice(0, offset)])
      expect(visible.slice(songs.length)).toEqual([null, null])
    }
  })

  it('wraps indices and takes the shortest route back to its home item', () => {
    expect(wrapListIndex(-1, 5)).toBe(4)
    expect(wrapListIndex(5, 5)).toBe(0)
    expect(shortestListDistance(4, 1, 6)).toBe(3)
    expect(shortestListDistance(0, 4, 6)).toBe(-2)
    expect(shortestListDistance(0, 3, 6)).toBe(3)
  })
})
