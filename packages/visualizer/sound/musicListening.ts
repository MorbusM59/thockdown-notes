/**
 * WHAT THE VISUALIZER LISTENS TO: the port through which everything in this
 * package that reads the music heard (the beat analysis, the spectrum, the
 * playhead) reaches the platform's player. The desktop supplies its Web Audio
 * player (`MusicPlayerService`, `desktopMusicListening`); the Android app
 * supplies its native player, whose audio never passes through the page.
 *
 * Each app installs its own with `setMusicListening` before the visualizer
 * mounts. Until one is installed, nothing is playing.
 */

/** The spectrum of the music as it is heard, in log bands (`spectrumBands.ts`). */
export interface SpectrumSource {
  /** Starts listening to the music. Idempotent. */
  start(): void
  stop(): void
  /** Writes into `out` the band levels (dB) the listener hears at `nowSec` (the frame's clock, seconds); silence (-Infinity) while nothing plays. */
  sample(nowSec: number, out: Float32Array): void
}

export interface MusicListening {
  readonly isPlaying: boolean
  /** Calls `listener` whenever playback starts or stops; returns the unsubscribe. */
  subscribePlaying(listener: (playing: boolean) => void): () => void
  /**
   * The song heard, as a URL the beat analysis can fetch with range requests
   * and decode (`musicDecodeStream.ts`), and which names the song: a new
   * URL is a new song. Null with no song.
   */
  readonly trackUrl: string | null
  /** Seconds into the song, on the clock `outputLatencySec` is measured from. */
  readonly currentTime: number
  /** The song's length, or 0 while it is not known. */
  readonly currentDurationSec: number
  /** Go to this share of the song. */
  setCurrentTimeFraction(fraction: number): void
  /** How long after `currentTime` reads a moment the listener hears it. */
  outputLatencySec(): number
  /** The spectrum in `bands` log bands, over `edges` (`logBandEdges(bands)`). */
  createSpectrum(edges: Float64Array): SpectrumSource
}

const silence: MusicListening = {
  isPlaying: false,
  subscribePlaying: () => () => {},
  trackUrl: null,
  currentTime: 0,
  currentDurationSec: 0,
  setCurrentTimeFraction: () => {},
  outputLatencySec: () => 0,
  createSpectrum: () => ({ start: () => {}, stop: () => {}, sample: (_now, out) => { out.fill(-Infinity) } }),
}

let installed: MusicListening = silence

export function setMusicListening(listening: MusicListening): void {
  installed = listening
}

export function musicListening(): MusicListening {
  return installed
}
