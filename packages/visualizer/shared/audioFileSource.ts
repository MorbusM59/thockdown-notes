/**
 * A song's file as the tag and duration readers see it (audioTags.ts,
 * audioDuration.ts): its size, and bytes read at an offset. Both apps read
 * songs with the same readers and differ only in this: the desktop serves a
 * read from the file system (apps/notes/electron/fileAudioSource.ts), the
 * phone from the documents provider, many songs' reads gathered into one
 * call to the native side (apps/soundscapes/src/songFacts.ts).
 *
 * A read is ASYNCHRONOUS because the phone's crosses the bridge. The readers
 * read a header, decide and skip, so a song costs a handful of reads, and
 * `readAheadSource` turns most of those into one: every read past what it
 * holds fetches at least `readAhead` bytes, so the headers that follow one
 * another at a file's start (an ID3v2 tag's frames, FLAC's metadata blocks,
 * the first MP3 frame) come in the first fetch.
 */

export interface AudioFileSource {
  /** The file's length in bytes. */
  readonly size: number
  /** Up to `length` bytes at `offset`: fewer at the end of the file, none past it. */
  read(offset: number, length: number): Promise<Uint8Array>
}

/** Fetches `length` bytes at `offset` (fewer at the end of the file). */
export type FetchBytes = (offset: number, length: number) => Promise<Uint8Array>

/** Ranges kept: a song's reads cluster at its start and its end, with one or two jumps between (past cover art, to `moov`). */
const KEPT_RANGES = 6

/**
 * `fetch` behind a cache of the last few ranges it fetched, each at least
 * `readAhead` bytes; `first` is a range already fetched (the read that
 * learned the file's size).
 */
export function readAheadSource(size: number, fetch: FetchBytes, readAhead: number, first?: { offset: number; bytes: Uint8Array }): AudioFileSource {
  const kept: Array<{ offset: number; bytes: Uint8Array }> = first ? [first] : []
  return {
    size,
    async read(offset, length) {
      const end = Math.min(size, offset + Math.max(0, length))
      if (end <= offset) return new Uint8Array(0)
      for (const range of kept) {
        if (offset >= range.offset && end <= range.offset + range.bytes.length) {
          return range.bytes.subarray(offset - range.offset, end - range.offset)
        }
      }
      const bytes = await fetch(offset, Math.min(size - offset, Math.max(end - offset, readAhead)))
      kept.unshift({ offset, bytes })
      if (kept.length > KEPT_RANGES) kept.pop()
      return bytes.subarray(0, Math.min(bytes.length, end - offset))
    },
  }
}

/** Fixed-width numbers and text in a block of bytes. Reads past the block's end answer 0 / fewer characters, never throw. */
export class Bytes {
  constructor(readonly data: Uint8Array) {}

  get length(): number {
    return this.data.length
  }

  at(index: number): number {
    return this.data[index] ?? 0
  }

  sub(from: number, to = this.data.length): Bytes {
    return new Bytes(this.data.subarray(Math.max(0, from), Math.max(0, to)))
  }

  u16le(at: number): number {
    return this.at(at) | (this.at(at + 1) << 8)
  }

  u24be(at: number): number {
    return (this.at(at) << 16) | (this.at(at + 1) << 8) | this.at(at + 2)
  }

  u32be(at: number): number {
    return ((this.at(at) << 24) >>> 0) + (this.at(at + 1) << 16) + (this.at(at + 2) << 8) + this.at(at + 3)
  }

  u32le(at: number): number {
    return ((this.at(at + 3) << 24) >>> 0) + (this.at(at + 2) << 16) + (this.at(at + 1) << 8) + this.at(at)
  }

  /** As a Number: exact to 2^53, past any file or sample count there is. */
  u64be(at: number): number {
    return this.u32be(at) * 2 ** 32 + this.u32be(at + 4)
  }

  u64le(at: number): number {
    return this.u32le(at + 4) * 2 ** 32 + this.u32le(at)
  }

  /** One character per byte (ISO-8859-1, as Node's `latin1`: every byte its own code point). */
  latin1(from = 0, to = this.data.length): string {
    let text = ''
    const end = Math.min(to, this.data.length)
    for (let index = Math.max(0, from); index < end; index += 1) text += String.fromCharCode(this.data[index])
    return text
  }

  utf8(from = 0, to = this.data.length): string {
    return UTF8.decode(this.data.subarray(Math.max(0, from), Math.max(0, Math.min(to, this.data.length))))
  }

  /** UTF-16 of either byte order; an odd last byte is left out. */
  utf16(littleEndian: boolean, from = 0, to = this.data.length): string {
    const end = Math.min(to, this.data.length)
    const even = end - ((end - from) % 2)
    return (littleEndian ? UTF16LE : UTF16BE).decode(this.data.subarray(Math.max(0, from), Math.max(0, even)))
  }

  /** Where the ASCII `text` last occurs, or -1. */
  lastIndexOf(text: string): number {
    outer: for (let index = this.data.length - text.length; index >= 0; index -= 1) {
      for (let offset = 0; offset < text.length; offset += 1) {
        if (this.data[index + offset] !== text.charCodeAt(offset)) continue outer
      }
      return index
    }
    return -1
  }
}

const UTF8 = new TextDecoder('utf-8')
const UTF16LE = new TextDecoder('utf-16le')
const UTF16BE = new TextDecoder('utf-16be')

/** `source`'s bytes at `offset`, as `Bytes`. */
export async function readBytes(source: AudioFileSource, offset: number, length: number): Promise<Bytes> {
  return new Bytes(await source.read(offset, length))
}
