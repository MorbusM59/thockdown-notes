import type { PlaylistSlot } from '../../shared/audioPlayer'

/**
 * The ICON PICKER of the Music Library: while it is open for a set, the
 * Songs view shows every solid icon in place of the set's songs and the
 * sidebar's filter field filters the icons. A module store, because what
 * opens it (the set's mark in the dock, MusicSetRow.tsx), what shows it
 * (MusicLibraryPanel.tsx) and what closes it besides a pick (Escape and the
 * view bar, App.tsx) sit in different parts of the tree.
 *
 * The picker's query is its own, never the song filter's: the song filter is
 * simply not touched while the picker is up, so closing it finds the songs
 * filtered exactly as they were, with nothing saved and restored.
 */
export interface MusicSetIconPick {
  slot: PlaylistSlot
  query: string
}

let pick: MusicSetIconPick | null = null
const listeners = new Set<() => void>()

function publish(next: MusicSetIconPick | null): void {
  if (next === pick) return
  pick = next
  for (const listener of listeners) listener()
}

export function readMusicSetIconPick(): MusicSetIconPick | null {
  return pick
}

export function subscribeMusicSetIconPick(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Opens the picker for `slot`, with an empty query; open for it already, closes it. */
export function toggleMusicSetIconPick(slot: PlaylistSlot): void {
  publish(pick?.slot === slot ? null : { slot, query: '' })
}

export function closeMusicSetIconPick(): void {
  publish(null)
}

export function setMusicSetIconQuery(query: string): void {
  if (pick && pick.query !== query) publish({ ...pick, query })
}

/**
 * The names (`guitar`, without `fa-`) of the icons a query keeps: every word
 * of it must appear in the icon's name or in its search words, so "music"
 * finds a guitar as well as the music note.
 */
export function filterSolidIcons(catalog: ReadonlyArray<readonly [string, string]>, query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return catalog
    .filter(([name, terms]) => words.every((word) => name.includes(word) || terms.includes(word)))
    .map(([name]) => name)
}
