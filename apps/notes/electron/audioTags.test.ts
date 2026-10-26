import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readAudioTags } from './audioTags'

/**
 * Each container built by hand to its specification. The reader was also
 * checked against files ffmpeg wrote in every supported format (MP3 with
 * ID3v2.3 and 2.4, FLAC, Ogg Vorbis, Opus, M4A, WAV), which is not repeated
 * here because CI has no ffmpeg.
 */
describe('readAudioTags', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'tags-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const file = (name: string, bytes: Buffer) => {
    const at = path.join(dir, name)
    writeFileSync(at, bytes)
    return at
  }

  const id3Frame = (id: string, text: string) => {
    const body = Buffer.concat([Buffer.from([3]), Buffer.from(text, 'utf8')])
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

  it('reads ID3v2 frames, stepping over ones it does not want', () => {
    const big = id3Frame('APIC', 'x'.repeat(5000))
    const at = file('a.mp3', id3v2([id3Frame('TPE1', 'Ärtist'), big, id3Frame('TIT2', 'Title'), id3Frame('TALB', 'Album')]))
    expect(readAudioTags(at)).toEqual({ title: 'Title', artist: 'Ärtist', album: 'Album' })
  })

  it('fills fields ID3v2 lacks from ID3v1', () => {
    const at = file('b.mp3', Buffer.concat([id3v2([id3Frame('TIT2', 'Title')]), id3v1('Old', 'Old Artist', '')]))
    expect(readAudioTags(at)).toEqual({ title: 'Title', artist: 'Old Artist', album: '' })
  })

  it('reads empty fields for a file with no tags, or no file', () => {
    expect(readAudioTags(file('c.mp3', Buffer.alloc(500)))).toEqual({ title: '', artist: '', album: '' })
    expect(readAudioTags(path.join(dir, 'missing.mp3'))).toEqual({ title: '', artist: '', album: '' })
  })
})
