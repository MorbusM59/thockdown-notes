/**
 * A song's title, artist, album and length, read on the phone by THE
 * DESKTOP'S OWN READERS (packages/visualizer/shared/audioTags.ts,
 * audioDuration.ts): a handful of small header reads a song, where the
 * platform's media extractor probed each file whole and took minutes for a
 * library of a few thousand songs.
 *
 * Every read crosses the bridge to the native side (MusicFolders.readSongs),
 * so the reads are GATHERED: many songs are read at once, each asking for
 * its next range as soon as it has the last, and every range asked for in
 * the same turn of the event loop goes over in one call. A round trip then
 * carries one read for each song in flight, and a song costs as many round
 * trips as its readers take steps (two or three, `READ_AHEAD_BYTES` holding
 * most of a file's headers), not as many as it has reads. A finished song's
 * file is closed with the next round, not by a call of its own.
 */
import { readAudioDuration } from '@thockdown/visualizer/shared/audioDuration'
import { readAheadSource } from '@thockdown/visualizer/shared/audioFileSource'
import { readAudioTags } from '@thockdown/visualizer/shared/audioTags'
import type { NativeMusicPlugin, ScannedSong } from './nativeMusic'

/** Bytes fetched by a read past what a song's source holds: an ID3v2 tag's text frames, FLAC's blocks or an MP3's first frame, in one. */
export const READ_AHEAD_BYTES = 4096
/** Songs read at once: enough that a round trip carries dozens of reads, few enough that the native side's open files stay few. */
export const SONGS_IN_FLIGHT = 32

type SongReadsPlugin = Pick<NativeMusicPlugin, 'readSongRanges' | 'closeSongs'>

interface Pending {
  read: { path: string; offset: number; length: number }
  resolve: (answer: { size: number; bytes: Uint8Array }) => void
  reject: (error: Error) => void
}

/** Reads asked for in one turn of the event loop, sent as one call. */
class GatheredReads {
  private pending: Pending[] = []
  /** Songs finished with, closed by the native side after the next round's reads. */
  private closing: string[] = []
  private scheduled = false

  constructor(private readonly plugin: SongReadsPlugin) {}

  read(path: string, offset: number, length: number): Promise<{ size: number; bytes: Uint8Array }> {
    return new Promise((resolve, reject) => {
      this.pending.push({ read: { path, offset, length }, resolve, reject })
      if (this.scheduled) return
      this.scheduled = true
      setTimeout(() => void this.flush(), 0)
    })
  }

  /** `path` is read no more: closed with the next round, or by `closeRest`. */
  close(path: string): void {
    this.closing.push(path)
  }

  /** Close what no round carried. */
  async closeRest(): Promise<void> {
    if (this.closing.length === 0) return
    const paths = this.closing
    this.closing = []
    await this.plugin.closeSongs({ paths })
  }

  private async flush(): Promise<void> {
    const round = this.pending
    const close = this.closing
    this.pending = []
    this.closing = []
    this.scheduled = false
    try {
      const { results } = await this.plugin.readSongRanges({ reads: round.map((entry) => entry.read), close })
      round.forEach((entry, index) => {
        const result = results[index]
        if (!result || result.size < 0) entry.reject(new Error(`Could not read ${entry.read.path}`))
        else entry.resolve({ size: result.size, bytes: fromBase64(result.data ?? '') })
      })
    } catch (error) {
      for (const entry of round) entry.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * The songs at `paths`, described, in their order. `onSong` is told of each
 * song as it is described, with how many are done, so the list and the bar
 * can follow song by song (their listeners draw at most once a frame).
 */
export async function describeSongs(
  plugin: SongReadsPlugin,
  paths: readonly string[],
  onSong: (song: ScannedSong, done: number) => void,
): Promise<ScannedSong[]> {
  const described: ScannedSong[] = new Array(paths.length)
  let done = 0
  const reads = new GatheredReads(plugin)
  // Whatever a page reloaded mid-scan left open is let go.
  await plugin.closeSongs({})
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < paths.length) {
      const index = next++
      described[index] = await describe(reads, paths[index])
      done += 1
      onSong(described[index], done)
    }
  }
  await Promise.all(Array.from({ length: Math.min(SONGS_IN_FLIGHT, paths.length) }, worker))
  await reads.closeRest()
  return described
}

const UNREAD = { title: '', artist: '', album: '', durationSec: 0 }

async function describe(reads: GatheredReads, path: string): Promise<ScannedSong> {
  try {
    const first = await reads.read(path, 0, READ_AHEAD_BYTES)
    const source = readAheadSource(first.size, async (offset, length) => (await reads.read(path, offset, length)).bytes, READ_AHEAD_BYTES, { offset: 0, bytes: first.bytes })
    const tags = await readAudioTags(source)
    // 0 when the file does not say (`MusicSongEntry.durationSec`), as on the desktop.
    return { filePath: path, ...tags, durationSec: (await readAudioDuration(source)) ?? 0 }
  } catch {
    // A song that cannot be opened is listed with no tags, as the desktop lists one.
    return { filePath: path, ...UNREAD }
  } finally {
    reads.close(path)
  }
}
