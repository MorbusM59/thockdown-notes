/**
 * The ORDER of the music pool and how a chosen song is moved to its front,
 * as pure rules shared by the database (which applies them) and the tests.
 *
 * THE POOL is every song in the active playlist slots
 * that pass its filter (`databaseService.ts`'s `musicPool`, the one place
 * that says which rows are in it, so the list, the next pick and a chosen
 * song all read the same pool; the filter is `audioPlayer.ts`'s
 * `matchesPoolFilter`).
 *
 * ITS ORDER is the pick order: lowest priority first (the next pick takes the
 * lowest), ties by id. Ties are real -- the rotation clamps priorities at 1 --
 * and the pick takes a RANDOM song among the lowest, so where several share
 * a priority the list's order among them is a stable stand-in for a draw that
 * has not happened yet.
 *
 * CHOOSING A SONG ROTATES the order rather than reshuffling it: the chosen
 * song and everything after it move to the front, everything before it
 * (the song that was playing included) to the back, in the order they had.
 * Read as a ring -- which is how the visualizer draws it -- nothing moves at
 * all except which song is at the head. The pool's own priority VALUES are
 * reused in ascending order, lifted just enough to make them strictly
 * increasing, so the chosen song is the unique lowest (the next pick cannot
 * draw anything else) and the pool keeps its place among songs of slots
 * that are not active.
 */

export interface PoolSong {
  id: number
  priority: number
}

/** Pick order: priority ascending, then id. */
export function comparePoolOrder(a: PoolSong, b: PoolSong): number {
  return a.priority - b.priority || a.id - b.id
}

/** The adjacent song in the pool's displayed ring, which starts at `currentId`. */
export function adjacentSongInPool<T extends PoolSong>(
  pool: readonly T[],
  currentId: number | undefined,
  direction: -1 | 1,
): T | null {
  if (pool.length === 0) return null
  const currentIndex = currentId === undefined ? -1 : pool.findIndex((song) => song.id === currentId)
  if (currentIndex < 0) return direction === 1 ? pool[0] : pool[pool.length - 1]
  return pool[(currentIndex + direction + pool.length) % pool.length]
}

/**
 * The priorities that rotate `pool` (in pick order) so `chosenId` is at its
 * head, as [id, priority] pairs for the songs whose priority changes. Null
 * when the song is not in the pool.
 */
export function rotatePoolTo(pool: readonly PoolSong[], chosenId: number): Array<[number, number]> | null {
  const start = pool.findIndex((song) => song.id === chosenId)
  if (start < 0) return null
  const values = pool.map((song) => song.priority).sort((a, b) => a - b)
  const changes: Array<[number, number]> = []
  let previous = -Infinity
  for (let index = 0; index < pool.length; index += 1) {
    const song = pool[(start + index) % pool.length]
    const priority = Math.max(values[index], previous + 1)
    previous = priority
    if (priority !== song.priority) changes.push([song.id, priority])
  }
  return changes
}
