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
 *   newest at or before the playhead. The SOUNDSCAPE's, when the spectrum
 *   takes it too (packages/visualizer/visualizer/spectrumMix.ts), is computed
 *   the same way by the soundscape's renderer (soundscapeRenderer.ts), stamped
 *   with that output's own frames, and each band's power is added to the
 *   music's at the weights the two are heard at.
 */
import type { PluginListenerHandle } from '@capacitor/core'
import type { MusicListening, SpectrumSource } from '@thockdown/visualizer/sound/musicListening'
import { levelDb } from '@thockdown/visualizer/visualizer/spectrumFrames'
import { addBandLevels, spectrumIncludesSoundscape, spectrumMixWeights } from '@thockdown/visualizer/visualizer/spectrumMix'
import type { NativeSoundscapePlugin, SessionState } from './backgroundAudioHost'
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

/**
 * What the spectrum needs to show the soundscape beside the music: the
 * soundscape session (its spectrum and whether it is heard) and the gains
 * the page has each heard at (its volume sliders and channel switches).
 */
export interface SpectrumMixPort {
  soundscape: Pick<NativeSoundscapePlugin, 'setSpectrum' | 'getState' | 'addListener'>
  musicGain(): number
  soundscapeGain(): number
}

/** The gain the page has the soundscape at (its volume slider and channel switch), set by MobileSoundscapeApp. */
let soundscapeVolume = 0

export function setSoundscapeSpectrumVolume(gain: number): void {
  soundscapeVolume = gain
}

export function soundscapeSpectrumVolume(): number {
  return soundscapeVolume
}

/** Without a port the spectrum is the music's alone, at full scale. */
const MUSIC_ALONE = { musicGain: () => 1, soundscapeGain: () => 0 }

export function createNativeMusicListening(plugin: NativeMusicPlugin, lookup: SongLookup, mix: SpectrumMixPort | null = null): MusicListening {
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
    createSpectrum: (edges) => new NativeSpectrum(plugin, edges.length - 1, playheadFrame, () => heard.playing, () => heard.sampleRate, mix),
  }
}

/**
 * The frames one renderer has sent, in stream order: their positions and
 * their quantized levels. A batch replaces every frame held from its `from`
 * on (a splice re-rendered them).
 */
class FrameQueue {
  private positions: number[] = []
  private levels: Uint8Array[] = []

  constructor(private readonly bands: number) {}

  clear(): void {
    this.positions = []
    this.levels = []
  }

