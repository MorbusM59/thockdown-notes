/**
 * Calibration of the visual delay (`BeatSettings.delayMsByDevice`) by
 * watching the grid beat on tracks whose drums are KNOWN: the loops in
 * `assets/sounds/loops/` (`BEAT_LOOPS`), built for this. Their hits are
 * written down here (each loop's `score`) rather than detected, so what is judged is
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

const LOOP_MIME = 'audio/mp4; codecs="flac"'
/** How much of the loop is kept queued ahead of the listener, and behind them before it is let go. */
const AHEAD_SEC = 32
const BEHIND_SEC = 4

/** The file split where the media starts: the header boxes (ftyp, moov) and the fragment (moof, mdat); anything after (mfra) is not media. */
function splitFragmentedMp4(bytes: Uint8Array<ArrayBuffer>): { init: Uint8Array<ArrayBuffer>; media: Uint8Array<ArrayBuffer> } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let mediaStart = -1
  let mediaEnd = bytes.length
  for (let at = 0; at + 8 <= bytes.length;) {
    const size = view.getUint32(at)
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7])
    if (type === 'moof' && mediaStart < 0) mediaStart = at
    if (type === 'mfra') mediaEnd = at
    if (size < 8) break
    at += size
  }
  if (mediaStart < 0) throw new Error('the loop has no fragment')
  return { init: bytes.subarray(0, mediaStart), media: bytes.subarray(mediaStart, mediaEnd) }
}

export type LoopChannel = 'thump' | 'pierce' | 'tick'

/** A hit: when in the bar, and how strong (0..1). */
export interface LoopHit {
  sec: number
  strength: number
}

/** What a loop's score holds: every channel's hits in one bar. */
export type LoopScore = Readonly<Record<LoopChannel, readonly LoopHit[]>>

/**
 * A calibration loop. Each `.mp4` is its `.wav` stored losslessly as FLAC in
 * one fragment of a fragmented MP4, the form Media Source Extensions take:
 *   ffmpeg -i NN.wav -c:a flac -sample_fmt s16 -f mp4 \
 *     -movflags +frag_keyframe+empty_moov+default_base_moof+omit_tfhd_offset -frag_duration 16000000 NN.mp4
 */
export interface BeatLoop {
  url: string
  /** The track's length, exactly: its frame count over its rate. */
  trackSec: number
  /** Seconds after which the rhythm repeats; the track is a whole number of them. */
  barSec: number
  /** The hits of one bar, as the loop was programmed (its author's piano roll or MIDI). */
  score: LoopScore
}

/**
 * Hits at sixteenths of a bar, each with its strength. `swing` delays the
 * off sixteenths (the 2nd and 4th of each beat) by that share of a sixteenth.
 */
function atSixteenths(barSec: number, hits: Readonly<Record<number, number>>, swing = 0): LoopHit[] {
  const sixteenthSec = barSec / 16
  return Object.entries(hits).map(([at, strength]) => {
    const sixteenth = Number(at)
    return { sec: (sixteenth + (sixteenth % 2) * swing) * sixteenthSec, strength }
  })
}

/** 01: four bars at 87 BPM (529656 frames at 48 kHz). */
const LOOP_01_BAR_SEC = 529656 / 48000 / 4
/**
 * 01 is played with Ableton's "Swing 16-85" groove: its hits on the off
 * sixteenths measure 0.40 to 0.46 of a sixteenth (32 to 37 ms) late.
 */
const LOOP_01_SWING = 0.42

/** 02: 16 s (768000 frames), its rhythm repeating every four seconds; the ticks are sextuplets, 24 to the bar. */
const LOOP_02_BAR_SEC = 4
/** 02's ticks with a rim shot on them (the 3rd, 6th, 15th and 18th of 24): louder, so drawn stronger. */
const LOOP_02_RIM_SHOTS = new Set([2, 5, 14, 17])

/** 03: eight bars at 120 BPM, no swing (768000 frames). */
const LOOP_03_BAR_SEC = 2

