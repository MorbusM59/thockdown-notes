/**
 * ADDING A FOLDER, in the two phases the Songs dock's bar shows one after
 * the other (musicIndexing.ts): SCANNING walks the tree a few folders a
 * call, then INDEXING reads the tags of the songs new to the library
 * (songFacts.ts), the dock told after every call and every song. The songs
 * reach the library as they are found (`onSongs`): those already in it once
 * the tree is listed, each new one as soon as it is read.
 *
 * Scanning counts FOLDERS: listed, of those found so far (the total rises as
 * subfolders turn up). Each folder is a round trip to the documents
 * provider: about ten seconds for 500 folders on a device, which in one call
 * held the bar at 0 / 0 for all of it. Indexing counts SONGS: accounted for,
 * either already in the library (nothing to read) or read, of every audio
 * file found.
 */
import type { MusicIndexing } from '@thockdown/visualizer/sound/musicIndexing'
import type { NativeMusicPlugin, ScannedSong } from './nativeMusic'
import { describeSongs } from './songFacts'

/** Folders listed per call: enough that the bridge's round trip is not the cost, few enough that the bar moves. */
export const LIST_BATCH = 8

export interface FolderScan {
  /** Every audio file in the tree. */
  paths: string[]
  /** The files that were not in `known`, described. */
  added: ScannedSong[]
}

export async function scanFolder(
  plugin: Pick<NativeMusicPlugin, 'listFolders' | 'readSongRanges' | 'closeSongs'>,
  uri: string,
  known: ReadonlySet<string>,
  publish: (progress: MusicIndexing) => void,
  onSongs: (paths: readonly string[], added: readonly ScannedSong[]) => void,
): Promise<FolderScan> {
  const paths: string[] = []
  const fresh: string[] = []
  // The tree's root is the first folder found; a call naming no folder lists it.
  let found = 1
  let listed = 0
  let pending: string[] = []
  publish({ scanning: { done: 0, total: found }, indexing: null })
  while (listed < found) {
    const batch = pending.slice(0, LIST_BATCH)
    const step = await plugin.listFolders({ uri, folders: batch })
    listed += Math.max(1, batch.length)
    found += step.folders.length
    pending = [...pending.slice(LIST_BATCH), ...step.folders]
    for (const path of step.paths) {
      paths.push(path)
      if (!known.has(path)) fresh.push(path)
    }
    publish({ scanning: { done: listed, total: found }, indexing: null })
  }
  const scanning = { done: listed, total: found }
  const alreadyKnown = paths.length - fresh.length
  publish({ scanning, indexing: { done: alreadyKnown, total: paths.length } })
  onSongs(paths, [])
  const added = await describeSongs(plugin, fresh, (song, done) => {
    onSongs([], [song])
    publish({ scanning, indexing: { done: alreadyKnown + done, total: paths.length } })
  })
  return { paths, added }
}
