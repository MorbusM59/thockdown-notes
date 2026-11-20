/**
 * Calibration of the visual delay (`BeatSettings.delayMsByDevice`) by
 * watching the grid beat on a track whose drums are KNOWN: `assets/sounds/loop.mp4`
 * (from `loop.wav`), 16 s built for this, its rhythm repeating every four seconds. The hits are
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

/**
 * The loop, `assets/sounds/loop.wav` cut to exactly 16 s (768000 frames) and
 * stored losslessly as FLAC in one fragment of a fragmented MP4, the form
 * Media Source Extensions take:
 *   ffmpeg -i loop.wav -af atrim=end_sample=768000 -c:a flac -sample_fmt s16 -f mp4 \
 *     -movflags +frag_keyframe+empty_moov+default_base_moof+omit_tfhd_offset -frag_duration 16000000 loop.mp4
 */
const LOOP_URL = new URL('../assets/sounds/loop.mp4', import.meta.url).href
const LOOP_MIME = 'audio/mp4; codecs="flac"'
/** The track's length, exactly. */
const LOOP_TRACK_SEC = 16
/** Seconds after which the rhythm repeats; the track is four of them. */
export const LOOP_BAR_SEC = 4
/** How much of the loop is kept queued ahead of the listener, and behind them before it is let go. */
const AHEAD_SEC = 2 * LOOP_TRACK_SEC
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
  if (mediaStart < 0) throw new Error('loop.mp4 has no fragment')
  return { init: bytes.subarray(0, mediaStart), media: bytes.subarray(mediaStart, mediaEnd) }
}

export type LoopChannel = 'thump' | 'pierce' | 'tick'

/** A hit: when in the bar, and how strong (0..1). */
export interface LoopHit {
  sec: number
  strength: number
}

/** The ticks with a rim shot on them (the 3rd, 6th, 15th and 18th of 24, at 0.333, 0.833, 2.333 and 2.833): louder, so drawn stronger. */
const RIM_SHOT_TICKS = new Set([2, 5, 14, 17])
/** An ordinary tick's strength beside a rim shot's 1. */
const PLAIN_TICK = 0.5

/**
 * The hits of one four-second bar, as the loop was programmed (its author's
 * figures). Measured against the audio, every snare and hat attack starts
 * within 2 ms of these (snare 0.998 and 2.999; hats 0.166, 0.330, 0.499 ...),
 * and the rim shots show as mid-range attacks at 0.330, 0.831 and 2.331 (the one at 2.833 is under the kick there).
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

/**
 * Starts the loop; `onFailed` is told if it cannot play. Seamless: rather
 * than an element looping a file (which restarts it, with a gap, and jumps
 * its position back), the same fragment is appended to a MediaSource again
 * and again, each copy placed 16 s after the last (`timestampOffset`), so
 * the element plays one endless track and its position only ever runs on.
 * Whenever the element reports its position, what is queued is topped up to
 * AHEAD_SEC and what lies more than BEHIND_SEC behind is let go, so the
 * memory held stays at a few copies.
 */
export function startBeatLoop(onFailed: () => void): LoopRun {
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
      const fetched = fetch(LOOP_URL).then((response) => response.arrayBuffer())
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
        } else if (copies * LOOP_TRACK_SEC < now + AHEAD_SEC) {
          buffer.timestampOffset = copies * LOOP_TRACK_SEC
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
      return heard - Math.floor(heard / LOOP_BAR_SEC) * LOOP_BAR_SEC
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
