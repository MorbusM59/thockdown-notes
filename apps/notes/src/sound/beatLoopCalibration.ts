/**
 * Calibration of the visual delay (`BeatSettings.delayMsByDevice`) by
 * watching the grid beat on a track whose drums are KNOWN: `assets/sounds/loop.wav`,
 * 16 s built for this, its rhythm repeating every four seconds. The hits are
 * written down here (`LOOP_SCORE`) rather than detected, so what is judged is
 * the timing alone; the reader moves the delay until the effects land on
 * what they hear (`sidebar/BeatLoopCalibration.tsx`).
 *
 * Tapping measured the reader's reaction and their input device along with
 * the audio path (a wireless keyboard adds its own delay before a press is
 * seen), and read 150 ms high on a wired headset whose visuals were right at
 * 0. Seeing against hearing has neither, and includes the screen's own delay,
 * as the music's visuals do.
 *
 * So that a match here is a match for the music, the loop takes the music's
 * path (an `<audio>` element through a MediaElementSource into the shared
 * output), is read on the same `SmoothClock` the beat pulse reads the music
 * with, and is drawn at the heard time the pulse uses (`heardLagSec`): the
 * media time less the reported output latency and the delay being set. The
 * delay is the caller's rather than what the pulse was last told, so a nudge
 * shows on the very next frame.
 */

import { connectToOutput, resumedOutputContext } from '@thockdown/soundscape/audioOutputBus'
import { outputLatencySec } from './musicBeat'
import { SmoothClock } from './smoothClock'

const LOOP_URL = new URL('../assets/sounds/loop.wav', import.meta.url).href
/** Seconds after which the rhythm repeats; the track is four of them. */
export const LOOP_BAR_SEC = 4

export type LoopChannel = 'thump' | 'pierce' | 'tick'

/** A hit: when in the bar, and how strong (0..1). */
export interface LoopHit {
  sec: number
  strength: number
}

/** The ticks with a rim shot on them (the 3rd and 15th of 24, at 0.333 and 2.333): louder, so drawn stronger. */
const RIM_SHOT_TICKS = new Set([2, 14])
/** An ordinary tick's strength beside a rim shot's 1. */
const PLAIN_TICK = 0.5

/**
 * The hits of one four-second bar, as the loop was programmed (its author's
 * figures). Measured against the audio, every snare and hat attack starts
 * within 2 ms of these (snare 0.998 and 2.999; hats 0.166, 0.330, 0.499 ...),
 * and the rim shots show as mid-range attacks at 0.330 and 2.331.
 */
export const LOOP_SCORE: Readonly<Record<LoopChannel, readonly LoopHit[]>> = {
  thump: [0, 0.8335, 2.3315, 2.8335].map((sec) => ({ sec, strength: 1 })),
  pierce: [1, 3].map((sec) => ({ sec, strength: 1 })),
  // Sextuplets: 24 to the bar, from 0.
  tick: Array.from({ length: 24 }, (_, i) => ({ sec: (i * LOOP_BAR_SEC) / 24, strength: RIM_SHOT_TICKS.has(i) ? 1 : PLAIN_TICK })),
}

/** The latest hit of `channel` at bar time `barSec` (0..LOOP_BAR_SEC), and how long ago it was; a hit late in the bar is still falling at the start of the next. */
export function lastHit(channel: LoopChannel, barSec: number): { strength: number; agoSec: number } {
  let latest = { strength: 0, agoSec: Infinity }
  for (const hit of LOOP_SCORE[channel]) {
    const ago = barSec - hit.sec
    const agoSec = ago >= 0 ? ago : ago + LOOP_BAR_SEC
    if (agoSec < latest.agoSec) latest = { strength: hit.strength, agoSec }
  }
  return latest
}

export interface LoopRun {
  /** Where in its bar (0..LOOP_BAR_SEC) the loop the reader is hearing now is; NaN before the first report. */
  heardBarSec(frameTimeMs: number, delaySec: number): number
  stop(): void
}

/** Starts the loop; `onFailed` is told if it cannot play. */
export function startBeatLoop(onFailed: () => void): LoopRun {
  const element = new Audio(LOOP_URL)
  element.loop = true
  const clock = new SmoothClock()
  let source: MediaElementAudioSourceNode | null = null
  let over = false

  void (async () => {
    try {
      const context = await resumedOutputContext()
      if (over) return
      source = context.createMediaElementSource(element)
      connectToOutput(source)
      await element.play()
    } catch {
      if (!over) onFailed()
    }
  })()

  return {
    heardBarSec(frameTimeMs, delaySec) {
      if (element.paused || element.readyState < 2) return NaN
      // The track's own wrap back to 0 is a jump of 16 s, which the clock takes as a seek.
      const heard = clock.read(element.currentTime, frameTimeMs / 1000) - outputLatencySec() - delaySec
      return heard - Math.floor(heard / LOOP_BAR_SEC) * LOOP_BAR_SEC
    },
    stop() {
      over = true
      element.pause()
      source?.disconnect()
    },
  }
}
