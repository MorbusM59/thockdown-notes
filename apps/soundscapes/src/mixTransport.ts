/**
 * The MIX's transport: the music and the soundscape played and paused
 * together, as the dashboard's transport button and the visualizer's orb both
 * drive them (one rule, so the two cannot disagree about what a tap does).
 *
 * A button shows what a press WILL DO, not what is: play while nothing is
 * heard, pause while anything is. There is no stop: pausing during a
 * scheduled run switches the schedule off, visibly, rather than holding it
 * back unseen (SoundscapePlaybackService.pauseAll).
 */
import { pauseMusic, startMusic } from './mobileMusicPlayer'
import type { RegularMode } from './backgroundAudioHost'

/** Regular mode as this page sets it (MobileSoundscapeApp's `setRegularMode`). */
export type SoundscapeTransport = (mode: 'playing' | 'paused') => void

/** Whether the transport has anything to pause: the listener's music, or a soundscape heard (theirs or the schedule's). */
export function mixHeard(musicPlaying: boolean, soundscapeHeard: boolean): boolean {
  return musicPlaying || soundscapeHeard
}

/** A tap: pauses whatever is heard (`pauseSoundscape`), else plays both. */
export function toggleMix(heard: boolean, setSoundscape: SoundscapeTransport, pauseSoundscape: () => void): void {
  if (heard) {
    pauseMusic()
    pauseSoundscape()
  } else {
    void startMusic()
    setSoundscape('playing')
  }
}

/** Switches the soundscape's channel; switched in while the mix plays, the soundscape joins it at once rather than waiting for the next play. */
export function switchSoundscapeChannel(on: boolean, heard: boolean, soundscape: RegularMode, setSoundscape: SoundscapeTransport, setChannel: (on: boolean) => void): void {
  if (on && heard && soundscape !== 'playing') setSoundscape('playing')
  setChannel(on)
}
