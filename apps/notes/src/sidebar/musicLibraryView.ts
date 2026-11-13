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

/** Marks a set's cell in the Music Library's selector: a drop on it adds to that set. */
export const MUSIC_SET_DROP_SLOT_ATTRIBUTE = 'data-music-set-slot'
/** Marks the selector itself: a drop on it anywhere but a set's cell (between cells, the plus) makes a new set. */
export const MUSIC_SET_DROP_NEW_ATTRIBUTE = 'data-music-set-new'

/**
 * Files and folders dropped from the file manager on the Music Library
 * (App.tsx's drop handler, which routes a drop over the sidebar's content box
 * here while the library is shown), added as the add buttons would add them,
 * a folder searched through for its audio files and anything else left out.
 * Where they go is decided by what they were dropped on: a set's cell in the
 * selector adds to that set; the rest of the selector (between the cells, or
 * the plus) to a NEW set, which is removed again if nothing in the drop was
 * audio; anywhere else in the library to the open set.
 */
export async function addDroppedFilesToMusicLibrary(files: readonly File[], target: Element | null): Promise<void> {
  const nowPlaying = readNowPlaying()
  const paths = files.map((file) => window.thockdownExternalFiles?.getPathForFile(file) ?? '').filter(Boolean)
  if (paths.length === 0) return
  const onSet = target?.closest(`[${MUSIC_SET_DROP_SLOT_ATTRIBUTE}]`)?.getAttribute(MUSIC_SET_DROP_SLOT_ATTRIBUTE)
  if (onSet) {
    await nowPlaying.addPathsToMusicSet(Number(onSet), paths)
    return
  }
  if (target?.closest(`[${MUSIC_SET_DROP_NEW_ATTRIBUTE}]`)) {
    const slot = await nowPlaying.createMusicSet()
    if (slot !== null && !await nowPlaying.addPathsToMusicSet(slot, paths)) await nowPlaying.deleteMusicSet(slot)
    return
  }
  const pickedSlot = readMusicLibrarySlot()
  const set = nowPlaying.musicSets.find((candidate) => candidate.slot === pickedSlot) ?? nowPlaying.musicSets[0]
  if (set) await nowPlaying.addPathsToMusicSet(set.slot, paths)
}
