// verify: reads-temp (scripts/verify.mjs, "what a module reads from disk")
/**
 * How long a song plays, read from its file's headers for the music library
 * (musicIndexCore.ts, beside `readAudioTags`), without decoding any audio.
 *
 * Each container states its length or the two numbers it follows from:
 * FLAC's STREAMINFO (total samples over the sample rate), MP4's `mvhd`
 * (duration over the time scale), WAV's `fmt ` and `data` chunks (bytes over
 * bytes per second), and Ogg's last page (its granule position, the sample
 * count, over the rate in the first page's header; Opus counts at 48 kHz
 * from after its pre-skip). An MP3 states it in a Xing/Info or VBRI header
 * in its first frame (the frame count times the samples per frame); without
 * one the file is constant bitrate and the audio's bytes over the bitrate
 * give it. WebM and raw AAC read as unknown.
 *
 * The file is read piece by piece, as `audioTags.ts` does; a missing,
 * corrupt or unknown file is `null`, never an error.
 */

import fs from 'node:fs'

/** The song's length in seconds, or null when the file does not say. Never throws. */
export function readAudioDuration(filePath: string): number | null {
  let fd: number | null = null
  try {
    fd = fs.openSync(filePath, 'r')
    const size = fs.fstatSync(fd).size
    const handle = fd
    const read = (offset: number, length: number): Buffer => {
      const wanted = Math.max(0, Math.min(length, 1 << 16, size - offset))
      const buffer = Buffer.alloc(wanted)
      const got = wanted > 0 ? fs.readSync(handle, buffer, 0, wanted, offset) : 0
      return buffer.subarray(0, got)
    }
    const seconds = durationOf(read, size)
    return seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : null
  } catch {
    return null
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}

type Read = (offset: number, length: number) => Buffer

function durationOf(read: Read, size: number): number | null {
  const head = read(0, 12)
  const magic4 = head.toString('latin1', 0, 4)
  if (magic4 === 'fLaC') return flac(read)
  if (magic4 === 'OggS') return ogg(read, size)
  if (magic4 === 'RIFF' && head.toString('latin1', 8, 12) === 'WAVE') return wav(read, size)
  if (head.toString('latin1', 4, 8) === 'ftyp') return mp4(read, size)
  return mp3(read, size)
}

function flac(read: Read): number | null {
  let at = 4
  for (let blocks = 0; blocks < 128; blocks += 1) {
    const header = read(at, 4)
    if (header.length < 4) return null
    const type = header[0] & 0x7f
    const length = header.readUIntBE(1, 3)
    if (type === 0) {
      const info = read(at + 4, 18)
      if (info.length < 18) return null
      const rate = (info[10] << 12) | (info[11] << 4) | (info[12] >> 4)
      const samples = (info[13] & 0x0f) * 2 ** 32 + info.readUInt32BE(14)
      return rate > 0 && samples > 0 ? samples / rate : null
    }
    if (header[0] & 0x80) return null
    at += 4 + length
  }
  return null
}

function ogg(read: Read, size: number): number | null {
  const first = read(0, 27)
  if (first.length < 27) return null
  const bodyAt = 27 + first[26]
  const body = read(bodyAt, 20)
  let rate: number
  let skip = 0
  if (body[0] === 1 && body.toString('latin1', 1, 7) === 'vorbis') rate = body.readUInt32LE(12)
  else if (body.toString('latin1', 0, 8) === 'OpusHead') { rate = 48000; skip = body.readUInt16LE(10) }
  else return null
  // The last page's granule position: the stream's sample count.
  const tailFrom = Math.max(0, size - 65536)
  const tail = read(tailFrom, size - tailFrom)
  const last = tail.lastIndexOf('OggS')
  if (last < 0 || last + 14 > tail.length) return null
  const granule = Number(tail.readBigUInt64LE(last + 6))
  return rate > 0 && granule > skip ? (granule - skip) / rate : null
}

function wav(read: Read, size: number): number | null {
  let at = 12
  let byteRate = 0
  while (at + 8 <= size) {
    const header = read(at, 16)
    if (header.length < 8) return null
    const id = header.toString('latin1', 0, 4)
    const chunk = header.readUInt32LE(4)
    if (id === 'fmt ' && header.length >= 16) byteRate = read(at + 8, 12).readUInt32LE(8)
    if (id === 'data') return byteRate > 0 ? Math.min(chunk, size - at - 8) / byteRate : null
    at += 8 + chunk + (chunk % 2)
  }
  return null
}

function mp4(read: Read, size: number): number | null {
  const find = (from: number, to: number, type: string): { bodyAt: number; end: number } | null => {
    let at = from
    while (at + 8 <= to) {
      const header = read(at, 16)
      if (header.length < 8) return null
      let atomSize = header.readUInt32BE(0)
      let headerLength = 8
      if (atomSize === 1 && header.length >= 16) { atomSize = Number(header.readBigUInt64BE(8)); headerLength = 16 }
      else if (atomSize === 0) atomSize = to - at
      if (atomSize < headerLength) return null
      if (header.toString('latin1', 4, 8) === type) return { bodyAt: at + headerLength, end: Math.min(to, at + atomSize) }
      at += atomSize
    }
    return null
  }
  const moov = find(0, size, 'moov')
  const mvhd = moov && find(moov.bodyAt, moov.end, 'mvhd')
  if (!mvhd) return null
  const body = read(mvhd.bodyAt, 32)
  if (body.length < 20) return null
  const [scale, duration] = body[0] === 1 && body.length >= 32
    ? [body.readUInt32BE(20), Number(body.readBigUInt64BE(24))]
    : [body.readUInt32BE(12), body.readUInt32BE(16)]
  return scale > 0 ? duration / scale : null
}

const MP3_BITRATES_KBPS: Record<string, number[]> = {
  // [MPEG version 1 | 2 and 2.5] x layer (3, 2, 1), indexed by the header's 4-bit field.
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
}
const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }

