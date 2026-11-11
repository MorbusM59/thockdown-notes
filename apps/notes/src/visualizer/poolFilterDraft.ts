/**
 * The pool filter as it stands in the visualizer's field, which can be ahead
 * of the one playback reads (`NowPlaying.pool.filter`): the song list follows
 * every keystroke, the next pick only what was COMMITTED, when the reader
 * leaves the field. Null until it is edited, meaning "the committed filter";
 * after a commit the two are equal, so nothing is ever reset.
 */

import { EMPTY_POOL_FILTER, samePoolFilter, type MusicPoolFilter } from '../shared/audioPlayer'
import { readNowPlaying } from '../sound/nowPlaying'

let draft: MusicPoolFilter | null = null
const listeners = new Set<() => void>()

/** The filter the song list shows: the draft, or the committed one. */
export function readShownPoolFilter(): MusicPoolFilter {
  return draft ?? readNowPlaying().pool?.filter ?? EMPTY_POOL_FILTER
}

export function setPoolFilterDraft(next: MusicPoolFilter): void {
  if (draft && samePoolFilter(draft, next)) return
  draft = next
  for (const listener of listeners) listener()
}

/**
 * Hand the draft to playback (`NowPlaying.setPoolFilter`, which ignores an
 * unchanged filter). A changed filter also plays the first song of the song
 * list it leaves: the playing song when it is still in the pool (it heads
 * the list, so nothing changes), otherwise the pool's first song in pick
 * order (`playFirstRemaining`).
 */
export function commitPoolFilterDraft(): void {
  if (!draft) return
  const committed = readNowPlaying().pool?.filter ?? EMPTY_POOL_FILTER
  readNowPlaying().setPoolFilter(draft)
  if (!samePoolFilter(draft, committed)) void playFirstRemaining(draft)
}

/**
 * Bumped by every request to play something from the visualizer, so the
 * pool lookup a commit starts cannot override a song the reader chose while
 * it was in flight (a press on the song list commits the filter and then
 * plays its own choice).
 */
let playRequest = 0

/** Say that the caller is about to play a song of its own choosing. */
export function claimPlayback(): void {
  playRequest += 1
}

async function playFirstRemaining(filter: MusicPoolFilter): Promise<void> {
  const request = ++playRequest
  const pool = readNowPlaying().pool
  if (!pool) return
  const songs = await window.thockdownAudioPlayer?.getPool({ slots: [...pool.slots], filter }) ?? []
  if (request !== playRequest || songs.length === 0) return
  const { song, playFromPool } = readNowPlaying()
  if (song && songs.some((entry) => entry.id === song.id)) return
  playFromPool(songs[0].id)
}

type PoolFilterField = keyof MusicPoolFilter

/** What the mounted filter field offers the keyboard handling in App.tsx. */
export interface PoolFilterFields {
  /** The field holding the keyboard, if any. */
  focused(): PoolFilterField | null
  /** Give the field the keyboard, its caret at the end. */
  focus(field: PoolFilterField): void
  /**
   * Append `text` to the query and give it the keyboard, its caret at the end.
   * `fresh` empties the filter first, so the text starts a new search.
   */
  type(field: PoolFilterField, text: string, fresh: boolean): void
}

let fields: PoolFilterFields | null = null

export function registerPoolFilterFields(api: PoolFilterFields): () => void {
  fields = api
  return () => { if (fields === api) fields = null }
}

/** The mounted filter field, or null while the visualizer has none. */
export function readPoolFilterFields(): PoolFilterFields | null {
  return fields
}

export function subscribePoolFilterDraft(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
