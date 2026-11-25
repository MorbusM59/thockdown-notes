/**
 * MUSIC INDEXING: how far the music player has got adding a folder (a large
 * one takes a while: the tree is walked, then every new file's tags are read). The
 * Songs dock shows it as a bar while it runs (MusicLibraryDock). A store of
 * its own rather than a field of NowPlaying, which every song reader follows:
 * this changes several times a second while a scan runs and nothing else
 * needs it. The phone's player publishes it; the desktop's does not yet.
 */
export interface MusicIndexing {
  /** Files accounted for: already in the library, or read. */
  done: number
  /** Audio files found; counts up while the folder is still being listed. */
  total: number
}

let current: MusicIndexing | null = null
const listeners = new Set<() => void>()

/** The indexing under way, or null once it is over. */
export function publishMusicIndexing(next: MusicIndexing | null): void {
  if (next === current || (next && current && next.done === current.done && next.total === current.total)) return
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
