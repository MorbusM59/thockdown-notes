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
export type MusicSetListView = { slot: PlaylistSlot | null; filter: string }

let view: MusicSetListView = { slot: null, filter: '' }
const listeners = new Set<() => void>()

function publish(next: MusicSetListView): void {
  if (next.slot === view.slot && next.filter === view.filter) return
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
export function openMusicSetList(slot: PlaylistSlot): void {
  publish({ slot, filter: view.slot === slot ? view.filter : '' })
}

export function closeMusicSetList(): void {
  publish({ slot: null, filter: '' })
}

export function setMusicSetListFilter(filter: string): void {
  publish({ ...view, filter })
}
