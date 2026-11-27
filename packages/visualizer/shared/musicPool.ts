/**
 * THE QUEUE: the order the music pool plays in, and the rules that move it,
 * as pure functions shared by the desktop's database and the Android music
 * renderer, which apply them. Neither app restates any of it.
 *
 * THE POOL is every song in the active sets that passes the filter. It is
 * played as a LIST that stays put: the song at its head plays, and when a
 * song is left (it ended, or the listener moved on) only that song moves.
 * Nothing else in the list changes place because something played.
 *
 * There are two PLAY MODES:
 *
 * - MIX: the list is ordered by each song's DUE, a number stored per song.
 *   A song that is left goes back in at `L x (least favorability in the pool
 *   / its own favorability)` places from the front, L being the number of
 *   other songs, so the pool's least liked song goes to the end and every
 *   other song comes round sooner the more it is liked. A song is put in a
 *   place by giving it a due between its two new neighbours', so no other
 *   song's due changes (`reinsertDue`). Dues are stored for the whole
 *   library, not per pool, so a change of sets or filter keeps the order of
 *   the songs that stay and drops the ones that leave.
 * - ORDER: the pool by file path; the song after the one playing is next,
 *   wrapping round at the end. Dues are not read or written, so the mix
 *   carries on from where it was when the mode is switched back.
 *
 * FAVORABILITY is `LIKE_FACTOR ^ likes`, `likes` being a whole number of
 * steps in -MAX_LIKES..MAX_LIKES stored per song (the same song in every set
 * and pool). Stored as steps, a step up and a step down cancel exactly.
 * Favorability is read relative to the pool's least liked song, so only
 * differences inside the pool matter.
 *
 * A song with no due yet is placed by `settleDues`: when no song has one
 * (a library seen for the first time) the whole library is generated, most
 * liked first and equals in a random order; otherwise each new song goes in
 * at a random place.
 */

export type PlayMode = 'mix' | 'order'

export const PLAY_MODES: readonly PlayMode[] = ['mix', 'order']

/** A stored value read as a play mode; anything else is the default, mix. */
export function sanitizePlayMode(value: unknown): PlayMode {
  return value === 'order' ? 'order' : 'mix'
}

/** How far a song can be liked or disliked, in steps. */
export const MAX_LIKES = 10

/** What one step of liking multiplies favorability by (a step down divides by it: 0.8). */
export const LIKE_FACTOR = 1.25

/** `likes` rounded to a whole step and held inside -MAX_LIKES..MAX_LIKES. */
export function clampLikes(likes: number): number {
  if (!Number.isFinite(likes)) return 0
  return Math.max(-MAX_LIKES, Math.min(MAX_LIKES, Math.round(likes)))
}

export function favorabilityOf(likes: number): number {
  return LIKE_FACTOR ** clampLikes(likes)
}

/** The fields of a song the queue reads. */
export interface QueuedSong {
  id: number
  filePath: string
  due: number
  likes: number
}

/** Changes to dues, as [id, due] pairs. */
export type DueChanges = Array<[number, number]>

/** Mix order: due ascending, then id. */
export function compareDue(a: Pick<QueuedSong, 'id' | 'due'>, b: Pick<QueuedSong, 'id' | 'due'>): number {
  return a.due - b.due || a.id - b.id
}

/**
 * Two paths in folder order: case ignored, and a run of digits compared as a
 * number, so `2 Song` comes before `10 Song`. Written out rather than taken
 * from `Intl.Collator`, because the Android music renderer runs in a bare
 * JavaScript engine that is not promised to carry `Intl`.
 */
