/**
 * The pool filter as it stands in the visualizer's fields, which can be ahead
 * of the one playback reads (`NowPlaying.pool.filter`): the song list follows
 * every keystroke, the next pick only what was COMMITTED, when the reader
 * left a field. Null until a field is edited, meaning "the committed filter";
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

/** Hand the draft to playback (`NowPlaying.setPoolFilter`, which ignores an unchanged filter). */
export function commitPoolFilterDraft(): void {
  if (draft) readNowPlaying().setPoolFilter(draft)
}

export function subscribePoolFilterDraft(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
