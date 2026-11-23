/**
 * The Android app's MusicListening (packages/visualizer/sound/musicListening.ts):
 * what the visualizer reads of the NATIVE music (nativeMusic.ts), whose audio
 * never passes through the page.
 *
 * - The CLOCK: the native player reports what is heard (`heard`: the song,
 *   the seconds into it and the output frame at the playhead) when the song
 *   or the second changes and on play and pause; the page runs it on between
 *   reports by its own clock. The playhead is what is heard, so there is no
 *   output latency to add.
 * - The SONG, for the beat analysis, is the file itself, served to the page
 *   by the app (MusicFileServer.java) at `songUrl`, read and decoded by the
 *   analysis exactly as on the desktop.
 * - The SPECTRUM is computed by the music renderer from what it renders
 *   (packages/visualizer/visualizer/spectrumFrames.ts), ahead of the
 *   playhead, while a spectrum is started and the page is shown; each frame
 *   is stamped with the output frame it describes, and the one drawn is the
 *   newest at or before the playhead.
 */
import type { PluginListenerHandle } from '@capacitor/core'
import type { MusicListening, SpectrumSource } from '@thockdown/visualizer/sound/musicListening'
import { levelDb } from '@thockdown/visualizer/visualizer/spectrumFrames'
import type { NativeMusicPlugin } from './nativeMusic'

/** Must match MusicFileServer.java's PATH. */
const SONG_PATH = '/_music'
/** Frames passed before they are let go, together. */
const PRUNE_FRAMES = 60

/** The URL the app serves the song at `filePath` (a content URI) on. */
export function songUrl(filePath: string): string {
  return `${location.origin}${SONG_PATH}?uri=${encodeURIComponent(filePath)}`
}

/** What the page knows of a song by its id: its file and its length. */
export type SongLookup = (songId: number) => { filePath: string; durationSec: number } | null

interface Heard {
  songId: number | null
  seconds: number
  frame: number
  sampleRate: number
  playing: boolean
  /** `performance.now()` when it arrived, in seconds. */
  at: number
}

interface SpectrumBatch {
  from: number
  first: number
  hop: number
  l: string
}

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function createNativeMusicListening(plugin: NativeMusicPlugin, lookup: SongLookup): MusicListening {
  let heard: Heard = { songId: null, seconds: 0, frame: 0, sampleRate: 48000, playing: false, at: 0 }
  const playingListeners = new Set<(playing: boolean) => void>()
  void plugin.addListener('heard', (data) => {
    const wasPlaying = heard.playing
    heard = { ...data, at: performance.now() / 1000 }
    if (heard.playing !== wasPlaying) for (const listener of playingListeners) listener(heard.playing)
  })

  /** The output frame at the playhead at `nowSec` (performance clock). */
  const playheadFrame = (nowSec: number): number =>
    heard.playing ? heard.frame + Math.max(0, nowSec - heard.at) * heard.sampleRate : heard.frame

  return {
    get isPlaying() { return heard.playing },
    subscribePlaying(listener) {
      playingListeners.add(listener)
      return () => { playingListeners.delete(listener) }
    },
    get trackUrl() {
      const song = heard.songId === null ? null : lookup(heard.songId)
      return song ? songUrl(song.filePath) : null
    },
    get currentTime() {
      return heard.playing ? heard.seconds + Math.max(0, performance.now() / 1000 - heard.at) : heard.seconds
    },
    get currentDurationSec() {
      return heard.songId === null ? 0 : lookup(heard.songId)?.durationSec ?? 0
    },
    setCurrentTimeFraction(fraction) {
      const duration = this.currentDurationSec
      if (duration > 0) void plugin.seek({ seconds: duration * Math.max(0, Math.min(1, fraction)) })
    },
    outputLatencySec: () => 0,
    createSpectrum: (edges) => new NativeSpectrum(plugin, edges.length - 1, playheadFrame),
  }
}

class NativeSpectrum implements SpectrumSource {
  /** The frames held, in stream order: their positions and their quantized levels. */
  private positions: number[] = []
  private levels: Uint8Array[] = []
  private listener: Promise<PluginListenerHandle> | null = null
  private readonly onVisibility = () => this.ask()

  constructor(
    private readonly plugin: NativeMusicPlugin,
    private readonly bands: number,
    private readonly playheadFrame: (nowSec: number) => number,
  ) {}

  start(): void {
    if (this.listener) return
    this.listener = this.plugin.addListener('spectrum', ({ batches }) => this.receive(JSON.parse(batches) as SpectrumBatch[]))
    document.addEventListener('visibilitychange', this.onVisibility)
    this.ask()
  }

  stop(): void {
    if (!this.listener) return
    void this.listener.then((handle) => handle.remove())
    this.listener = null
    document.removeEventListener('visibilitychange', this.onVisibility)
    void this.plugin.setSpectrum({ bands: 0 })
    this.positions = []
    this.levels = []
  }

  sample(nowSec: number, out: Float32Array): void {
    const at = this.playheadFrame(nowSec)
    const index = this.lastAtOrBefore(at)
    if (index < 0) {
      out.fill(-Infinity)
      return
    }
    const levels = this.levels[index]
    for (let band = 0; band < this.bands; band += 1) out[band] = levelDb(levels[band])
    // What lies behind the frame drawn is never drawn again; let go of it a second's worth at a time.
    if (index >= PRUNE_FRAMES) {
      this.positions.splice(0, index)
      this.levels.splice(0, index)
    }
  }

  /** The renderer computes only while the page is shown: a hidden page would queue frames it never draws. */
  private ask(): void {
    void this.plugin.setSpectrum({ bands: document.hidden ? 0 : this.bands })
  }

  private receive(batches: SpectrumBatch[]): void {
    // Frames behind the playhead go even if nothing draws (a spectrum started but not sampled).
    const behind = this.lastAtOrBefore(this.playheadFrame(performance.now() / 1000))
    if (behind > 0) {
      this.positions.splice(0, behind)
      this.levels.splice(0, behind)
    }
    for (const batch of batches) {
      // A batch replaces every frame held from its `from` on (a splice re-rendered them).
      const keep = this.lastAtOrBefore(batch.from - 1) + 1
      this.positions.length = keep
      this.levels.length = keep
      const levels = decodeBase64(batch.l)
      for (let offset = 0, position = batch.first; offset + this.bands <= levels.length; offset += this.bands, position += batch.hop) {
        this.positions.push(position)
        this.levels.push(levels.subarray(offset, offset + this.bands))
      }
    }
  }

  /** The index of the newest frame at or before `position`, or -1. */
  private lastAtOrBefore(position: number): number {
    let low = 0
    let high = this.positions.length - 1
    let found = -1
    while (low <= high) {
      const middle = (low + high) >>> 1
      if (this.positions[middle] <= position) {
        found = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    return found
  }
}
