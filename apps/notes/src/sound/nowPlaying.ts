/**
 * The song that is playing and the two ways to change it, published by the
 * music player (`components/AudioControls.tsx`, which owns the song, the
 * play history and the rules for what "previous" and "next" mean) for
 * anything elsewhere in the window that shows or steers it -- the visualizer
 * mode's now-playing strip. Position and seeking need no port: they are the
 * player service's own (`musicPlayerService.currentTime`, `setCurrentTime`).
 */

import type { MusicSongEntry } from '../shared/audioPlayer'

export type NowPlaying = {
  song: MusicSongEntry | null
  /** -1 walks back through what was played; 1 picks the next song, as the transport's own buttons do. */
  jumpSong: (direction: -1 | 1) => void
}

let current: NowPlaying = { song: null, jumpSong: () => {} }
const listeners = new Set<() => void>()

/** Called by the music player whenever the song or its actions change. */
export function publishNowPlaying(next: NowPlaying): void {
  if (next.song === current.song && next.jumpSong === current.jumpSong) return
  current = next
  for (const listener of listeners) listener()
}

export function readNowPlaying(): NowPlaying {
  return current
}

/** For `useSyncExternalStore`. */
export function subscribeNowPlaying(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
