/**
 * MUSIC INDEXING: how far the music player has got adding a folder, in its
 * two phases, one after the other: SCANNING walks the folder tree to find
 * the audio files (each folder a round trip to where the files are kept),
 * then INDEXING reads the tags of the files new to the library (a few tens of
 * milliseconds a file). The Songs dock shows each as a bar while it runs
 * (MusicLibraryDock). A store of its own rather than a field of NowPlaying,
 * which every song reader follows: this changes several times a second while
 * a folder is added and nothing else needs it. The phone's player publishes
 * it; the desktop's does not yet.
 */
export interface MusicProgress {
  done: number
  total: number
}

export interface MusicIndexing {
  /** Folders listed of the folders found; the total counts up as subfolders turn up. */
  scanning: MusicProgress
  /** Songs accounted for (already in the library, or read) of the audio files found; null until scanning is over. */
  indexing: MusicProgress | null
}

let current: MusicIndexing | null = null
const listeners = new Set<() => void>()

function sameProgress(a: MusicProgress | null, b: MusicProgress | null): boolean {
  return a === b || (a !== null && b !== null && a.done === b.done && a.total === b.total)
}

/** The indexing under way, or null once it is over. */
export function publishMusicIndexing(next: MusicIndexing | null): void {
  if (next === current || (next && current && sameProgress(next.scanning, current.scanning) && sameProgress(next.indexing, current.indexing))) return
  current = next
  for (const listener of listeners) listener()
}

export function readMusicIndexing(): MusicIndexing | null {
  return current
}

export function subscribeMusicIndexing(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
