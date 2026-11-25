/**
 * How long a song plays, read from its file's headers for the music library
 * of both apps (beside `readAudioTags`, through the same `AudioFileSource`),
 * without decoding any audio.
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

import { Bytes, type AudioFileSource } from './audioFileSource'

/** The largest single read. */
const MAX_READ_BYTES = 1 << 16
/** How far the first MP3 frame is looked for past the ID3 tag, and how much is read at a time while looking. */
const MP3_SYNC_SEARCH_BYTES = 1 << 16
const MP3_SYNC_STEP_BYTES = 4096
/** An Ogg page is at most 65,307 bytes; the last one is usually far shorter, so a short tail is read first. */
const OGG_SHORT_TAIL_BYTES = 8192

/** The song's length in seconds, or null when the file does not say. Never rejects. */
export async function readAudioDuration(source: AudioFileSource): Promise<number | null> {
  try {
    const read: Read = async (offset, length) => new Bytes(await source.read(offset, Math.max(0, Math.min(length, MAX_READ_BYTES))))
    const seconds = await durationOf(read, source.size)
    return seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : null
  } catch {
    return null
  }
}

type Read = (offset: number, length: number) => Promise<Bytes>

async function durationOf(read: Read, size: number): Promise<number | null> {
  const head = await read(0, 12)
  const magic4 = head.latin1(0, 4)
  if (magic4 === 'fLaC') return flac(read)
  if (magic4 === 'OggS') return ogg(read, size)
  if (magic4 === 'RIFF' && head.latin1(8, 12) === 'WAVE') return wav(read, size)
  if (head.latin1(4, 8) === 'ftyp') return mp4(read, size)
  return mp3(read, size)
}

async function flac(read: Read): Promise<number | null> {
  let at = 4
  for (let blocks = 0; blocks < 128; blocks += 1) {
    const header = await read(at, 4)
    if (header.length < 4) return null
    const type = header.at(0) & 0x7f
    const length = header.u24be(1)
    if (type === 0) {
      const info = await read(at + 4, 18)
      if (info.length < 18) return null
      const rate = (info.at(10) << 12) | (info.at(11) << 4) | (info.at(12) >> 4)
      const samples = (info.at(13) & 0x0f) * 2 ** 32 + info.u32be(14)
      return rate > 0 && samples > 0 ? samples / rate : null
    }
    if (header.at(0) & 0x80) return null
    at += 4 + length
  }
  return null
}

async function ogg(read: Read, size: number): Promise<number | null> {
  const first = await read(0, 27)
  if (first.length < 27) return null
  const body = await read(27 + first.at(26), 20)
  let rate: number
  let skip = 0
  if (body.at(0) === 1 && body.latin1(1, 7) === 'vorbis') rate = body.u32le(12)
  else if (body.latin1(0, 8) === 'OpusHead') { rate = 48000; skip = body.u16le(10) }
  else return null
  // The last page's granule position: the stream's sample count.
  const granule = (await lastGranule(read, size, OGG_SHORT_TAIL_BYTES)) ?? (await lastGranule(read, size, MAX_READ_BYTES))
  return granule !== null && rate > 0 && granule > skip ? (granule - skip) / rate : null
}

/** The granule position of the last page whose header lies in the file's last `span` bytes, or null. */
async function lastGranule(read: Read, size: number, span: number): Promise<number | null> {
  const from = Math.max(0, size - span)
  const tail = await read(from, size - from)
  const last = tail.lastIndexOf('OggS')
  return last < 0 || last + 14 > tail.length ? null : tail.u64le(last + 6)
}

async function wav(read: Read, size: number): Promise<number | null> {
  let at = 12
  let byteRate = 0
  while (at + 8 <= size) {
    const header = await read(at, 16)
    if (header.length < 8) return null
    const id = header.latin1(0, 4)
    const chunk = header.u32le(4)
    if (id === 'fmt ' && header.length >= 16) byteRate = (await read(at + 8, 12)).u32le(8)
    if (id === 'data') return byteRate > 0 ? Math.min(chunk, size - at - 8) / byteRate : null
    at += 8 + chunk + (chunk % 2)
  }
  return null
}

