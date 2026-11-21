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

/**
 * 04: 120 BPM, no swing (384000 frames, 8 s). Its kicks run over the whole
 * track, four bars (in beats, from its author's roll), so the track is one
 * pattern; its snare part, two stick sounds in sixteenths (from its MIDI,
 * velocities 111 and 90 drawn as 1 and 0.8), repeats in each of the four bars.
 */
const LOOP_04_SEC = 8
const LOOP_04_BEAT_SEC = 0.5
const LOOP_04_KICK_BEATS = [0, 0.5, 4, 4.5, 6.5, 8, 8.5, 12, 12.5, 15.5]
const LOOP_04_SNARES: Readonly<Record<number, number>> = {
  0: 1, 1: 0.8, 2: 0.8, 3: 0.8, 3.5: 0.8, 4: 0.8, 5: 0.8, 6: 1, 7: 0.8, 7.5: 0.8, 8: 0.8, 9: 0.8, 10: 0.8, 11: 0.8, 11.5: 0.8, 12: 1, 13: 0.8, 14: 0.8, 15: 0.8, 15.5: 0.8,
}

/**
 * 05: 100 BPM (460800 frames, 9.6 s), a two-bar pattern played twice, read
 * off its author's roll in sixteenths of the two bars; strengths follow the
 * roll's velocities (full, mid 0.7, soft 0.4). Played with Ableton's
 * "Swing 16-45": its off sixteenths measure about 0.2 of a sixteenth (30 ms) late.
 */
const LOOP_05_BAR_SEC = 4.8
const LOOP_05_SWING = 0.2

/**
 * 06: 120 BPM, no swing (384000 frames, 8 s): four bars, the whole track one
 * pattern. From its MIDI, in sixteenths with their velocities (the loudest of
 * several notes at once): the kick (MIDI 40) is the thump, the rim and the
 * clap (38, 37) the pierce, and the four hats (39, 41, 42, 43) the tick.
 */
const LOOP_06_SEC = 8
const LOOP_06_THUMP = { 0: 94, 10: 94, 13: 94, 16: 94, 26: 63, 32: 94, 42: 94, 45: 94, 48: 94, 56: 115, 58: 94 }
const LOOP_06_PIERCE = { 4: 60, 12: 84, 20: 63, 28: 63, 36: 60, 44: 84, 52: 63, 60: 105 }
const LOOP_06_TICK = { 0: 87, 1: 41, 2: 100, 3: 60, 4: 116, 5: 87, 6: 97, 8: 87, 9: 55, 10: 82, 11: 87, 12: 116, 13: 87, 14: 97, 16: 87, 17: 41, 18: 100, 19: 60, 20: 116, 21: 87, 22: 97, 24: 87, 25: 55, 26: 82, 27: 87, 28: 116, 29: 87, 30: 97, 32: 87, 33: 41, 34: 100, 35: 60, 36: 116, 37: 87, 38: 97, 40: 87, 41: 55, 42: 82, 43: 87, 44: 116, 45: 87, 46: 97, 48: 87, 49: 41, 50: 100, 51: 60, 52: 116, 53: 87, 54: 97, 56: 87, 57: 55, 58: 82, 59: 87, 60: 116, 61: 87, 62: 97 }
/** MIDI velocities as strengths. */
const byVelocity = (notes: Readonly<Record<number, number>>): Record<number, number> =>
  Object.fromEntries(Object.entries(notes).map(([at, velocity]) => [at, velocity / 127]))

/**
 * 07: 165 BPM, no swing: two bars, the whole track one pattern (139637
 * frames: two bars are 139636.4, so the track's own length is what the loop
 * keeps time by). From its MIDI, all at velocity 100: the kick (MIDI 36) is
 * the thump, the snare (40) the pierce, the two closed hats (42, 44) the tick.
 */
const LOOP_07_SEC = 139637 / 48000
const LOOP_07_THUMP = { 0: 100, 10: 100, 16: 100, 26: 100 }
const LOOP_07_PIERCE = { 4: 100, 12: 100, 20: 100, 28: 100 }
const LOOP_07_TICK = { 2: 100, 6: 100, 7: 100, 10: 100, 14: 100, 18: 100, 22: 100, 25: 100, 26: 100, 30: 100 }

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
  {
    url: new URL('../assets/sounds/loops/04.mp4', import.meta.url).href,
    trackSec: LOOP_04_SEC,
    barSec: LOOP_04_SEC,
    score: {
      thump: LOOP_04_KICK_BEATS.map((beat) => ({ sec: beat * LOOP_04_BEAT_SEC, strength: 1 })),
      pierce: [0, 1, 2, 3].flatMap((bar) => atSixteenths(2, LOOP_04_SNARES).map((hit) => ({ ...hit, sec: hit.sec + bar * 2 }))),
      tick: [],
    },
  },
  {
    url: new URL('../assets/sounds/loops/05.mp4', import.meta.url).href,
    trackSec: 9.6,
    barSec: LOOP_05_BAR_SEC,
    // Sixteenths counted on through both bars: given one bar (2.4 s), sixteenths 16 to 31 fall in the second.
    score: {
      thump: atSixteenths(LOOP_05_BAR_SEC / 2, { 0: 1, 9: 0.7, 11: 0.4, 16: 0.7, 25: 0.7, 27: 0.4, 29: 0.7, 30: 0.4, 31: 0.4 }, LOOP_05_SWING),
      pierce: atSixteenths(LOOP_05_BAR_SEC / 2, { 4: 0.7, 12: 1, 20: 0.7, 28: 1 }, LOOP_05_SWING),
      tick: atSixteenths(LOOP_05_BAR_SEC / 2, { 2: 1, 6: 0.7, 10: 0.7, 14: 1, 18: 0.7, 22: 0.7, 26: 1, 30: 0.7 }, LOOP_05_SWING),
    },
  },
  {
    url: new URL('../assets/sounds/loops/06.mp4', import.meta.url).href,
    trackSec: LOOP_06_SEC,
    barSec: LOOP_06_SEC,
    // Sixteenths counted on through all four bars: given one bar (2 s), sixteenths 16 to 63 fall in the later ones.
    score: {
      thump: atSixteenths(LOOP_06_SEC / 4, byVelocity(LOOP_06_THUMP)),
      pierce: atSixteenths(LOOP_06_SEC / 4, byVelocity(LOOP_06_PIERCE)),
      tick: atSixteenths(LOOP_06_SEC / 4, byVelocity(LOOP_06_TICK)),
    },
  },
  {
    url: new URL('../assets/sounds/loops/07.mp4', import.meta.url).href,
    trackSec: LOOP_07_SEC,
    barSec: LOOP_07_SEC,
    // Sixteenths counted on through both bars: given one bar, sixteenths 16 to 31 fall in the second.
    score: {
      thump: atSixteenths(LOOP_07_SEC / 2, byVelocity(LOOP_07_THUMP)),
      pierce: atSixteenths(LOOP_07_SEC / 2, byVelocity(LOOP_07_PIERCE)),
      tick: atSixteenths(LOOP_07_SEC / 2, byVelocity(LOOP_07_TICK)),
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