export function comparePaths(a: string, b: string): number {
  const left = a.toLowerCase()
  const right = b.toLowerCase()
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    const x = left.charCodeAt(i)
    const y = right.charCodeAt(j)
    if (isDigit(x) && isDigit(y)) {
      let iEnd = i
      while (iEnd < left.length && isDigit(left.charCodeAt(iEnd))) iEnd += 1
      let jEnd = j
      while (jEnd < right.length && isDigit(right.charCodeAt(jEnd))) jEnd += 1
      // Leading zeros dropped, a longer run is the larger number; equal lengths compare digit by digit.
      const xs = left.slice(i, iEnd).replace(/^0+(?=\d)/, '')
      const ys = right.slice(j, jEnd).replace(/^0+(?=\d)/, '')
      if (xs.length !== ys.length) return xs.length - ys.length
      if (xs !== ys) return xs < ys ? -1 : 1
      i = iEnd
      j = jEnd
      continue
    }
    if (x !== y) return x - y
    i += 1
    j += 1
  }
  return (left.length - i) - (right.length - j)
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57
}

/** Folder order: file path (`comparePaths`), then id. */
export function comparePath(a: Pick<QueuedSong, 'id' | 'filePath'>, b: Pick<QueuedSong, 'id' | 'filePath'>): number {
  return comparePaths(a.filePath, b.filePath) || a.id - b.id
}

/** The pool as the list it plays in, from its head. */
export function queueOrder<T extends QueuedSong>(pool: readonly T[], mode: PlayMode): T[] {
  return [...pool].sort(mode === 'order' ? comparePath : compareDue)
}

/**
 * Where a song that is left goes back into a mix list of `others` songs:
 * an index into them, never 0 while there is another song (the next song
 * is already at the head and plays first), at most `others` (the end).
 */
export function reinsertIndex(others: number, likes: number, leastLikes: number): number {
  if (others === 0) return 0
  const share = favorabilityOf(leastLikes) / favorabilityOf(likes)
  return Math.max(1, Math.min(others, Math.round(others * share)))
}

/**
 * The due that puts `playedId` back into the pool's mix list (`reinsertIndex`),
 * every other song staying where it is. Where the dues around the place are
 * too close to fit one between them, the pool's dues are spaced out again in
 * the order they have, which changes every one of them but no place.
 */
export function reinsertDue(pool: readonly QueuedSong[], playedId: number): DueChanges {
  const played = pool.find((song) => song.id === playedId)
  if (!played) return []
  const others = queueOrder(pool.filter((song) => song.id !== playedId), 'mix')
  if (others.length === 0) return []
  const leastLikes = smallest(pool, (song) => clampLikes(song.likes))
  const index = reinsertIndex(others.length, clampLikes(played.likes), leastLikes)
  const due = index === others.length
    ? others[others.length - 1].due + 1
    : (others[index - 1].due + others[index].due) / 2
  if (index === others.length || (due > others[index - 1].due && due < others[index].due)) {
    return due === played.due ? [] : [[played.id, due]]
  }
  const order = [...others.slice(0, index), played, ...others.slice(index)]
  const start = others[0].due
  const changes: DueChanges = []
  order.forEach((song, place) => { if (song.due !== start + place) changes.push([song.id, start + place]) })
  return changes
}

/** The due that puts `id` at the head of the pool's mix list. */
export function toFrontDue(pool: readonly QueuedSong[], id: number): DueChanges {
  const song = pool.find((entry) => entry.id === id)
  if (!song) return []
  const others = pool.filter((entry) => entry.id !== id)
  if (others.length === 0) return []
  const head = smallest(others, (entry) => entry.due)
  return song.due < head ? [] : [[id, head - 1]]
}

/**
 * Dues for the songs that have none: the whole library generated when no
 * song has one (most liked first, equals in a random order), each new song
 * at a random place among the others otherwise.
 */
export function settleDues(
  library: ReadonlyArray<{ id: number; likes: number; due: number | null }>,
  random: () => number = Math.random,
): DueChanges {
  const unplaced = library.filter((song) => song.due === null)
  if (unplaced.length === 0) return []
  const placed = library.filter((song) => song.due !== null).map((song) => song.due as number)
  if (placed.length === 0) {
    const keyed = library.map((song) => ({ id: song.id, likes: clampLikes(song.likes), key: random() }))
    keyed.sort((a, b) => b.likes - a.likes || a.key - b.key)
    return keyed.map((song, place) => [song.id, place])
  }
  const low = smallest(placed, (due) => due)
  const high = -smallest(placed, (due) => -due)
  // Strictly after the lowest due: the head is the song playing, and a song
  // added while it plays must not take its place.
  return unplaced.map((song) => [song.id, low + (1 - random()) * (high - low + 1)])
}

