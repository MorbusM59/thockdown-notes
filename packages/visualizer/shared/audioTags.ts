/**
 * Reads a song's title, artist and album from the tags in its file, for the
 * music library of both apps (the desktop's electron/musicIndexCore.ts, the
 * phone's songFacts.ts), through an `AudioFileSource` (audioFileSource.ts).
 *
 * Written here rather than taken from a tag library because three fields are
 * all the app needs, and every format that carries them stores them in one of
 * five simple containers: ID3v2 (MP3, raw AAC, and an `id3 ` chunk in WAV),
 * ID3v1 (the last 128 bytes of an MP3), Vorbis comments (FLAC, Ogg Vorbis,
 * Opus), the MP4 `ilst` atom (M4A), and RIFF `LIST/INFO` (WAV). Matroska
 * (WebM) is not read: its tags sit behind EBML element walking for a format
 * almost nobody keeps music in, so a WebM song reads as having no tags.
 *
 * THE FILE IS READ PIECE BY PIECE, never whole: every container here is a
 * sequence of length-prefixed blocks, so the reader takes a header, decides,
 * and skips. Embedded cover art (often megabytes, and allowed anywhere in an
 * ID3v2 tag) is stepped over rather than read. Each read is bounded by
 * `MAX_BLOCK_BYTES`, so a corrupt length cannot make it allocate the file.
 *
 * A missing or unreadable field is the empty string; how that is SHOWN is
 * audioPlayer.ts's (`songTitleText` and friends).
 */

import { Bytes, type AudioFileSource } from './audioFileSource'

export type AudioTags = { title: string; artist: string; album: string }

const EMPTY: AudioTags = { title: '', artist: '', album: '' }
/** The largest single block read into memory. Text tags are tiny; this only stops a corrupt length. */
const MAX_BLOCK_BYTES = 1 << 20

/** The tags in `source`. Never rejects: an unreadable file has no tags. */
export async function readAudioTags(source: AudioFileSource): Promise<AudioTags> {
  try {
    return clean(await readAny(new TagFile(source)))
  } catch {
    return { ...EMPTY }
  }
}

class TagFile {
  constructor(private readonly source: AudioFileSource) {}
  get size(): number {
    return this.source.size
  }
  /** Up to `length` bytes at `offset` (fewer at the end of the file), at most MAX_BLOCK_BYTES. */
  async read(offset: number, length: number): Promise<Bytes> {
    return new Bytes(await this.source.read(offset, Math.max(0, Math.min(length, MAX_BLOCK_BYTES))))
  }
}

async function readAny(file: TagFile): Promise<AudioTags> {
  const head = await file.read(0, 12)
  const magic4 = head.latin1(0, 4)
  if (head.latin1(0, 3) === 'ID3') {
    // The ID3v1 tag at the file's end only fills what the v2 tag lacks: read only then, a read saved for nearly every song.
    const v2 = await readId3v2(file, 0)
    return v2.title && v2.artist && v2.album ? v2 : merge(v2, await readId3v1(file))
  }
  if (magic4 === 'fLaC') return readFlac(file)
  if (magic4 === 'OggS') return readOgg(file)
  if (magic4 === 'RIFF' && head.latin1(8, 12) === 'WAVE') return readRiff(file)
  if (head.latin1(4, 8) === 'ftyp') return readMp4(file)
  return readId3v1(file)
}

/** `a`'s fields, with `b`'s filling the ones `a` lacks. */
function merge(a: AudioTags, b: AudioTags): AudioTags {
  return { title: a.title || b.title, artist: a.artist || b.artist, album: a.album || b.album }
}

function clean(tags: AudioTags): AudioTags {
  // eslint-disable-next-line no-control-regex
  const tidy = (text: string) => text.replace(/[\u0000-\u001f]+/g, ' ').trim()
  return { title: tidy(tags.title), artist: tidy(tags.artist), album: tidy(tags.album) }
}

// ---------------------------------------------------------------- ID3

const ID3V2_FRAMES: Record<string, keyof AudioTags> = {
  TIT2: 'title', TPE1: 'artist', TALB: 'album', // v2.3 and v2.4
  TT2: 'title', TP1: 'artist', TAL: 'album', // v2.2
}

function syncsafe(bytes: Bytes, at: number): number {
  return ((bytes.at(at) & 0x7f) << 21) | ((bytes.at(at + 1) & 0x7f) << 14) | ((bytes.at(at + 2) & 0x7f) << 7) | (bytes.at(at + 3) & 0x7f)
}

