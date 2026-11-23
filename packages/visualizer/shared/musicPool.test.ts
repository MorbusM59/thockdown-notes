import { describe, expect, it } from 'vitest'
import { adjacentSongInPool, afterPlay, comparePoolOrder, favorited, pickFromPool, rotatePoolTo, skipped, unfavorited, type PoolSong } from './musicPool'

function apply(pool: PoolSong[], changes: Array<[number, number]>): PoolSong[] {
  const next = new Map(changes)
  return pool.map((song) => ({ id: song.id, priority: next.get(song.id) ?? song.priority })).sort(comparePoolOrder)
}

describe('adjacentSongInPool', () => {
  const pool: PoolSong[] = [{ id: 1, priority: 1 }, { id: 2, priority: 2 }, { id: 3, priority: 3 }]

  it('steps forward and backward from the current song, wrapping at both ends', () => {
    expect(adjacentSongInPool(pool, 2, 1)?.id).toBe(3)
    expect(adjacentSongInPool(pool, 2, -1)?.id).toBe(1)
    expect(adjacentSongInPool(pool, 1, -1)?.id).toBe(3)
    expect(adjacentSongInPool(pool, 3, 1)?.id).toBe(1)
  })

  it('starts at the appropriate end when the current song is not in the pool', () => {
    expect(adjacentSongInPool(pool, undefined, 1)?.id).toBe(1)
    expect(adjacentSongInPool(pool, 99, -1)?.id).toBe(3)
    expect(adjacentSongInPool([], 1, 1)).toBeNull()
  })
})

describe('rotatePoolTo', () => {
  it('moves the chosen song to the head and keeps the ring order, ties included', () => {
    const pool: PoolSong[] = [
      { id: 4, priority: 0 }, { id: 2, priority: 1 }, { id: 7, priority: 1 }, { id: 1, priority: 3 }, { id: 9, priority: 8 },
    ].sort(comparePoolOrder)
    for (const chosen of pool) {
      const after = apply(pool, rotatePoolTo(pool, chosen.id)!)
      const start = pool.findIndex((song) => song.id === chosen.id)
      expect(after.map((song) => song.id)).toEqual([...pool.slice(start), ...pool.slice(0, start)].map((song) => song.id))
      // The chosen song is the unique lowest, so the next pick cannot draw another.
      expect(after[0].priority).toBeLessThan(after[1].priority)
    }
  })

  it('changes nothing when the head is chosen and priorities are already distinct', () => {
    expect(rotatePoolTo([{ id: 1, priority: 1 }, { id: 2, priority: 5 }], 1)).toEqual([])
  })

  it('is null for a song outside the pool', () => {
    expect(rotatePoolTo([{ id: 1, priority: 1 }], 3)).toBeNull()
  })
})

describe('the rotation', () => {
  const library = [
    { id: 1, priority: 1, favorability: 1 },
    { id: 2, priority: 3, favorability: 2 },
    { id: 3, priority: 5, favorability: 10 },
  ]

  it('sends a played song to the back and moves the others up by their favorability, not below 1', () => {
    expect(new Map(afterPlay(library, 1))).toEqual(new Map([[1, 3], [2, 1], [3, 1]]))
  })

  it('picks only among the lowest priority', () => {
    const pool = [{ id: 1, priority: 1 }, { id: 2, priority: 1 }, { id: 3, priority: 2 }]
    expect(pickFromPool(pool, () => 0)?.id).toBe(1)
    expect(pickFromPool(pool, () => 0.99)?.id).toBe(2)
    expect(pickFromPool([], () => 0)).toBeNull()
  })

  it('favorites to the front up to the cap, unfavorites and skips to the back', () => {
    expect(favorited(library[2])).toEqual({ id: 3, priority: 0, favorability: 10 })
    expect(unfavorited(library[1], 3)).toEqual({ id: 2, priority: 3, favorability: 2 })
    expect(skipped(library[1], 3)).toEqual({ id: 2, priority: 3, favorability: 1 })
  })
})
