/**
 * ADDING A FOLDER: the tree is walked a few folders a call, then the songs
 * new to the library have their tags read in batches, and the Songs dock's
 * indexing bar (musicIndexing.ts) is told after every call.
 *
 * The bar counts FILES: `total` is every audio file found so far, so it
 * counts up while the tree is still being walked, and `done` is those
 * accounted for, either already in the library (nothing to read) or read.
 * Walking is the native side's round trip per folder to the documents
 * provider, which on a large library takes long enough to be seen; done in
 * one call, it held the bar at 0 / 0 for all of it.
 */
import type { MusicIndexing } from '@thockdown/visualizer/sound/musicIndexing'
import type { NativeMusicPlugin, ScannedSong } from './nativeMusic'

/** Folders listed per call: enough that the bridge's round trip is not the cost, few enough that the count moves. */
export const LIST_BATCH = 8
/** Songs described per call: their tags take a few tens of milliseconds each. */
export const DESCRIBE_BATCH = 16

export interface FolderScan {
  /** Every audio file in the tree. */
  paths: string[]
  /** The files that were not in `known`, described. */
  added: ScannedSong[]
}

export async function scanFolder(
  plugin: Pick<NativeMusicPlugin, 'listFolders' | 'describeSongs'>,
  uri: string,
  known: ReadonlySet<string>,
  publish: (progress: MusicIndexing) => void,
): Promise<FolderScan> {
  const paths: string[] = []
  const fresh: string[] = []
  publish({ done: 0, total: 0 })
  // The first call names no folder: that is the tree's root.
  let pending: string[] = []
  let first = true
  while (first || pending.length > 0) {
    first = false
    const step = await plugin.listFolders({ uri, folders: pending.slice(0, LIST_BATCH) })
    pending = [...pending.slice(LIST_BATCH), ...step.folders]
    for (const path of step.paths) {
      paths.push(path)
      if (!known.has(path)) fresh.push(path)
    }
    publish({ done: paths.length - fresh.length, total: paths.length })
  }
  const added: ScannedSong[] = []
  for (let start = 0; start < fresh.length; start += DESCRIBE_BATCH) {
    const batch = await plugin.describeSongs({ paths: fresh.slice(start, start + DESCRIBE_BATCH) })
    added.push(...batch.added)
    publish({ done: paths.length - fresh.length + Math.min(fresh.length, start + DESCRIBE_BATCH), total: paths.length })
  }
  return { paths, added }
}