/** The ID3v2 tag whose header starts at `start`. */
async function readId3v2(file: TagFile, start: number): Promise<AudioTags> {
  const header = await file.read(start, 10)
  if (header.length < 10 || header.latin1(0, 3) !== 'ID3') return { ...EMPTY }
  const version = header.at(3)
  const flags = header.at(5)
  const end = start + 10 + syncsafe(header, 6)
  // An unsynchronised whole tag (v2.2/2.3) would need every frame un-escaped; rare enough to skip.
  if (version < 4 && flags & 0x80) return { ...EMPTY }
  let at = start + 10
  if (flags & 0x40 && version >= 3) {
    const ext = await file.read(at, 4)
    at += version === 4 ? syncsafe(ext, 0) : ext.u32be(0) + 4
  }
  const idLength = version === 2 ? 3 : 4
  const headerLength = version === 2 ? 6 : 10
  const tags: AudioTags = { ...EMPTY }
  while (at + headerLength <= end) {
    const frame = await file.read(at, headerLength)
    if (frame.length < headerLength || frame.at(0) === 0) break
    const id = frame.latin1(0, idLength)
    const size = version === 2 ? frame.u24be(3) : version === 4 ? syncsafe(frame, 4) : frame.u32be(4)
    const field = ID3V2_FRAMES[id]
    // v2.4 frames may be compressed, encrypted or unsynchronised per frame; such text is skipped.
    const unreadable = version === 4 && (frame.at(9) & 0x0f) !== 0
    if (field && !tags[field] && !unreadable && size > 1) tags[field] = decodeId3Text(await file.read(at + headerLength, size))
    // All three found: the frames after them (cover art above all) are not read, nor jumped past.
    if (tags.title && tags.artist && tags.album) break
    at += headerLength + size
  }
  return tags
}

/** An ID3v2 text frame's body: an encoding byte, then the text (several values NUL-separated; the first is taken). */
function decodeId3Text(body: Bytes): string {
  const encoding = body.at(0)
  let decoded: string
  if (encoding === 1) decoded = decodeUtf16WithBom(body.sub(1))
  else if (encoding === 2) decoded = body.utf16(false, 1)
  else if (encoding === 3) decoded = body.utf8(1)
  else decoded = body.latin1(1)
  return decoded.split('\u0000')[0]
}

/** UTF-16 after an optional byte-order mark (big-endian without one). */
function decodeUtf16WithBom(bytes: Bytes): string {
  if (bytes.at(0) === 0xff && bytes.at(1) === 0xfe) return bytes.utf16(true, 2)
  if (bytes.at(0) === 0xfe && bytes.at(1) === 0xff) return bytes.utf16(false, 2)
  return bytes.utf16(false)
}

/** The ID3v1 tag in the last 128 bytes, if there is one. */
async function readId3v1(file: TagFile): Promise<AudioTags> {
  if (file.size < 128) return { ...EMPTY }
  const tag = await file.read(file.size - 128, 128)
  if (tag.latin1(0, 3) !== 'TAG') return { ...EMPTY }
  const field = (from: number) => tag.latin1(from, from + 30).split('\u0000')[0]
  return { title: field(3), artist: field(33), album: field(63) }
}

// ---------------------------------------------------------------- Vorbis comments

const VORBIS_FIELDS: Record<string, keyof AudioTags> = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album' }

/** A Vorbis comment block (vendor string, then `KEY=value` entries, all little-endian length-prefixed). */
function readVorbisComments(block: Bytes): AudioTags {
  const tags: AudioTags = { ...EMPTY }
  if (block.length < 8) return tags
  let at = 4 + block.u32le(0)
  if (at + 4 > block.length) return tags
  const count = block.u32le(at)
  at += 4
  for (let i = 0; i < count && at + 4 <= block.length; i += 1) {
    const length = block.u32le(at)
    at += 4
    const entry = block.utf8(at, Math.min(block.length, at + length))
    at += length
    const equals = entry.indexOf('=')
    const field = equals > 0 ? VORBIS_FIELDS[entry.slice(0, equals).toUpperCase()] : undefined
    if (field && !tags[field]) tags[field] = entry.slice(equals + 1)
  }
  return tags
}

async function readFlac(file: TagFile): Promise<AudioTags> {
  let at = 4
  for (;;) {
    const header = await file.read(at, 4)
    if (header.length < 4) return { ...EMPTY }
    const last = (header.at(0) & 0x80) !== 0
    const type = header.at(0) & 0x7f
    const length = header.u24be(1)
    if (type === 4) return readVorbisComments(await file.read(at + 4, length))
    if (last) return { ...EMPTY }
    at += 4 + length
  }
}

/**
 * The comment header of an Ogg stream: the second packet of the first
 * logical stream (Vorbis `\x03vorbis`, Opus `OpusTags`), reassembled from
 * page segments, since a comment header longer than a page continues on the
 * next one.
 */
async function readOgg(file: TagFile): Promise<AudioTags> {
  let at = 0
  let packetIndex = 0
  const parts: Uint8Array[] = []
  let total = 0
  for (let pages = 0; pages < 64; pages += 1) {
    const header = await file.read(at, 27)
    if (header.length < 27 || header.latin1(0, 4) !== 'OggS') return { ...EMPTY }
    const segmentCount = header.at(26)
    const lacing = await file.read(at + 27, segmentCount)
    let bodyAt = at + 27 + segmentCount
    for (let i = 0; i < lacing.length; i += 1) {
      const segment = lacing.at(i)
      if (packetIndex === 1) {
        parts.push((await file.read(bodyAt, segment)).data)
        total += segment
        if (total > MAX_BLOCK_BYTES) return { ...EMPTY }
      }
      bodyAt += segment
      if (segment < 255) {
        if (packetIndex === 1) return readOggCommentPacket(concat(parts, total))
        packetIndex += 1
      }
    }
    at = bodyAt
  }
  return { ...EMPTY }
}