  /** Takes `batches`, first letting go of the frames behind `playhead` (even if nothing draws: a spectrum started but not sampled). */
  receive(batches: SpectrumBatch[], playhead: number): void {
    this.prune(this.lastAtOrBefore(playhead))
    for (const batch of batches) {
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

  /** The levels of the newest frame at or before `position`, or null; what lies behind it is let go a second's worth at a time. */
  at(position: number): Uint8Array | null {
    const index = this.lastAtOrBefore(position)
    if (index < 0) return null
    const levels = this.levels[index]
    if (index >= PRUNE_FRAMES) this.prune(index)
    return levels
  }

  private prune(count: number): void {
    if (count <= 0) return
    this.positions.splice(0, count)
    this.levels.splice(0, count)
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

/** How far the soundscape's playhead is run on past its last report: the renderer reports on every chunk while it plays. */
const SOUNDSCAPE_RUN_ON_SEC = 1

/** Whether the soundscape session is heard: the listener's choice while it plays, or the schedule's run. */
function soundscapeHeard(state: SessionState): boolean {
  return state.source === 'regular' ? state.regular === 'playing' : state.source === 'schedule'
}

class NativeSpectrum implements SpectrumSource {
  private readonly music: FrameQueue
  private readonly soundscape: FrameQueue
  private listeners: Array<Promise<PluginListenerHandle>> = []
  private readonly onVisibility = () => this.ask()
  /** The soundscape output's playhead as last reported, when (performance clock, seconds), and whether its session is heard. */
  private soundscapePlayhead = 0
  private soundscapeReportedAt = -Infinity
  private soundscapePlaying = false
  /** Whether the soundscape's spectrum was last asked for, so a change of the setting asks again. */
  private soundscapeAsked = false

  constructor(
    private readonly plugin: NativeMusicPlugin,
    private readonly bands: number,
    private readonly playheadFrame: (nowSec: number) => number,
    private readonly musicPlaying: () => boolean,
    private readonly sampleRate: () => number,
    private readonly mix: SpectrumMixPort | null,
  ) {
    this.music = new FrameQueue(bands)
    this.soundscape = new FrameQueue(bands)
  }

  start(): void {
    if (this.listeners.length > 0) return
    this.listeners.push(this.plugin.addListener('spectrum', ({ batches }) =>
      this.music.receive(JSON.parse(batches) as SpectrumBatch[], this.playheadFrame(performance.now() / 1000))))
    const session = this.mix?.soundscape
    if (session) {
      this.listeners.push(session.addListener('spectrum', ({ batches, playhead }) => {
        this.soundscapePlayhead = playhead
        this.soundscapeReportedAt = performance.now() / 1000
        this.soundscape.receive(JSON.parse(batches) as SpectrumBatch[], playhead)
      }))
      this.listeners.push(session.addListener('sessionChanged', (state) => { this.soundscapePlaying = soundscapeHeard(state) }))
      void session.getState().then((state) => { this.soundscapePlaying = soundscapeHeard(state) })
    }
    document.addEventListener('visibilitychange', this.onVisibility)
    this.ask()
  }

  stop(): void {
    if (this.listeners.length === 0) return
    for (const listener of this.listeners) void listener.then((handle) => handle.remove())
    this.listeners = []
    document.removeEventListener('visibilitychange', this.onVisibility)
    void this.plugin.setSpectrum({ bands: 0 })
    if (this.soundscapeAsked) void this.mix?.soundscape.setSpectrum({ bands: 0 })
    this.soundscapeAsked = false
    this.music.clear()
    this.soundscape.clear()
  }

  get hearing(): boolean {
    const weights = this.weights()
    return weights.music > 0 || weights.soundscape > 0
  }

  sample(nowSec: number, out: Float32Array): void {
    if (this.listeners.length > 0 && this.soundscapeAsked !== this.wantsSoundscape()) this.askSoundscape()
    const weights = this.weights()
    const music = weights.music > 0 ? this.music.at(this.playheadFrame(nowSec)) : null
    const soundscape = weights.soundscape > 0 ? this.soundscape.at(this.soundscapeFrame(nowSec)) : null
    if (!soundscape) {
      if (!music) {
        out.fill(-Infinity)
        return
      }
      const shiftDb = 20 * Math.log10(weights.music)
      for (let band = 0; band < this.bands; band += 1) out[band] = levelDb(music[band]) + shiftDb
      return
    }
    for (let band = 0; band < this.bands; band += 1) {
      out[band] = addBandLevels(music ? levelDb(music[band]) : -Infinity, music ? weights.music : 0, levelDb(soundscape[band]), weights.soundscape)
    }
  }

  private weights() {
    const mix = this.mix ?? MUSIC_ALONE
    return spectrumMixWeights(
      this.musicPlaying() ? mix.musicGain() : 0,
      this.mix && this.soundscapePlaying ? mix.soundscapeGain() : 0,
    )
  }

  /** The soundscape output's frame at `nowSec`: its last report run on by the clock, for at most `SOUNDSCAPE_RUN_ON_SEC`. */
  private soundscapeFrame(nowSec: number): number {
    const since = Math.min(SOUNDSCAPE_RUN_ON_SEC, Math.max(0, nowSec - this.soundscapeReportedAt))
    return this.soundscapePlayhead + since * this.sampleRate()
  }

  private wantsSoundscape(): boolean {
    return this.mix !== null && spectrumIncludesSoundscape() && !document.hidden
  }

  /** The renderers compute only while the page is shown: a hidden page would queue frames it never draws. The soundscape's only while the spectrum takes it. */
  private ask(): void {
    void this.plugin.setSpectrum({ bands: document.hidden ? 0 : this.bands })
    this.askSoundscape()
  }

  private askSoundscape(): void {
    const soundscape = this.wantsSoundscape()
    if (soundscape === this.soundscapeAsked) return
    void this.mix?.soundscape.setSpectrum({ bands: soundscape ? this.bands : 0 })
    if (!soundscape) this.soundscape.clear()
    this.soundscapeAsked = soundscape
  }
}