async function mp4(read: Read, size: number): Promise<number | null> {
  const find = async (from: number, to: number, type: string): Promise<{ bodyAt: number; end: number } | null> => {
    let at = from
    while (at + 8 <= to) {
      const header = await read(at, 16)
      if (header.length < 8) return null
      let atomSize = header.u32be(0)
      let headerLength = 8
      if (atomSize === 1 && header.length >= 16) { atomSize = header.u64be(8); headerLength = 16 }
      else if (atomSize === 0) atomSize = to - at
      if (atomSize < headerLength) return null
      if (header.latin1(4, 8) === type) return { bodyAt: at + headerLength, end: Math.min(to, at + atomSize) }
      at += atomSize
    }
    return null
  }
  const moov = await find(0, size, 'moov')
  const mvhd = moov && await find(moov.bodyAt, moov.end, 'mvhd')
  if (!mvhd) return null
  const body = await read(mvhd.bodyAt, 32)
  if (body.length < 20) return null
  const [scale, duration] = body.at(0) === 1 && body.length >= 32
    ? [body.u32be(20), body.u64be(24)]
    : [body.u32be(12), body.u32be(16)]
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

async function mp3(read: Read, size: number): Promise<number | null> {
  // Past an ID3v2 tag, to the first frame.
  let start = 0
  const id3 = await read(0, 10)
  if (id3.latin1(0, 3) === 'ID3' && id3.length === 10) {
    start = 10 + (((id3.at(6) & 0x7f) << 21) | ((id3.at(7) & 0x7f) << 14) | ((id3.at(8) & 0x7f) << 7) | (id3.at(9) & 0x7f)) + (id3.at(5) & 0x10 ? 10 : 0)
  }
  // Looked for a step at a time: the first frame is almost always right there, and a step overlaps the next by a header.
  for (let from = start; from < start + MP3_SYNC_SEARCH_BYTES; from += MP3_SYNC_STEP_BYTES - 3) {
    const window = await read(from, MP3_SYNC_STEP_BYTES)
    if (window.length < 4) return null
    for (let i = 0; i + 4 <= window.length; i += 1) {
      const frame = await mp3FrameDuration(read, size, window, i, from + i)
      if (frame !== undefined) return frame
    }
  }
  return null
}

/** The duration an MP3 frame header at `window[i]` (file offset `frameAt`) gives, or undefined when it is not one. */
async function mp3FrameDuration(read: Read, size: number, window: Bytes, i: number, frameAt: number): Promise<number | null | undefined> {
  if (window.at(i) !== 0xff || (window.at(i + 1) & 0xe0) !== 0xe0) return undefined
  const versionBits = (window.at(i + 1) >> 3) & 3 // 3 = MPEG 1, 2 = MPEG 2, 0 = MPEG 2.5
  const layerBits = (window.at(i + 1) >> 1) & 3 // 1 = layer 3, 2 = layer 2, 3 = layer 1
  const bitrateIndex = window.at(i + 2) >> 4
  const rateIndex = (window.at(i + 2) >> 2) & 3
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return undefined
  const layer = 4 - layerBits
  const mpeg1 = versionBits === 3
  const kbps = MP3_BITRATES_KBPS[`${mpeg1 ? 1 : 2}-${layer}`][bitrateIndex]
  const rate = MP3_RATES[versionBits][rateIndex]
  const samplesPerFrame = layer === 1 ? 384 : layer === 2 || mpeg1 ? 1152 : 576
  const mono = (window.at(i + 3) >> 6) === 3
  // A Xing/Info header sits after the side information; a VBRI one 32 bytes in.
  const xing = await read(frameAt + 4 + (mpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17)), 12)
  const tag = xing.latin1(0, 4)
  if ((tag === 'Xing' || tag === 'Info') && xing.length >= 12 && (xing.u32be(4) & 1)) {
    return (xing.u32be(8) * samplesPerFrame) / rate
  }
  const vbri = await read(frameAt + 36, 18)
  if (vbri.latin1(0, 4) === 'VBRI' && vbri.length >= 18) return (vbri.u32be(14) * samplesPerFrame) / rate
  // Constant bitrate: the audio's bytes, less an ID3v1 tag at the end.
  const id3v1 = size >= 128 && (await read(size - 128, 3)).latin1() === 'TAG' ? 128 : 0
  return ((size - frameAt - id3v1) * 8) / (kbps * 1000)
}