function mp3(read: Read, size: number): number | null {
  // Past an ID3v2 tag, to the first frame.
  let start = 0
  const id3 = read(0, 10)
  if (id3.toString('latin1', 0, 3) === 'ID3' && id3.length === 10) {
    start = 10 + (((id3[6] & 0x7f) << 21) | ((id3[7] & 0x7f) << 14) | ((id3[8] & 0x7f) << 7) | (id3[9] & 0x7f)) + (id3[5] & 0x10 ? 10 : 0)
  }
  const window = read(start, 65536)
  for (let i = 0; i + 4 <= window.length; i += 1) {
    if (window[i] !== 0xff || (window[i + 1] & 0xe0) !== 0xe0) continue
    const versionBits = (window[i + 1] >> 3) & 3 // 3 = MPEG 1, 2 = MPEG 2, 0 = MPEG 2.5
    const layerBits = (window[i + 1] >> 1) & 3 // 1 = layer 3, 2 = layer 2, 3 = layer 1
    const bitrateIndex = window[i + 2] >> 4
    const rateIndex = (window[i + 2] >> 2) & 3
    if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) continue
    const layer = 4 - layerBits
    const mpeg1 = versionBits === 3
    const kbps = MP3_BITRATES_KBPS[`${mpeg1 ? 1 : 2}-${layer}`][bitrateIndex]
    const rate = MP3_RATES[versionBits][rateIndex]
    const samplesPerFrame = layer === 1 ? 384 : layer === 2 || mpeg1 ? 1152 : 576
    const frameAt = start + i
    const mono = (window[i + 3] >> 6) === 3
    // A Xing/Info header sits after the side information; a VBRI one 32 bytes in.
    const xingAt = frameAt + 4 + (mpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17))
    const xing = read(xingAt, 12)
    const tag = xing.toString('latin1', 0, 4)
    if ((tag === 'Xing' || tag === 'Info') && xing.length >= 12 && (xing.readUInt32BE(4) & 1)) {
      return (xing.readUInt32BE(8) * samplesPerFrame) / rate
    }
    const vbri = read(frameAt + 36, 18)
    if (vbri.toString('latin1', 0, 4) === 'VBRI' && vbri.length >= 18) return (vbri.readUInt32BE(14) * samplesPerFrame) / rate
    // Constant bitrate: the audio's bytes, less an ID3v1 tag at the end.
    const id3v1 = size >= 128 && read(size - 128, 3).toString('latin1') === 'TAG' ? 128 : 0
    return ((size - frameAt - id3v1) * 8) / (kbps * 1000)
  }
  return null
}