function concat(parts: Uint8Array[], total: number): Bytes {
  const joined = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    joined.set(part.subarray(0, total - at), at)
    at += part.length
  }
  return new Bytes(joined)
}

function readOggCommentPacket(packet: Bytes): AudioTags {
  if (packet.latin1(1, 7) === 'vorbis' && packet.at(0) === 3) return readVorbisComments(packet.sub(7))
  if (packet.latin1(0, 8) === 'OpusTags') return readVorbisComments(packet.sub(8))
  return { ...EMPTY }
}

// ---------------------------------------------------------------- MP4

const MP4_FIELDS: Record<string, keyof AudioTags> = { '©nam': 'title', '©ART': 'artist', '©alb': 'album' }

type Atom = { type: string; bodyAt: number; end: number }

/** The atom starting at `at`, inside a parent ending at `to`, or null where none fits. */
async function atomAt(file: TagFile, at: number, to: number): Promise<Atom | null> {
  if (at + 8 > to) return null
  const header = await file.read(at, 16)
  if (header.length < 8) return null
  let size = header.u32be(0)
  let headerLength = 8
  if (size === 1 && header.length >= 16) {
    size = header.u64be(8)
    headerLength = 16
  } else if (size === 0) size = to - at
  if (size < headerLength) return null
  return { type: header.latin1(4, 8), bodyAt: at + headerLength, end: Math.min(to, at + size) }
}

/** The atoms between `from` and `to`. */
async function atoms(file: TagFile, from: number, to: number): Promise<Atom[]> {
  const found: Atom[] = []
  for (let atom = await atomAt(file, from, to); atom; atom = await atomAt(file, atom.end, to)) found.push(atom)
  return found
}

/** `parent`'s first child of `type`, walked one header at a time so nothing after it is read. */
async function child(file: TagFile, parent: { bodyAt: number; end: number }, type: string): Promise<Atom | null> {
  for (let atom = await atomAt(file, parent.bodyAt, parent.end); atom; atom = await atomAt(file, atom.end, parent.end)) {
    if (atom.type === type) return atom
  }
  return null
}

async function readMp4(file: TagFile): Promise<AudioTags> {
  const root = { bodyAt: 0, end: file.size }
  const moov = await child(file, root, 'moov')
  const udta = moov && await child(file, moov, 'udta')
  const meta = udta && await child(file, udta, 'meta')
  // `meta` is a full atom: four bytes of version and flags precede its children.
  const ilst = meta && await child(file, { bodyAt: meta.bodyAt + 4, end: meta.end }, 'ilst')
  const tags: AudioTags = { ...EMPTY }
  if (!ilst) return tags
  for (const item of await atoms(file, ilst.bodyAt, ilst.end)) {
    const field = MP4_FIELDS[item.type]
    if (!field || tags[field]) continue
    const data = await child(file, item, 'data')
    // `data`: a type word (1 = UTF-8), a locale word, then the value.
    if (data) tags[field] = (await file.read(data.bodyAt + 8, data.end - data.bodyAt - 8)).utf8()
  }
  return tags
}

// ---------------------------------------------------------------- RIFF (WAV)

const RIFF_INFO_FIELDS: Record<string, keyof AudioTags> = { INAM: 'title', IART: 'artist', IPRD: 'album' }

async function readRiff(file: TagFile): Promise<AudioTags> {
  let info: AudioTags = { ...EMPTY }
  let id3: AudioTags = { ...EMPTY }
  let at = 12
  while (at + 8 <= file.size) {
    const header = await file.read(at, 12)
    if (header.length < 8) break
    const id = header.latin1(0, 4)
    const size = header.u32le(4)
    if (id === 'LIST' && header.latin1(8, 12) === 'INFO') info = await readRiffInfo(file, at + 12, at + 8 + size)
    else if (id === 'id3 ' || id === 'ID3 ') id3 = await readId3v2(file, at + 8)
    at += 8 + size + (size % 2)
  }
  return merge(id3, info)
}

async function readRiffInfo(file: TagFile, from: number, to: number): Promise<AudioTags> {
  const tags: AudioTags = { ...EMPTY }
  let at = from
  while (at + 8 <= to) {
    const header = await file.read(at, 8)
    if (header.length < 8) break
    const size = header.u32le(4)
    const field = RIFF_INFO_FIELDS[header.latin1(0, 4)]
    if (field && !tags[field]) tags[field] = (await file.read(at + 8, size)).utf8().split('\u0000')[0]
    at += 8 + size + (size % 2)
  }
  return tags
}
