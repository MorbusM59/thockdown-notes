/**
 * What the shared music views READ of the music library -- a set's songs (the
 * Songs panel) and the pool in pick order (the visualizer's song list and
 * pool filter) -- as a port each app supplies: the desktop its main process's
 * library (`window.thockdownAudioPlayer`), the phone its catalog
 * (apps/soundscapes/src/mobileMusicPlayer.ts). Everything the views CHANGE goes
 * through NowPlaying (`sound/nowPlaying.ts`), so this is all they read.
 */
import type { AudioPlayerApi } from './audioPlayer'

export type MusicLibraryReads = Pick<AudioPlayerApi, 'getPlaylist' | 'getPool'> & {
  /** A file dropped from the file manager as a path the library can add, or '' (a platform with no file paths supplies none). */
  pathOfFile?: (file: File) => string
}

let current: MusicLibraryReads | null = null

/** Set once at start-up, before any view reads. */
export function setMusicLibraryReads(reads: MusicLibraryReads | null): void {
  current = reads
}

/** The library's reads, or null before an app has supplied them. */
export function musicLibraryReads(): MusicLibraryReads | null {
  return current
}