/** The loops, in the order a press steps through them. */
export const BEAT_LOOPS: readonly BeatLoop[] = [
  {
    url: new URL('../assets/sounds/loops/01.mp4', import.meta.url).href,
    trackSec: 529656 / 48000,
    barSec: LOOP_01_BAR_SEC,
    score: {
      thump: atSixteenths(LOOP_01_BAR_SEC, { 0: 1, 2: 1, 9: 0.3, 10: 1, 13: 1 }, LOOP_01_SWING),
      pierce: atSixteenths(LOOP_01_BAR_SEC, { 4: 1, 7: 0.5, 12: 1 }, LOOP_01_SWING),
      tick: atSixteenths(LOOP_01_BAR_SEC, { 0: 1, 2: 1, 4: 1, 6: 0.5, 8: 0.5, 10: 1, 12: 1, 14: 0.5 }, LOOP_01_SWING),
    },
  },
  {
    url: new URL('../assets/sounds/loops/02.mp4', import.meta.url).href,
    trackSec: 16,
    barSec: LOOP_02_BAR_SEC,
    score: {
      thump: [0, 0.8335, 2.3315, 2.8335].map((sec) => ({ sec, strength: 1 })),
      pierce: [1, 3].map((sec) => ({ sec, strength: 1 })),
      tick: Array.from({ length: 24 }, (_, i) => ({ sec: (i * LOOP_02_BAR_SEC) / 24, strength: LOOP_02_RIM_SHOTS.has(i) ? 1 : 0.5 })),
    },
  },
  {
    url: new URL('../assets/sounds/loops/03.mp4', import.meta.url).href,
    trackSec: 16,
    barSec: LOOP_03_BAR_SEC,
    score: {
      thump: atSixteenths(LOOP_03_BAR_SEC, { 0: 1, 10: 1, 13: 1 }),
      pierce: atSixteenths(LOOP_03_BAR_SEC, { 6: 1 }),
      tick: atSixteenths(LOOP_03_BAR_SEC, { 4: 1, 12: 1 }),
    },
  },
]

/** The latest hit of `channel` at bar time `barSec` (0..the loop's bar), and how long ago it was; a hit late in the bar is still falling at the start of the next. */
export function lastHit(loop: BeatLoop, channel: LoopChannel, barSec: number): { strength: number; agoSec: number } {
  let latest = { strength: 0, agoSec: Infinity }
  for (const hit of loop.score[channel]) {
    const ago = barSec - hit.sec
    const agoSec = ago >= 0 ? ago : ago + loop.barSec
    if (agoSec < latest.agoSec) latest = { strength: hit.strength, agoSec }
  }
  return latest
}

export interface LoopRun {
  /** Where in its bar (0..its bar) the loop the reader is hearing now is; NaN before the first report. */
  heardBarSec(frameTimeMs: number, delaySec: number): number
  stop(): void
}

/**
 * Starts the loop; `onFailed` is told if it cannot play. Seamless: rather
 * than an element looping a file (which restarts it, with a gap, and jumps
 * its position back), the same fragment is appended to a MediaSource again
 * and again, each copy placed one track length after the last (`timestampOffset`), so
 * the element plays one endless track and its position only ever runs on.
 * Whenever the element reports its position, what is queued is topped up to
 * AHEAD_SEC and what lies more than BEHIND_SEC behind is let go, so the
 * memory held stays at a few copies.
 */
export function startBeatLoop(loop: BeatLoop, onFailed: () => void): LoopRun {
  const element = new Audio()
  const mediaSource = new MediaSource()
  const clock = new SmoothClock()
  let source: MediaElementAudioSourceNode | null = null
  let over = false
  const fail = () => {
    if (!over) onFailed()
  }

  void (async () => {
    try {
      const fetched = fetch(loop.url).then((response) => response.arrayBuffer())
      element.src = URL.createObjectURL(mediaSource)
      await new Promise((resolve) => mediaSource.addEventListener('sourceopen', resolve, { once: true }))
      URL.revokeObjectURL(element.src)
      if (over) return
      const buffer = mediaSource.addSourceBuffer(LOOP_MIME)
      const { init, media } = splitFragmentedMp4(new Uint8Array(await fetched))
      let initialised = false
      // Copies of the fragment appended so far; the next starts where they end.
      let copies = 0
      // One operation at a time: a SourceBuffer takes the next only after 'updateend'.
      const service = () => {
        if (over || buffer.updating) return
        const now = element.currentTime
        if (!initialised) {
          buffer.appendBuffer(init)
          initialised = true
        } else if (copies * loop.trackSec < now + AHEAD_SEC) {
          buffer.timestampOffset = copies * loop.trackSec
          buffer.appendBuffer(media)
          copies++
        } else if (buffer.buffered.length > 0 && buffer.buffered.start(0) < now - BEHIND_SEC - 1) {
          buffer.remove(0, now - BEHIND_SEC)
        }
      }
      buffer.addEventListener('updateend', service)
      buffer.addEventListener('error', fail)
      element.addEventListener('timeupdate', service)
      service()
      const context = await resumedOutputContext()
      if (over) return
      source = context.createMediaElementSource(element)
      connectToOutput(source)
      await element.play()
    } catch {
      fail()
    }
  })()

  return {
    heardBarSec(frameTimeMs, delaySec) {
      if (element.paused || element.readyState < 2) return NaN
      const heard = clock.read(element.currentTime, frameTimeMs / 1000) - outputLatencySec() - delaySec
      return heard - Math.floor(heard / loop.barSec) * loop.barSec
    },
    stop() {
      over = true
      element.pause()
      source?.disconnect()
      element.removeAttribute('src')
      element.load()
    },
  }
}