/**
 * The least of `read` over `items`. A loop rather than `Math.min(...)`,
 * which passes every item as an argument and overflows the stack on a
 * library of a hundred thousand songs.
 */
function smallest<T>(items: readonly T[], read: (item: T) => number): number {
  let least = Number.POSITIVE_INFINITY
  for (const item of items) least = Math.min(least, read(item))
  return least
}

/** `pool` with `changes` applied to its dues. */
function withDues<T extends QueuedSong>(pool: readonly T[], changes: DueChanges): T[] {
  if (changes.length === 0) return [...pool]
  const next = new Map(changes)
  return pool.map((song) => (next.has(song.id) ? { ...song, due: next.get(song.id)! } : song))
}

/** Every change of `steps`, each applied to the pool before the next is computed; the last due of a song wins. */
function compose<T extends QueuedSong>(pool: readonly T[], steps: Array<(pool: readonly T[]) => DueChanges>): { pool: T[]; changes: DueChanges } {
  let current = [...pool]
  const all = new Map<number, number>()
  for (const step of steps) {
    const changes = step(current)
    for (const [id, due] of changes) all.set(id, due)
    current = withDues(current, changes)
  }
  return { pool: current, changes: [...all] }
}

/** What a move through the queue plays, and the dues it changes. */
export interface QueueMove<T> {
  song: T | null
  changes: DueChanges
}

/**
 * NEXT: the song `currentId` is left (it ended, or the listener moved on;
 * one rule for both) and the next song plays. In a mix the left song goes
 * back in by the rule above and the head plays; in folder order the song
 * after it plays. `currentId` null starts at the head; a current song the
 * pool does not hold (the filter left it out) moves nothing.
 */
export function advance<T extends QueuedSong>(pool: readonly T[], mode: PlayMode, currentId: number | null): QueueMove<T> {
  if (pool.length === 0) return { song: null, changes: [] }
  if (mode === 'order') {
    const list = queueOrder(pool, 'order')
    const at = currentId === null ? -1 : list.findIndex((song) => song.id === currentId)
    return { song: list[(at + 1) % list.length], changes: [] }
  }
  const moved = compose(pool, currentId === null ? [] : [(songs) => reinsertDue(songs, currentId)])
  return { song: queueOrder(moved.pool, 'mix')[0], changes: moved.changes }
}

/**
 * A song CHOSEN from the list plays now: in a mix it goes to the head and
 * the song left goes back in as NEXT would put it, every other song keeping
 * its place; in folder order nothing moves and the list carries on from the
 * chosen song.
 */
export function choose<T extends QueuedSong>(pool: readonly T[], mode: PlayMode, currentId: number | null, chosenId: number): QueueMove<T> {
  const chosen = pool.find((song) => song.id === chosenId) ?? null
  if (mode === 'order' || !chosen) return { song: chosen, changes: [] }
  const steps: Array<(songs: readonly T[]) => DueChanges> = [(songs) => toFrontDue(songs, chosenId)]
  if (currentId !== null && currentId !== chosenId) steps.push((songs) => reinsertDue(songs, currentId))
  const moved = compose(pool, steps)
  return { song: moved.pool.find((song) => song.id === chosenId) ?? chosen, changes: moved.changes }
}

/**
 * PREVIOUS, in a mix: the song `currentId` was interrupted rather than
 * finished, so it goes to the head of the list, and the song gone back to
 * (from the history, `musicPlayHistory.ts`) goes in front of it, so NEXT
 * returns to the interrupted song. In folder order nothing moves.
 */
export function stepBack(pool: readonly QueuedSong[], mode: PlayMode, currentId: number | null, previousId: number): DueChanges {
  if (mode === 'order') return []
  const steps: Array<(songs: readonly QueuedSong[]) => DueChanges> = []
  if (currentId !== null && currentId !== previousId) steps.push((songs) => toFrontDue(songs, currentId))
  steps.push((songs) => toFrontDue(songs, previousId))
  return compose(pool, steps).changes
}
