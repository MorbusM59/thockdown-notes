import type { PlaylistSlot } from '../shared/audioPlayer'

/**
 * Whether the SET LIST is up, which set it shows, and its filter. The list
 * replaces the options panel in the sidebar (App.tsx draws it while the
 * sidebar is in options mode and a set is open) and its dock replaces the
 * colour picker's; the count button in Music > Sets opens it and the dock's
 * exit button closes it. A module store because the opener, the list and the
 * dock sit in three different parts of the tree. Not persisted: a restart
 * comes back to Options.
 */
export type MusicSetListView = {
  slot: PlaylistSlot | null
  filter: string
  /**
   * Where the list was opened from. From the PLAYER (a held right press on a
   * set button) the sidebar may have been showing anything, or been hidden,
   * so closing the list puts it back as it was (App.tsx); from OPTIONS it
   * simply returns to Options.
   */
  origin: MusicSetListOrigin
}

export type MusicSetListOrigin = 'options' | 'player'

let view: MusicSetListView = { slot: null, filter: '', origin: 'options' }
const listeners = new Set<() => void>()

function publish(next: MusicSetListView): void {
  if (next.slot === view.slot && next.filter === view.filter && next.origin === view.origin) return
  view = next
  for (const listener of listeners) listener()
}

export function readMusicSetListView(): MusicSetListView {
  return view
}

export function subscribeMusicSetListView(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Opens the list on `slot`, or switches it there; a new set starts unfiltered. */
export function openMusicSetList(slot: PlaylistSlot, origin: MusicSetListOrigin = 'options'): void {
  // Switching sets inside an open list keeps where the list was opened from.
  publish({ slot, filter: view.slot === slot ? view.filter : '', origin: view.slot === null ? origin : view.origin })
}

export function closeMusicSetList(): void {
  publish({ slot: null, filter: '', origin: 'options' })
}

export function setMusicSetListFilter(filter: string): void {
  publish({ ...view, filter })
}
