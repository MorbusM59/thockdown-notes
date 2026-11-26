/**
 * The MIX's transport: the music and the soundscape played, paused and stopped
 * together, as the dashboard's transport button and the visualizer's orb both
 * drive them (one rule, so the two cannot disagree about what a tap does).
 */
import { pauseMusic, startMusic } from './mobileMusicPlayer'

export type MixState = 'playing' | 'paused' | 'stopped'
/** Regular mode as this page sets it (MobileSoundscapeApp's `setRegularMode`). */
export type SoundscapeTransport = (mode: 'playing' | 'paused') => void

/** The mix plays while either does; it is stopped only with the soundscape stopped and the music not playing. */
export function mixStateOf(musicPlaying: boolean, soundscape: MixState): MixState {
  return musicPlaying || soundscape === 'playing' ? 'playing' : soundscape === 'stopped' ? 'stopped' : 'paused'
}

/** A tap: pauses a playing mix, else plays both. */
export function toggleMix(mix: MixState, soundscape: MixState, setSoundscape: SoundscapeTransport): void {
  if (mix === 'playing') {
    pauseMusic()
    if (soundscape === 'playing') setSoundscape('paused')
  } else {
    void startMusic()
    setSoundscape('playing')
  }
}

/** A hold: stops both (the soundscape hands back to the schedule). */
export function stopMix(stopSoundscape: () => void): void {
  pauseMusic()
  stopSoundscape()
}

/** Switches the soundscape's channel; switched in while the mix plays, the soundscape joins it at once rather than waiting for the next play. */
export function switchSoundscapeChannel(on: boolean, mix: MixState, soundscape: MixState, setSoundscape: SoundscapeTransport, setChannel: (on: boolean) => void): void {
  if (on && mix === 'playing' && soundscape !== 'playing') setSoundscape('playing')
  setChannel(on)
}
