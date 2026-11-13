// verify: reads-temp (scripts/verify.mjs, "what a module reads from disk")
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readAudioDuration } from './audioDuration'

const dir = mkdtempSync(path.join(tmpdir(), 'audio-duration-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const file = (name: string, bytes: Buffer) => { const at = path.join(dir, name); writeFileSync(at, bytes); return at }

describe('readAudioDuration', () => {
  it('reads a WAV from its byte rate and data size', () => {
    const fmt = Buffer.alloc(24); fmt.write('fmt ', 0, 'latin1'); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(1, 8); fmt.writeUInt16LE(2, 10)
    fmt.writeUInt32LE(44100, 12); fmt.writeUInt32LE(44100 * 4, 16); fmt.writeUInt16LE(4, 20); fmt.writeUInt16LE(16, 22)
    const data = Buffer.alloc(8 + 44100 * 4 * 2); data.write('data', 0, 'latin1'); data.writeUInt32LE(44100 * 4 * 2, 4)
    const riff = Buffer.alloc(12); riff.write('RIFF', 0, 'latin1'); riff.writeUInt32LE(4 + fmt.length + data.length, 4); riff.write('WAVE', 8, 'latin1')
    expect(readAudioDuration(file('a.wav', Buffer.concat([riff, fmt, data])))).toBeCloseTo(2, 5)
  })

  it('reads a FLAC from STREAMINFO', () => {
    const info = Buffer.alloc(34)
    const rate = 48000; const samples = 48000 * 3
    info[10] = rate >> 12; info[11] = (rate >> 4) & 0xff; info[12] = (rate & 0x0f) << 4
    info.writeUInt32BE(samples, 14)
    const header = Buffer.from([0x80, 0, 0, 34])
    expect(readAudioDuration(file('a.flac', Buffer.concat([Buffer.from('fLaC', 'latin1'), header, info])))).toBeCloseTo(3, 5)
  })

  it('reads a constant-bitrate MP3 from its size and bitrate', () => {
    // MPEG 1 layer 3, 128 kbps, 44.1 kHz, stereo: 0xFF 0xFB 0x90 0x00.
    const audio = Buffer.alloc(128000 / 8 * 5)
    for (let at = 0; at + 4 <= audio.length; at += 417) audio.set([0xff, 0xfb, 0x90, 0x00], at)
    expect(readAudioDuration(file('a.mp3', audio))).toBeCloseTo(5, 3)
  })

  it('answers null for a file it cannot read', () => {
    expect(readAudioDuration(path.join(dir, 'missing.mp3'))).toBeNull()
    expect(readAudioDuration(file('junk.ogg', Buffer.from('not audio')))).toBeNull()
  })
})
