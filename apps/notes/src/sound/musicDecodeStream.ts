/**
 * The playing track, DECODED from any moment on, as mono samples stamped
 * with the media time an `<audio>` element plays them at. The visualizer's
 * analysis reads the music from here rather than from a second, silent copy
 * of the track played ahead of the listener: decoding runs far faster than
 * playback, so the analysis has the seconds either side of the listener the
 * moment it asks for them (on a new track, a seek, a changed setting), where
 * a copy played in real time took its whole look-ahead to fill.
 *
 * Only what is asked for is decoded (`run` from a moment, paced by `want`),
 * so memory stays at a few chunks whatever the track's length. Demuxing and
 * decoding are Mediabunny's (WebCodecs' `AudioDecoder` underneath), reading
 * the file through the music protocol's range requests.
 *
 * Its timeline is Chromium's, and the two differ in one place: an mp3's
 * encoder padding, which Chromium drops and Mediabunny keeps
 * (`mp3EncoderDelay.ts`), so an mp3's samples are restamped by that delay.
 * A seek into the middle of a Vorbis or Opus stream lands a few
 * milliseconds early (the decoder's preroll after a reset: 128 samples for
 * Vorbis, the stream's pre-skip for Opus), measured against Chromium's own
 * decode at under 7ms, under half a frame at 60Hz, and left as it is.
 */

import { ALL_FORMATS, AudioSampleSink, Input, UrlSource } from 'mediabunny'
import { mp3EncoderDelaySec, mp3TagOffset } from './mp3EncoderDelay'

/** Bytes the reader may cache: a few seconds of any format, not the file. */
const MAX_CACHE_BYTES = 4 * 1024 * 1024
/** Bytes read after the ID3 tag for the mp3 frame holding the LAME tag. */
const MP3_TAG_READ = 2048

/** Takes `samples`, mono, whose first one plays at media time `startTime`; the array is reused for the next chunk, so it is read during the call and not kept. */
export type DecodedChunk = (samples: Float32Array, startTime: number) => void

interface Opened {
  sink: AudioSampleSink
  sampleRate: number
  /** Added to every decoded timestamp to put it on the element's timeline. */
  shiftSec: number
}

async function readBytes(url: string, from: number, count: number): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { Range: `bytes=${from}-${from + count - 1}` } })
  return new Uint8Array(await response.arrayBuffer())
}

async function open(url: string, input: Input): Promise<Opened | null> {
  const track = await input.getPrimaryAudioTrack()
  if (!track || !(await track.canDecode())) return null
  let shiftSec = 0
  if (track.codec === 'mp3') {
    const offset = mp3TagOffset(await readBytes(url, 0, 10))
    shiftSec = mp3EncoderDelaySec(await readBytes(url, offset, MP3_TAG_READ))
  }
  return { sink: new AudioSampleSink(track), sampleRate: track.sampleRate, shiftSec }
}

export class MusicDecodeStream {
  readonly url: string
  private readonly input: Input
  private readonly opened: Promise<Opened | null>
  /** The current run; a new run or `dispose` moves it on and the old one stops at its next chunk. */
  private generation = 0
  private wanted = 0
  private frontier = 0
  private wake: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    this.input = new Input({
      formats: ALL_FORMATS,
      // A local file: a failed read is a missing or unreadable file, never one worth retrying.
      source: new UrlSource(url, { maxCacheSize: MAX_CACHE_BYTES, getRetryDelay: () => null }),
    })
    this.opened = open(url, this.input).catch(() => null)
  }

  /** The decoded sample rate, once the file is open (null if it cannot be decoded). */
  async sampleRate(): Promise<number | null> {
    return (await this.opened)?.sampleRate ?? null
  }

  /**
   * Decodes from media time `fromSec`, handing each chunk to `onChunk`,
   * until the chunks reach what `want` last asked for; a later `want` takes
   * it on from there. Replaces any run in progress.
   */
  run(fromSec: number, untilSec: number, onChunk: DecodedChunk): void {
    const generation = ++this.generation
    this.wanted = untilSec
    this.frontier = fromSec
    this.release()
    void this.decode(generation, fromSec, onChunk)
  }

  /** Lets the current run decode on to media time `untilSec`. */
  want(untilSec: number): void {
    if (untilSec <= this.wanted) return
    this.wanted = untilSec
    if (this.frontier < untilSec) this.release()
  }

  /** Stops the current run. */
  halt(): void {
    this.generation++
    this.release()
  }

  dispose(): void {
    this.halt()
    this.input.dispose()
  }

  private release(): void {
    const wake = this.wake
    this.wake = null
    wake?.()
  }

  private async decode(generation: number, fromSec: number, onChunk: DecodedChunk): Promise<void> {
    const opened = await this.opened
    if (!opened || generation !== this.generation) return
    const { sink, sampleRate, shiftSec } = opened
    let mono = new Float32Array(0)
    let plane = new Float32Array(0)
    try {
      for await (const sample of sink.samples(Math.max(0, fromSec - shiftSec))) {
        if (generation !== this.generation) {
          sample.close()
          break
        }
        const frames = sample.numberOfFrames
        const channels = sample.numberOfChannels
        if (mono.length !== frames) {
          mono = new Float32Array(frames)
          plane = new Float32Array(frames)
        }
        mono.fill(0)
        for (let c = 0; c < channels; c++) {
          sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' })
          for (let i = 0; i < frames; i++) mono[i] += plane[i]
        }
        if (channels > 1) for (let i = 0; i < frames; i++) mono[i] /= channels
        const startTime = sample.timestamp + shiftSec
        sample.close()
        onChunk(mono, startTime)
        this.frontier = startTime + frames / sampleRate
        while (generation === this.generation && this.frontier >= this.wanted) {
          await new Promise<void>((resolve) => { this.wake = resolve })
        }
        if (generation !== this.generation) break
      }
    } catch {
      // A file that stops decoding part-way (truncated, corrupt) ends the run where it broke.
    }
  }
}
