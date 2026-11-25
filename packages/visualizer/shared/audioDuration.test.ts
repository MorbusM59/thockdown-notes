import { describe, expect, it } from 'vitest'
import { readAheadSource, type AudioFileSource } from './audioFileSource'
import { readAudioDuration } from './audioDuration'

/** The file's bytes as a source, read ahead by a few bytes only, so ranges are fetched and cut many times over. */
const source = (bytes: Uint8Array): AudioFileSource =>
  readAheadSource(bytes.length, async (offset, length) => bytes.slice(offset, offset + length), 64)

describe('readAudioDuration', () => {
  it('reads a WAV from its byte rate and data size', async () => {
    const fmt = Buffer.alloc(24); fmt.write('fmt ', 0, 'latin1'); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(1, 8); fmt.writeUInt16LE(2, 10)
    fmt.writeUInt32LE(44100, 12); fmt.writeUInt32LE(44100 * 4, 16); fmt.writeUInt16LE(4, 20); fmt.writeUInt16LE(16, 22)
    const data = Buffer.alloc(8 + 44100 * 4 * 2); data.write('data', 0, 'latin1'); data.writeUInt32LE(44100 * 4 * 2, 4)
    const riff = Buffer.alloc(12); riff.write('RIFF', 0, 'latin1'); riff.writeUInt32LE(4 + fmt.length + data.length, 4); riff.write('WAVE', 8, 'latin1')
    expect(await readAudioDuration(source(Buffer.concat([riff, fmt, data])))).toBeCloseTo(2, 5)
  })

  it('reads a FLAC from STREAMINFO', async () => {
    const info = Buffer.alloc(34)
    const rate = 48000; const samples = 48000 * 3
    info[10] = rate >> 12; info[11] = (rate >> 4) & 0xff; info[12] = (rate & 0x0f) << 4
    info.writeUInt32BE(samples, 14)
    const header = Buffer.from([0x80, 0, 0, 34])
    expect(await readAudioDuration(source(Buffer.concat([Buffer.from('fLaC', 'latin1'), header, info])))).toBeCloseTo(3, 5)
  })

  it('reads a constant-bitrate MP3 from its size and bitrate, its first frame past the first read step', async () => {
    // MPEG 1 layer 3, 128 kbps, 44.1 kHz, stereo: 0xFF 0xFB 0x90 0x00.
    const junk = 5000
    const audio = Buffer.alloc(junk + 128000 / 8 * 5)
    for (let at = junk; at + 4 <= audio.length; at += 417) audio.set([0xff, 0xfb, 0x90, 0x00], at)
    expect(await readAudioDuration(source(audio))).toBeCloseTo(5, 3)
  })

  it('reads a VBR MP3 from its Xing frame count', async () => {
    const frame = Buffer.alloc(417)
    frame.set([0xff, 0xfb, 0x90, 0x00], 0)
    frame.write('Xing', 4 + 32, 'latin1')
    frame.writeUInt32BE(1, 4 + 32 + 4)
    frame.writeUInt32BE(1000, 4 + 32 + 8)
    expect(await readAudioDuration(source(Buffer.concat([frame, Buffer.alloc(2000)])))).toBeCloseTo((1000 * 1152) / 44100, 5)
  })

  it('reads an Ogg Opus from its last granule, after the pre-skip', async () => {
    const page = (granule: number, body: Buffer) => {
      const header = Buffer.alloc(27); header.write('OggS', 0, 'latin1'); header.writeBigUInt64LE(BigInt(granule), 6); header[26] = 1
      return Buffer.concat([header, Buffer.from([body.length]), body])
    }
    const head = Buffer.alloc(19); head.write('OpusHead', 0, 'latin1'); head.writeUInt16LE(312, 10)
    const bytes = Buffer.concat([page(0, head), Buffer.alloc(20000), page(48000 * 4 + 312, Buffer.alloc(10))])
    expect(await readAudioDuration(source(bytes))).toBeCloseTo(4, 5)
  })

  it('reads an M4A from mvhd', async () => {
    const atom = (type: string, body: Buffer) => { const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length); h.write(type, 4, 'latin1'); return Buffer.concat([h, body]) }
    const mvhd = Buffer.alloc(100); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(7500, 16)
    const bytes = Buffer.concat([atom('ftyp', Buffer.from('M4A ', 'latin1')), atom('mdat', Buffer.alloc(3000)), atom('moov', atom('mvhd', mvhd))])
    expect(await readAudioDuration(source(bytes))).toBeCloseTo(7.5, 5)
  })

  it('answers null for a file it cannot read', async () => {
    expect(await readAudioDuration({ size: 1000, read: () => Promise.reject(new Error('gone')) })).toBeNull()
    expect(await readAudioDuration(source(Buffer.from('not audio')))).toBeNull()
  })
})
