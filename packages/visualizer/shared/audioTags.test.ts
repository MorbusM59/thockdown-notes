import { describe, expect, it } from 'vitest'
import { readAheadSource, type AudioFileSource } from './audioFileSource'
import { readAudioTags } from './audioTags'

/** The file's bytes as a source, read ahead by a few bytes only, so ranges are fetched and cut many times over. */
const source = (bytes: Uint8Array): AudioFileSource =>
  readAheadSource(bytes.length, async (offset, length) => bytes.slice(offset, offset + length), 64)

/** A source whose every read fails, as a file the provider will not open. */
const unreadable: AudioFileSource = { size: 1000, read: () => Promise.reject(new Error('gone')) }

const NONE = { title: '', artist: '', album: '' }

/**
 * Each container built by hand to its specification. The reader was also
 * checked against files ffmpeg wrote in every supported format (MP3 with
 * ID3v2.3 and 2.4, FLAC, Ogg Vorbis, Opus, M4A, WAV), which is not repeated
 * here because CI has no ffmpeg.
 */
describe('readAudioTags', () => {
  const id3Frame = (id: string, text: string, encoding = 3) => {
    const body = Buffer.concat([Buffer.from([encoding]), encoding === 1 ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]) : Buffer.from(text, encoding === 3 ? 'utf8' : 'latin1')])
    const header = Buffer.alloc(10)
    header.write(id, 0, 'latin1')
    header.writeUInt32BE(body.length, 4)
    return Buffer.concat([header, body])
  }
  const id3v2 = (frames: Buffer[]) => {
    const body = Buffer.concat(frames)
    const header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0])
    const n = body.length
    header.set([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f], 6)
    return Buffer.concat([header, body, Buffer.alloc(64)])
  }
  const id3v1 = (title: string, artist: string, album: string) => {
    const tag = Buffer.alloc(128)
    tag.write('TAG', 0, 'latin1')
    tag.write(title, 3, 'latin1')
    tag.write(artist, 33, 'latin1')
    tag.write(album, 63, 'latin1')
    return tag
  }
  const vorbisComments = (entries: string[]) => {
    const vendor = Buffer.from('vendor', 'utf8')
    const parts = [u32le(vendor.length), vendor, u32le(entries.length)]
    for (const entry of entries) {
      const text = Buffer.from(entry, 'utf8')
      parts.push(u32le(text.length), text)
    }
    return Buffer.concat(parts)
  }
  const u32le = (value: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b }
  const atom = (type: string, ...children: Buffer[]) => {
    const body = Buffer.concat(children)
    const header = Buffer.alloc(8)
    header.writeUInt32BE(8 + body.length)
    header.write(type, 4, 'latin1')
    return Buffer.concat([header, body])
  }

  it('reads ID3v2 frames, stepping over ones it does not want', async () => {
    const big = id3Frame('APIC', 'x'.repeat(5000))
    const bytes = id3v2([id3Frame('TPE1', 'Ärtist'), big, id3Frame('TIT2', 'Title', 1), id3Frame('TALB', 'Album', 0)])
    expect(await readAudioTags(source(bytes))).toEqual({ title: 'Title', artist: 'Ärtist', album: 'Album' })
  })

  it('fills fields ID3v2 lacks from ID3v1', async () => {
    const bytes = Buffer.concat([id3v2([id3Frame('TIT2', 'Title')]), id3v1('Old', 'Old Artist', '')])
    expect(await readAudioTags(source(bytes))).toEqual({ title: 'Title', artist: 'Old Artist', album: '' })
  })

  it('reads FLAC and Ogg Vorbis comments', async () => {
    const comments = vorbisComments(['ARTIST=Artist', 'title=Title', 'ALBUM=Album'])
    const block = Buffer.alloc(4)
    block[0] = 0x80 | 4
    block.writeUIntBE(comments.length, 1, 3)
    expect(await readAudioTags(source(Buffer.concat([Buffer.from('fLaC', 'latin1'), block, comments])))).toEqual({ title: 'Title', artist: 'Artist', album: 'Album' })

    const page = (packets: Buffer[]) => {
      const lacing: number[] = []
      for (const packet of packets) {
        let left = packet.length
        while (left >= 255) { lacing.push(255); left -= 255 }
        lacing.push(left)
      }
      const header = Buffer.alloc(27)
      header.write('OggS', 0, 'latin1')
      header[26] = lacing.length
      return Buffer.concat([header, Buffer.from(lacing), ...packets])
    }
    const identification = Buffer.concat([Buffer.from([1]), Buffer.from('vorbis', 'latin1'), Buffer.alloc(23)])
    const comment = Buffer.concat([Buffer.from([3]), Buffer.from('vorbis', 'latin1'), vorbisComments(['TITLE=' + 'T'.repeat(300)])])
    expect((await readAudioTags(source(page([identification, comment])))).title).toBe('T'.repeat(300))
  })

  it('reads an M4A ilst', async () => {
    const item = (type: string, text: string) => atom(type, atom('data', Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]), Buffer.from(text, 'utf8')))
    const meta = atom('meta', Buffer.alloc(4), atom('hdlr', Buffer.alloc(24)), atom('ilst', item('©nam', 'Title'), item('©ART', 'Artist'), item('©alb', 'Album')))
    const bytes = Buffer.concat([atom('ftyp', Buffer.from('M4A ', 'latin1')), atom('mdat', Buffer.alloc(3000)), atom('moov', atom('mvhd', Buffer.alloc(100)), atom('udta', meta))])
    expect(await readAudioTags(source(bytes))).toEqual({ title: 'Title', artist: 'Artist', album: 'Album' })
  })

  it('reads a WAV LIST/INFO chunk', async () => {
    const field = (id: string, text: string) => { const body = Buffer.from(text + '\u0000', 'utf8'); const h = Buffer.alloc(8); h.write(id, 0, 'latin1'); h.writeUInt32LE(body.length, 4); return Buffer.concat([h, body, Buffer.alloc(body.length % 2)]) }
    const info = Buffer.concat([Buffer.from('INFO', 'latin1'), field('INAM', 'Title'), field('IART', 'Artist')])
    const list = Buffer.concat([Buffer.from('LIST', 'latin1'), u32le(info.length), info])
    const riff = Buffer.concat([Buffer.from('RIFF', 'latin1'), u32le(4 + list.length), Buffer.from('WAVE', 'latin1')])
    expect(await readAudioTags(source(Buffer.concat([riff, list])))).toEqual({ title: 'Title', artist: 'Artist', album: '' })
  })

  it('reads empty fields for a file with no tags, or one that cannot be read', async () => {
    expect(await readAudioTags(source(Buffer.alloc(500)))).toEqual(NONE)
    expect(await readAudioTags(unreadable)).toEqual(NONE)
  })
})
