/**
 * WHAT THE VISUALIZER LISTENS TO: the port through which everything in this
 * package that reads the music heard (the beat analysis, the spectrum, the
 * playhead) reaches the platform's player. The desktop supplies its Web Audio
 * player (`MusicPlayerService`, `desktopMusicListening`); the Android app
 * supplies its native player, whose audio never passes through the page.
 *
 * Each app installs its own with `setMusicListening`; until one is
 * installed, nothing is playing. An app may install it late (the phone does,
 * after reading its library), so whoever follows the play state goes through
 * `subscribeMusicPlaying`, which follows the listening INSTALLED rather than
 * the one there when it subscribed: subscribing to `musicListening()` directly
 * kept the silent stand-in's subscription for good, and the beat analysis of
 * a song started after that never ran.
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

/** Every play-state follower, each bound to the installed listening (`subscribeMusicPlaying`). */
const playingFollowers = new Map<(playing: boolean) => void, () => void>()

export function setMusicListening(listening: MusicListening): void {
  if (listening === installed) return
  const wasPlaying = installed.isPlaying
  installed = listening
  for (const [listener, unsubscribe] of playingFollowers) {
    unsubscribe()
    playingFollowers.set(listener, listening.subscribePlaying(listener))
    if (listening.isPlaying !== wasPlaying) listener(listening.isPlaying)
  }
}

/**
 * Calls `listener` whenever the music heard starts or stops, through whichever
 * listening is installed now or later (a new one that plays when the old did
 * not, or the reverse, counts as a change); returns the unsubscribe.
 */
export function subscribeMusicPlaying(listener: (playing: boolean) => void): () => void {
  // Wrapped, so one function subscribed twice is two followers.
  const follower = (playing: boolean) => listener(playing)
  playingFollowers.set(follower, installed.subscribePlaying(follower))
  return () => {
    playingFollowers.get(follower)?.()
    playingFollowers.delete(follower)
  }
}

export function musicListening(): MusicListening {
  return installed
}
