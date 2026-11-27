import { describe, expect, it } from 'vitest'
import {
  advance,
  choose,
  clampLikes,
  comparePaths,
  favorabilityOf,
  MAX_LIKES,
  queueOrder,
  reinsertDue,
  reinsertIndex,
  settleDues,
  stepBack,
  type DueChanges,
  type QueuedSong,
} from './musicPool'

/** A seeded generator, so a run is the same run every time. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

function songs(count: number, likes: (id: number) => number = () => 0): QueuedSong[] {
  return Array.from({ length: count }, (_, index) => ({ id: index + 1, filePath: `/m/${index + 1}.mp3`, due: index, likes: likes(index + 1) }))
}

function apply(pool: QueuedSong[], changes: DueChanges): QueuedSong[] {
  const next = new Map(changes)
  return pool.map((song) => (next.has(song.id) ? { ...song, due: next.get(song.id)! } : song))
}

const ids = (pool: readonly QueuedSong[]) => queueOrder(pool, 'mix').map((song) => song.id)

/** Plays `steps` songs through the mix from the start, returning what played. */
function play(pool: QueuedSong[], steps: number): { played: number[]; pool: QueuedSong[] } {
  let current: number | null = null
  const played: number[] = []
  for (let step = 0; step < steps; step += 1) {
    const move: { song: QueuedSong | null; changes: DueChanges } = advance(pool, 'mix', current)
    pool = apply(pool, move.changes)
    current = move.song!.id
    played.push(current)
  }
  return { played, pool }
}

describe('favorability', () => {
  it('is 1.25 a step, a step down undoing a step up exactly', () => {
    expect(favorabilityOf(1)).toBe(1.25)
    expect(favorabilityOf(-1)).toBeCloseTo(0.8)
    expect(favorabilityOf(3) * favorabilityOf(-3)).toBe(1)
    expect(clampLikes(MAX_LIKES + 4)).toBe(MAX_LIKES)
    expect(clampLikes(-MAX_LIKES - 4)).toBe(-MAX_LIKES)
    expect(clampLikes(Number.NaN)).toBe(0)
  })
})

describe('the mix', () => {
  it('moves only the song left; every other song keeps its place', () => {
    const pool = songs(8)
    const move = advance(pool, 'mix', 1)
    expect(move.changes.map(([id]) => id)).toEqual([1])
    expect(ids(apply(pool, move.changes))).toEqual([2, 3, 4, 5, 6, 7, 8, 1])
  })

  it('with equal liking, plays every song once per round in the generated order', () => {
    const generated = settleDues(songs(20).map((song) => ({ ...song, due: null })), seeded(7))
    const pool = apply(songs(20), generated)
    const first = ids(pool)
    const { played } = play(pool, 60)
    expect(played).toEqual([...first, ...first, ...first])
  })

  it('puts a liked song back in at L x (least favorability / its own)', () => {
    // Nine others; liked twice: 9 x 1/1.5625 = 5.76, so it goes in at place 6.
    const pool = songs(10, (id) => (id === 1 ? 2 : 0))
    expect(reinsertIndex(9, 2, 0)).toBe(6)
    expect(ids(apply(pool, reinsertDue(pool, 1)))).toEqual([2, 3, 4, 5, 6, 7, 1, 8, 9, 10])
  })

  it('reads favorability against the pool’s least liked song, which goes to the end', () => {
    // Everyone disliked equally is the same as nobody: a plain round.
    const pool = songs(6, () => -4)
    expect(ids(apply(pool, reinsertDue(pool, 1)))).toEqual([2, 3, 4, 5, 6, 1])
  })

  it('never plays a song straight again while there is another', () => {
    expect(reinsertIndex(50, MAX_LIKES, -MAX_LIKES)).toBe(1)
    expect(reinsertIndex(1, 0, 0)).toBe(1)
    expect(reinsertIndex(0, 0, 0)).toBe(0)
  })

  it('plays a song as often as its favorability says, over a long run', () => {
    // A song liked k steps comes round 1.25^k times as often as a neutral one.
    const pool = songs(40, (id) => (id === 1 ? 4 : 0))
    const { played } = play(pool, 4000)
    const liked = played.filter((id) => id === 1).length
    const neutral = played.filter((id) => id === 2).length
    expect(liked / neutral).toBeGreaterThan(favorabilityOf(4) * 0.9)
    expect(liked / neutral).toBeLessThan(favorabilityOf(4) * 1.1)
  })

  it('keeps every place exact when the dues between two neighbours run out', () => {
    // The same liked song reinserted into the same gap again and again halves
    // the gap each time; past what a double can hold the pool is respaced.
    let pool = songs(4, (id) => (id === 1 ? MAX_LIKES : 0))
    for (let round = 0; round < 200; round += 1) {
      const order = ids(pool)
      pool = apply(pool, reinsertDue(pool, order[0]))
      const after = ids(pool)
      expect(new Set(after).size).toBe(4)
      expect(after[0]).toBe(order[1])
    }
  })

  it('shuffles equals uniformly when it generates the list', () => {
    // Where song 1 lands among 5 equals, over many generations: each place a fifth.
    const counts = [0, 0, 0, 0, 0]
    const random = seeded(3)
    const trials = 20000
    for (let trial = 0; trial < trials; trial += 1) {
      const generated = apply(songs(5), settleDues(songs(5).map((song) => ({ ...song, due: null })), random))
      counts[ids(generated).indexOf(1)] += 1
    }
    for (const count of counts) expect(Math.abs(count / trials - 0.2)).toBeLessThan(0.015)
  })

  it('generates the most liked first and places a new song among the others', () => {
    const library = [{ id: 1, likes: 0, due: null }, { id: 2, likes: 3, due: null }, { id: 3, likes: -1, due: null }]
    expect(settleDues(library, () => 0.5).map(([id]) => id)).toEqual([2, 1, 3])
    const placed = settleDues([{ id: 1, likes: 0, due: 0 }, { id: 2, likes: 0, due: 9 }, { id: 3, likes: 0, due: null }], () => 0.5)
    expect(placed).toEqual([[3, 5]])
  })
})

