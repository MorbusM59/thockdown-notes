/**
 * Reads a song's title, artist and album from the tags in its file, for the
 * music library (databaseService.ts's `addMusicSongs` and its backfill).
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
 * the renderer's (shared/audioPlayer.ts's `songTitleText` and friends).
 */

import fs from 'node:fs'

export type AudioTags = { title: string; artist: string; album: string }

const EMPTY: AudioTags = { title: '', artist: '', album: '' }
/** The largest single block read into memory. Text tags are tiny; this only stops a corrupt length. */
const MAX_BLOCK_BYTES = 1 << 20

/** The tags in the file at `filePath`. Never throws: an unreadable file has no tags. */
export function readAudioTags(filePath: string): AudioTags {
  let fd: number | null = null
  try {
    fd = fs.openSync(filePath, 'r')
    const file = new TagFile(fd, fs.fstatSync(fd).size)
    return clean(readAny(file))
  } catch {
    return { ...EMPTY }
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}

class TagFile {
  constructor(private readonly fd: number, readonly size: number) {}
  /** Up to `length` bytes at `offset` (fewer at the end of the file). */
  read(offset: number, length: number): Buffer {
    const wanted = Math.max(0, Math.min(length, MAX_BLOCK_BYTES, this.size - offset))
    const buffer = Buffer.alloc(wanted)
    const got = wanted > 0 ? fs.readSync(this.fd, buffer, 0, wanted, offset) : 0
    return buffer.subarray(0, got)
  }
}

function readAny(file: TagFile): AudioTags {
  const head = file.read(0, 12)
  const magic4 = head.toString('latin1', 0, 4)
  if (head.toString('latin1', 0, 3) === 'ID3') return merge(readId3v2(file, 0), readId3v1(file))
  if (magic4 === 'fLaC') return readFlac(file)
  if (magic4 === 'OggS') return readOgg(file)
  if (magic4 === 'RIFF' && head.toString('latin1', 8, 12) === 'WAVE') return readRiff(file)
  if (head.toString('latin1', 4, 8) === 'ftyp') return readMp4(file)
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

function syncsafe(buffer: Buffer, at: number): number {
  return ((buffer[at] & 0x7f) << 21) | ((buffer[at + 1] & 0x7f) << 14) | ((buffer[at + 2] & 0x7f) << 7) | (buffer[at + 3] & 0x7f)
}

/** The ID3v2 tag whose header starts at `start`. */
function readId3v2(file: TagFile, start: number): AudioTags {
  const header = file.read(start, 10)
  if (header.length < 10 || header.toString('latin1', 0, 3) !== 'ID3') return { ...EMPTY }
  const version = header[3]
  const flags = header[5]
  const end = start + 10 + syncsafe(header, 6)
  // An unsynchronised whole tag (v2.2/2.3) would need every frame un-escaped; rare enough to skip.
  if (version < 4 && flags & 0x80) return { ...EMPTY }
  let at = start + 10
  if (flags & 0x40 && version >= 3) {
    const ext = file.read(at, 4)
    at += version === 4 ? syncsafe(ext, 0) : ext.readUInt32BE(0) + 4
  }
  const idLength = version === 2 ? 3 : 4
  const headerLength = version === 2 ? 6 : 10
  const tags: AudioTags = { ...EMPTY }
  while (at + headerLength <= end) {
    const frame = file.read(at, headerLength)
    if (frame.length < headerLength || frame[0] === 0) break
    const id = frame.toString('latin1', 0, idLength)
    const size = version === 2 ? frame.readUIntBE(3, 3) : version === 4 ? syncsafe(frame, 4) : frame.readUInt32BE(4)
    const field = ID3V2_FRAMES[id]
    // v2.4 frames may be compressed, encrypted or unsynchronised per frame; such text is skipped.
    const unreadable = version === 4 && (frame[9] & 0x0f) !== 0
    if (field && !tags[field] && !unreadable && size > 1) tags[field] = decodeId3Text(file.read(at + headerLength, size))
    at += headerLength + size
  }
  return tags
}

/** An ID3v2 text frame's body: an encoding byte, then the text (several values NUL-separated; the first is taken). */
function decodeId3Text(body: Buffer): string {
  const encoding = body[0]
  const text = body.subarray(1)
  let decoded: string
  if (encoding === 1) decoded = decodeUtf16(text, true)
  else if (encoding === 2) decoded = decodeUtf16(text, false)
  else if (encoding === 3) decoded = text.toString('utf8')
  else decoded = text.toString('latin1')
  return decoded.split('\u0000')[0]
}

/** UTF-16 with an optional byte-order mark; `bom` says whether to look for one (else big-endian). */
function decodeUtf16(bytes: Buffer, bom: boolean): string {
  let littleEndian = false
  let data = bytes
  if (bom && data.length >= 2) {
    if (data[0] === 0xff && data[1] === 0xfe) { littleEndian = true; data = data.subarray(2) }
    else if (data[0] === 0xfe && data[1] === 0xff) data = data.subarray(2)
  }
  const even = data.subarray(0, data.length - (data.length % 2))
  if (littleEndian) return even.toString('utf16le')
  const swapped = Buffer.from(even)
  swapped.swap16()
  return swapped.toString('utf16le')
}

/** The ID3v1 tag in the last 128 bytes, if there is one. */
function readId3v1(file: TagFile): AudioTags {
  if (file.size < 128) return { ...EMPTY }
  const tag = file.read(file.size - 128, 128)
  if (tag.toString('latin1', 0, 3) !== 'TAG') return { ...EMPTY }
  const field = (from: number) => tag.toString('latin1', from, from + 30).split('\u0000')[0]
  return { title: field(3), artist: field(33), album: field(63) }
}

// ---------------------------------------------------------------- Vorbis comments

const VORBIS_FIELDS: Record<string, keyof AudioTags> = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album' }

/** A Vorbis comment block (vendor string, then `KEY=value` entries, all little-endian length-prefixed). */
function readVorbisComments(block: Buffer): AudioTags {
  const tags: AudioTags = { ...EMPTY }
  if (block.length < 8) return tags
  let at = 4 + block.readUInt32LE(0)
  if (at + 4 > block.length) return tags
  const count = block.readUInt32LE(at)
  at += 4
  for (let i = 0; i < count && at + 4 <= block.length; i += 1) {
    const length = block.readUInt32LE(at)
    at += 4
    const entry = block.toString('utf8', at, Math.min(block.length, at + length))
    at += length
    const equals = entry.indexOf('=')
    const field = equals > 0 ? VORBIS_FIELDS[entry.slice(0, equals).toUpperCase()] : undefined
    if (field && !tags[field]) tags[field] = entry.slice(equals + 1)
  }
  return tags
}

function readFlac(file: TagFile): AudioTags {
  let at = 4
  for (;;) {
    const header = file.read(at, 4)
    if (header.length < 4) return { ...EMPTY }
    const last = (header[0] & 0x80) !== 0
    const type = header[0] & 0x7f
    const length = header.readUIntBE(1, 3)
    if (type === 4) return readVorbisComments(file.read(at + 4, length))
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
function readOgg(file: TagFile): AudioTags {
  let at = 0
  let packetIndex = 0
  const parts: Buffer[] = []
  let total = 0
  for (let pages = 0; pages < 64; pages += 1) {
    const header = file.read(at, 27)
    if (header.length < 27 || header.toString('latin1', 0, 4) !== 'OggS') return { ...EMPTY }
    const segmentCount = header[26]
    const lacing = file.read(at + 27, segmentCount)
    let bodyAt = at + 27 + segmentCount
    for (let i = 0; i < lacing.length; i += 1) {
      if (packetIndex === 1) {
        parts.push(file.read(bodyAt, lacing[i]))
        total += lacing[i]
        if (total > MAX_BLOCK_BYTES) return { ...EMPTY }
      }
      bodyAt += lacing[i]
      if (lacing[i] < 255) {
        if (packetIndex === 1) return readOggCommentPacket(Buffer.concat(parts))
        packetIndex += 1
      }
    }
    at = bodyAt
  }
  return { ...EMPTY }
}

function readOggCommentPacket(packet: Buffer): AudioTags {
  if (packet.toString('latin1', 1, 7) === 'vorbis' && packet[0] === 3) return readVorbisComments(packet.subarray(7))
  if (packet.toString('latin1', 0, 8) === 'OpusTags') return readVorbisComments(packet.subarray(8))
  return { ...EMPTY }
}

// ---------------------------------------------------------------- MP4

const MP4_FIELDS: Record<string, keyof AudioTags> = { '©nam': 'title', '©ART': 'artist', '©alb': 'album' }

type Atom = { type: string; bodyAt: number; end: number }

/** The atoms between `from` and `to`. */
function* atoms(file: TagFile, from: number, to: number): Generator<Atom> {
  let at = from
  while (at + 8 <= to) {
    const header = file.read(at, 16)
    if (header.length < 8) return
    let size = header.readUInt32BE(0)
    let headerLength = 8
    if (size === 1 && header.length >= 16) {
      size = Number(header.readBigUInt64BE(8))
      headerLength = 16
    } else if (size === 0) size = to - at
    if (size < headerLength) return
    yield { type: header.toString('latin1', 4, 8), bodyAt: at + headerLength, end: Math.min(to, at + size) }
    at += size
  }
}

function child(file: TagFile, parent: { bodyAt: number; end: number }, type: string): Atom | null {
  for (const atom of atoms(file, parent.bodyAt, parent.end)) if (atom.type === type) return atom
  return null
}

function readMp4(file: TagFile): AudioTags {
  const root = { bodyAt: 0, end: file.size }
  const moov = child(file, root, 'moov')
  const udta = moov && child(file, moov, 'udta')
  const meta = udta && child(file, udta, 'meta')
  // `meta` is a full atom: four bytes of version and flags precede its children.
  const ilst = meta && child(file, { bodyAt: meta.bodyAt + 4, end: meta.end }, 'ilst')
  const tags: AudioTags = { ...EMPTY }
  if (!ilst) return tags
  for (const item of atoms(file, ilst.bodyAt, ilst.end)) {
    const field = MP4_FIELDS[item.type]
    if (!field || tags[field]) continue
    const data = child(file, item, 'data')
    // `data`: a type word (1 = UTF-8), a locale word, then the value.
    if (data) tags[field] = file.read(data.bodyAt + 8, data.end - data.bodyAt - 8).toString('utf8')
  }
  return tags
}

// ---------------------------------------------------------------- RIFF (WAV)

const RIFF_INFO_FIELDS: Record<string, keyof AudioTags> = { INAM: 'title', IART: 'artist', IPRD: 'album' }

function readRiff(file: TagFile): AudioTags {
  let info: AudioTags = { ...EMPTY }
  let id3: AudioTags = { ...EMPTY }
  let at = 12
  while (at + 8 <= file.size) {
    const header = file.read(at, 12)
    if (header.length < 8) break
    const id = header.toString('latin1', 0, 4)
    const size = header.readUInt32LE(4)
    if (id === 'LIST' && header.toString('latin1', 8, 12) === 'INFO') info = readRiffInfo(file, at + 12, at + 8 + size)
    else if (id === 'id3 ' || id === 'ID3 ') id3 = readId3v2(file, at + 8)
    at += 8 + size + (size % 2)
  }
  return merge(id3, info)
}

function readRiffInfo(file: TagFile, from: number, to: number): AudioTags {
  const tags: AudioTags = { ...EMPTY }
  let at = from
  while (at + 8 <= to) {
    const header = file.read(at, 8)
    if (header.length < 8) break
    const size = header.readUInt32LE(4)
    const field = RIFF_INFO_FIELDS[header.toString('latin1', 0, 4)]
    if (field && !tags[field]) tags[field] = file.read(at + 8, size).toString('utf8').split('\u0000')[0]
    at += 8 + size + (size % 2)
  }
  return tags
}
