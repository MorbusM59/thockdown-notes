// verify: reads-temp (scripts/verify.mjs, "what a module reads from disk")
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { IndexedMusicFile } from '../src/shared/audioPlayer'
import { AUDIO_EXTENSIONS } from '../src/shared/audioPlayer'
import { readAudioTags } from './audioTags'

export type MusicIndexRequest =
  | { kind: 'files'; filePaths: string[] }
  | { kind: 'folder'; folderPath: string }

export async function indexMusicRequest(request: MusicIndexRequest): Promise<IndexedMusicFile[]> {
  const filePaths = request.kind === 'folder'
    ? await audioFilesIn(request.folderPath)
    : request.filePaths.filter(isAudioFile)

  return filePaths.map((filePath) => ({
    filePath,
    ...readAudioTags(filePath),
  }))
}

async function audioFilesIn(folderPath: string): Promise<string[]> {
  const results: string[] = []
  const scan = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true })
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
