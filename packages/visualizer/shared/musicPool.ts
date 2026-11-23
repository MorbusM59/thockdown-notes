/**
 * The ORDER of the music pool and how a chosen song is moved to its front,
 * as pure rules shared by the desktop's database and the Android service,
 * which apply them.
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

/**
 * THE ROTATION, over the whole library (not only the pool): what a play, a
 * favorite and a skip do to the songs' priorities. Pure, so the desktop's
 * database and the Android service apply the same rules.
 *
 * - A song that PLAYS goes to the back (priority = the library's size) and
 *   every other song moves up by its FAVORABILITY, not below 1; a liked
 *   song comes round again sooner.
 * - FAVORITING puts a song at the front (priority 0, ahead of the clamp at
 *   1, so it is the next pick) and likes it one more, up to MAX_FAVORABILITY.
 * - UNFAVORITING sends it to the back without changing how much it is liked.
 * - SKIPPING sends it to the back and forgets that it was liked.
 */
export interface LibrarySong extends PoolSong {
  favorability: number
}

export const MAX_FAVORABILITY = 10

/** A random song among those sharing the pool's lowest priority; `pool` in pick order. */
export function pickFromPool<T extends PoolSong>(pool: readonly T[], random: () => number = Math.random): T | null {
  if (pool.length === 0) return null
  let count = 1
  while (count < pool.length && pool[count].priority === pool[0].priority) count += 1
  return pool[Math.floor(random() * count)]
}

/** The library after `playedId` played, as [id, priority] pairs for the songs that change. */
export function afterPlay(library: readonly LibrarySong[], playedId: number): Array<[number, number]> {
  const changes: Array<[number, number]> = []
  for (const song of library) {
    const priority = song.id === playedId ? library.length : Math.max(1, song.priority - song.favorability)
    if (priority !== song.priority) changes.push([song.id, priority])
  }
  return changes
}

/** The song after a favorite: next to play, and liked one more. */
export function favorited(song: LibrarySong): LibrarySong {
  return { ...song, priority: 0, favorability: Math.min(MAX_FAVORABILITY, song.favorability + 1) }
}

/** The song after an unfavorite: to the back, as liked as before. */
export function unfavorited(song: LibrarySong, librarySize: number): LibrarySong {
  return { ...song, priority: librarySize }
}

/** The song after a skip: to the back, and no longer liked. */
export function skipped(song: LibrarySong, librarySize: number): LibrarySong {
  return { ...song, priority: librarySize, favorability: 1 }
}
