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
 * the file through BOUNDED range requests (`bytes=a-b`, each read whole):
 * Mediabunny's own `UrlSource` asks for the rest of the file (`bytes=a-`)
 * and abandons the response once it has what it needs, which a real HTTP
 * server shrugs off and the Android WebView's request interception does not
 * (MusicFileServer.java): there it made ten times the requests and, a
 * couple of minutes into a song, refused one, ending the decode.
 *
 * Its timeline is Chromium's, and the two differ in one place: an mp3's
 * encoder padding, which Chromium drops and Mediabunny keeps
 * (`mp3EncoderDelay.ts`), so an mp3's samples are restamped by that delay.
 * A seek into the middle of a Vorbis or Opus stream lands a few
 * milliseconds early (the decoder's preroll after a reset: 128 samples for
 * Vorbis, the stream's pre-skip for Opus), measured against Chromium's own
 * decode at under 7ms, under half a frame at 60Hz, and left as it is.
 */

import { ALL_FORMATS, AudioSampleSink, CustomSource, Input } from 'mediabunny'
import { mp3EncoderDelaySec, mp3TagOffset } from './mp3EncoderDelay'

/**
 * Bytes the reader may cache. More than Mediabunny's largest sequential prefetch (8 MiB): with less, a prefetched
 * block was evicted before it was read and fetched again, two and a half times the file in all; with this, every
 * byte is read once, an 8 MiB request every minute or so of FLAC, whatever the file's length.
 */
const MAX_CACHE_BYTES = 16 * 1024 * 1024
/** Bytes read after the ID3 tag for the mp3 frame holding the LAME tag. */
const MP3_TAG_READ = 2048

/** Takes `samples`, mono, whose first one plays at media time `startTime`; the array is reused for the next chunk, so it is read during the call and not kept. */
export type DecodedChunk = (samples: Float32Array, startTime: number) => void

/** Told how a run ended on its own: at the end of the file (`error` null) or part-way, by what broke it. Not told of a run replaced or halted. */
export type DecodeEnded = (atSec: number, error: string | null) => void

interface Opened {
  sink: AudioSampleSink
  sampleRate: number
  /** Taken off every decoded timestamp to put it on the element's timeline. */
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
  /** Range requests made, and those not yet answered, for the trace (`describe`). */
  private fetches = 0
  private pending = 0
  /** Why the file could not be opened, for the trace; null while it opens or once it has. */
  private openFailed: string | null = null

  constructor(url: string) {
    this.url = url
    this.input = new Input({
      formats: ALL_FORMATS,
      source: new CustomSource({
        getSize: () => this.size(),
        read: (start, end) => this.readRange(start, end),
        maxCacheSize: MAX_CACHE_BYTES,
        prefetchProfile: 'network',
      }),
    })
    this.opened = open(url, this.input).catch((error: unknown) => {
      this.openFailed = error instanceof Error ? error.message : String(error)
      return null
    })
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
  run(fromSec: number, untilSec: number, onChunk: DecodedChunk, onEnded?: DecodeEnded): void {
    const generation = ++this.generation
    this.wanted = untilSec
    this.frontier = fromSec
    this.release()
    void this.decode(generation, fromSec, onChunk, onEnded)
  }

  /** Lets the current run decode on to media time `untilSec`. */
  want(untilSec: number): void {
    if (untilSec <= this.wanted) return
    this.wanted = untilSec
    if (this.frontier < untilSec) this.release()
  }

  /**
   * The file's length: the total of a one-byte range's Content-Range. Never the Content-Length of a whole-file
   * answer: the Android WebView did not give the page a usable one for its request interception's response
   * (MusicFileServer.java), the file never opened, and the phone's visualizer had no beat map at all. The desktop's music scheme, cross-origin, exposes Content-Range for this
   * (main.ts's CORS_HEADERS).
   */
  private async size(): Promise<number> {
    const response = await this.fetchRange(0, 1)
    void response.body?.cancel()
    const total = Number(/\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '')?.[1])
    if (response.status !== 206 || !(total > 0)) throw new Error(`no length (status ${response.status}, Content-Range ${response.headers.get('Content-Range')})`)
    return total
  }

  /** Bytes `start` up to (not including) `end`. A local file: a failed read is a missing or unreadable file, never one worth retrying. */
  private async readRange(start: number, end: number): Promise<Uint8Array> {
    const response = await this.fetchRange(start, end)
    if (response.status !== 206) throw new Error(`range ${start}-${end - 1} answered ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  }

  private async fetchRange(start: number, end: number): Promise<Response> {
    this.fetches++
    this.pending++
    try {
      return await fetch(this.url, { headers: { Range: `bytes=${start}-${end - 1}` } })
    } finally {
      this.pending--
    }
  }

  /** Where decoding has got to and what the file has been asked, for the beat trace. */
  describe(): string {
    return `decoded=${this.frontier.toFixed(1)} wanted=${this.wanted.toFixed(1)} waiting=${this.wake !== null} fetches=${this.fetches} unanswered=${this.pending}${this.openFailed === null ? '' : ` open failed: ${this.openFailed}`}`
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

  private async decode(generation: number, fromSec: number, onChunk: DecodedChunk, onEnded?: DecodeEnded): Promise<void> {
    const opened = await this.opened
    if (!opened || generation !== this.generation) return
    const { sink, sampleRate, shiftSec } = opened
    let mono = new Float32Array(0)
    let plane = new Float32Array(0)
    try {
      for await (const sample of sink.samples(Math.max(0, fromSec + shiftSec))) {
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
        const startTime = sample.timestamp - shiftSec
        sample.close()
        onChunk(mono, startTime)
        this.frontier = startTime + frames / sampleRate
        while (generation === this.generation && this.frontier >= this.wanted) {
          await new Promise<void>((resolve) => { this.wake = resolve })
        }
        if (generation !== this.generation) break
      }
      if (generation === this.generation) onEnded?.(this.frontier, null)
    } catch (error) {
      // A file that stops decoding part-way (truncated, corrupt, a read the transport refused) ends the run where it broke.
      if (generation === this.generation) onEnded?.(this.frontier, error instanceof Error ? `${error.name}: ${error.message}` : String(error))
    }
  }
}
