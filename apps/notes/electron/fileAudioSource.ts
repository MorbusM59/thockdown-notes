// verify: reads-temp (scripts/verify.mjs, "what a module reads from disk")
/**
 * A song file on disk as the shared tag and duration readers take it
 * (@thockdown/visualizer/shared/audioFileSource.ts): each read is one
 * positional read of the open file, which the operating system answers from
 * its cache, so nothing is read ahead.
 */

import { promises as fs } from 'node:fs'
import type { AudioFileSource } from '@thockdown/visualizer/shared/audioFileSource'

/** `read` given the file at `filePath`, closed after; null when it cannot be opened. */
export async function withFileAudioSource<T>(filePath: string, read: (source: AudioFileSource) => Promise<T>): Promise<T | null> {
  let handle: fs.FileHandle
  try {
    handle = await fs.open(filePath, 'r')
  } catch {
    return null
  }
  try {
    const { size } = await handle.stat()
    return await read({
      size,
      async read(offset, length) {
        const wanted = Math.max(0, Math.min(length, size - offset))
        if (wanted === 0) return new Uint8Array(0)
        const buffer = new Uint8Array(wanted)
        const { bytesRead } = await handle.read(buffer, 0, wanted, offset)
        return buffer.subarray(0, bytesRead)
      },
    })
  } finally {
    await handle.close()
  }
}
