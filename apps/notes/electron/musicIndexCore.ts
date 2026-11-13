// verify: reads-temp (scripts/verify.mjs, "what a module reads from disk")
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { IndexedMusicFile } from '../src/shared/audioPlayer'
import { AUDIO_EXTENSIONS } from '../src/shared/audioPlayer'
import { readAudioDuration } from './audioDuration'
import { readAudioTags } from './audioTags'

/**
 * Paths to add to the library, files and folders alike, whichever way they
 * arrived (the file dialog, the folder dialog, a drop from the file manager):
 * a folder is searched through for its audio files, a file is taken if it is
 * one, and a path that cannot be read is skipped.
 */
export type MusicIndexRequest = { paths: string[] }

export async function indexMusicRequest(request: MusicIndexRequest): Promise<IndexedMusicFile[]> {
  const filePaths: string[] = []
  for (const entry of request.paths) {
    let stats
    try {
      stats = await fs.stat(entry)
    } catch {
      continue
    }
    if (stats.isDirectory()) filePaths.push(...await audioFilesIn(entry))
    else if (stats.isFile() && isAudioFile(entry)) filePaths.push(entry)
  }

  return filePaths.map((filePath) => ({
    filePath,
    ...readAudioTags(filePath),
    // 0 when the file does not say (`MusicSongEntry.durationSec`).
    durationSec: readAudioDuration(filePath) ?? 0,
  }))
}

async function audioFilesIn(folderPath: string): Promise<string[]> {
  const results: string[] = []
  const scan = async (directory: string): Promise<void> => {
    // A folder that cannot be read (a protected system folder, a broken
    // junction) is skipped, so one of them never costs the rest of the tree.
    let entries
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await scan(filePath)
      } else if (entry.isFile() && isAudioFile(filePath)) {
        results.push(filePath)
      }
    }
  }
  await scan(folderPath)
  return results
}

function isAudioFile(filePath: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}
