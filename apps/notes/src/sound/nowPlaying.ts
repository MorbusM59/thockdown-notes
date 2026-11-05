/**
 * The song that is playing and the two ways to change it, published by the
 * music player (`components/AudioControls.tsx`, which owns the song, the
 * play history and the rules for what "previous" and "next" mean) for
 * anything elsewhere in the window that shows or steers it -- the visualizer
 * mode's now-playing strip. Position and seeking need no port: they are the
 * player service's own (`musicPlayerService.currentTime`, `setCurrentTime`).
 */

import type { MusicPoolFilter, MusicSongEntry, PlaylistCountsResult, PlaylistSlot } from '../shared/audioPlayer'

export type NowPlaying = {
  song: MusicSongEntry | null
  /** -1 walks back through what was played; 1 picks the next song, as the transport's own buttons do. */
  jumpSong: (direction: -1 | 1) => void
  /**
   * What the pool is drawn from: the active slots, the filter the next pick
   * applies (`matchesPoolFilter`), and the slot counts, a new
   * object whenever songs were added or removed. A reader of the pool's ORDER
   * (`getPool`) re-reads it when this or `song` changes, which covers every
   * write to it: a song finishing, being skipped or (un)favourited always
   * hands over a new `song`.
   */
  pool: { slots: readonly PlaylistSlot[]; counts: PlaylistCountsResult; filter: MusicPoolFilter } | null
  /** Play a song of the pool now, rotating the pool's order to it (`shared/musicPool.ts`). */
  playFromPool: (id: number) => void
  /** Take a bucket in or out of the pool, as its button in the music bar does. */
  toggleSlot: (slot: PlaylistSlot) => void
  /** The music's volume, reverb amount and reverb room, each a fraction 0..1 (what is resumed while muted or bypassed). */
  levels: SoundLevels
  /** Set one of them, as the music bar's own controls do: adjusting a muted volume or a bypassed reverb turns it back on. */
  setLevel: (level: keyof SoundLevels, fraction: number) => void
  /** Commit a filter: the next pick, and a song chosen from the pool, read it. The song playing plays on. */
  setPoolFilter: (filter: MusicPoolFilter) => void
}

export type SoundLevels = { volume: number; reverb: number; room: number }

let current: NowPlaying = { song: null, jumpSong: () => {}, pool: null, playFromPool: () => {}, toggleSlot: () => {}, setPoolFilter: () => {}, levels: { volume: 0, reverb: 0, room: 0 }, setLevel: () => {} }
const listeners = new Set<() => void>()

/** Called by the music player whenever the song or its actions change. */
export function publishNowPlaying(next: NowPlaying): void {
  if (next.song === current.song && next.jumpSong === current.jumpSong && next.pool === current.pool && next.playFromPool === current.playFromPool && next.toggleSlot === current.toggleSlot && next.setPoolFilter === current.setPoolFilter && next.levels === current.levels && next.setLevel === current.setLevel) return
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