describe('moving through the mix', () => {
  it('plays a chosen song now, puts the song left back in, and keeps the songs jumped over', () => {
    const pool = songs(6)
    const move = choose(pool, 'mix', 1, 4)
    expect(move.song?.id).toBe(4)
    expect(ids(apply(pool, move.changes))).toEqual([4, 2, 3, 5, 6, 1])
  })

  it('goes back to the song before, and next returns to the one interrupted', () => {
    // 1 played, then 2 is playing: back to 1, with 2 next.
    let pool = apply(songs(5), advance(songs(5), 'mix', 1).changes)
    expect(ids(pool)[0]).toBe(2)
    pool = apply(pool, stepBack(pool, 'mix', 2, 1))
    expect(ids(pool).slice(0, 2)).toEqual([1, 2])
    expect(advance(pool, 'mix', 1).song?.id).toBe(2)
  })

  it('keeps the order of the songs that stay when the pool changes', () => {
    const pool = songs(6)
    const narrowed = pool.filter((song) => song.id % 2 === 0)
    expect(ids(narrowed)).toEqual([2, 4, 6])
    expect(advance(narrowed, 'mix', 1).changes).toEqual([])
  })
})

describe('folder order', () => {
  it('compares paths with numbers read as numbers and case ignored', () => {
    const paths = ['/m/B/10 x.mp3', '/m/a/2 x.mp3', '/m/b/9 x.mp3', '/m/b/09b.mp3', '/m/A/1.mp3']
    expect([...paths].sort(comparePaths)).toEqual(['/m/A/1.mp3', '/m/a/2 x.mp3', '/m/b/9 x.mp3', '/m/b/09b.mp3', '/m/B/10 x.mp3'])
  })

  it('plays by path, wrapping, and writes no dues', () => {
    const pool = [
      { id: 1, filePath: '/m/b/10.mp3', due: 0, likes: 5 },
      { id: 2, filePath: '/m/a/2.mp3', due: 1, likes: 0 },
      { id: 3, filePath: '/m/b/9.mp3', due: 2, likes: 0 },
    ]
    expect(queueOrder(pool, 'order').map((song) => song.id)).toEqual([2, 3, 1])
    expect(advance(pool, 'order', 2)).toEqual({ song: pool[2], changes: [] })
    expect(advance(pool, 'order', 1).song?.id).toBe(2)
    expect(advance(pool, 'order', null).song?.id).toBe(2)
    expect(choose(pool, 'order', 2, 1)).toEqual({ song: pool[0], changes: [] })
    expect(stepBack(pool, 'order', 3, 2)).toEqual([])
  })
})
