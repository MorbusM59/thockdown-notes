import { readNowPlaying } from '../sound/nowPlaying'
import type { PlaylistSlot } from '../shared/audioPlayer'

/**
 * Which music set the MUSIC LIBRARY shows. The Music Library is the sidebar's
 * Songs view (MusicLibraryPanel.tsx): the music sets as its sections and the
 * open set's songs below them. A module store because the things that pick a
 * set sit in three different parts of the tree: the library's own selector,
 * the count buttons in Options > Music > Sets, and a held right press on a
 * set button of the music player.
 *
 * `null` means no set was ever picked; the library then shows the first set,
 * and it does the same when the remembered set no longer exists. App.tsx
 * persists the value and restores it at start-up.
 */
let slot: PlaylistSlot | null = null
const listeners = new Set<() => void>()
let showLibrary: (() => void) | null = null

export function readMusicLibrarySlot(): PlaylistSlot | null {
  return slot
}

export function subscribeMusicLibrarySlot(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Makes `next` the set the library shows, without bringing the library up. */
export function selectMusicLibrarySet(next: PlaylistSlot | null): void {
  if (next === slot) return
  slot = next
  for (const listener of listeners) listener()
}

/**
 * Brings the Music Library up in the sidebar: on `next`, or on the set it
 * last showed when none is given. The sidebar is App.tsx's, which registers
 * how to show the Songs view; before it has, only the set is recorded.
 */
export function openMusicLibrary(next?: PlaylistSlot): void {
  if (next !== undefined) selectMusicLibrarySet(next)
  showLibrary?.()
}

/** App.tsx's way of showing the Songs view; returns the unregistration. */
export function registerMusicLibraryPresenter(present: () => void): () => void {
  showLibrary = present
  return () => {
    if (showLibrary === present) showLibrary = null
  }
}

/**
 * Files and folders dropped from the file manager anywhere on the Music
 * Library (App.tsx's drop handler, which routes a drop over the sidebar's
 * content box here while the library is shown): added to the open set as the
 * row's two add buttons would add them, a folder searched through for its
 * audio files and anything else left out.
 */
export function addDroppedFilesToOpenMusicSet(files: readonly File[]): void {
  const nowPlaying = readNowPlaying()
  const pickedSlot = readMusicLibrarySlot()
  const set = nowPlaying.musicSets.find((candidate) => candidate.slot === pickedSlot) ?? nowPlaying.musicSets[0]
  const paths = files.map((file) => window.thockdownExternalFiles?.getPathForFile(file) ?? '').filter(Boolean)
  if (set && paths.length > 0) void nowPlaying.addPathsToMusicSet(set.slot, paths)
}
