/**
 * Calibration of the visual delay (`BeatSettings.delayMsByDevice`) by
 * watching the grid beat on a track whose drums are KNOWN: `assets/sounds/loops/01.mp4`
 * (from `loops/01.wav`), four bars at 87 BPM built for this, its rhythm repeating every bar. The hits are
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
 * The loop, `assets/sounds/loops/01.wav` (529656 frames at 48 kHz, four bars
 * at 87 BPM), stored losslessly as FLAC in one fragment of a fragmented MP4,
 * the form Media Source Extensions take:
 *   ffmpeg -i loops/01.wav -c:a flac -sample_fmt s16 -f mp4 \
 *     -movflags +frag_keyframe+empty_moov+default_base_moof+omit_tfhd_offset -frag_duration 12000000 loops/01.mp4
 */
const LOOP_URL = new URL('../assets/sounds/loops/01.mp4', import.meta.url).href
const LOOP_MIME = 'audio/mp4; codecs="flac"'
/** The track's length, exactly: its frame count over its rate. */
const LOOP_TRACK_SEC = 529656 / 48000
/** Seconds after which the rhythm repeats: one bar; the track is four of them. */
export const LOOP_BAR_SEC = LOOP_TRACK_SEC / 4
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
  if (mediaStart < 0) throw new Error('the loop has no fragment')
  return { init: bytes.subarray(0, mediaStart), media: bytes.subarray(mediaStart, mediaEnd) }
}

export type LoopChannel = 'thump' | 'pierce' | 'tick'

/** A hit: when in the bar, and how strong (0..1). */
export interface LoopHit {
  sec: number
  strength: number
}

/** A sixteenth of the bar. */
const SIXTEENTH_SEC = LOOP_BAR_SEC / 16

/**
 * How late the off sixteenths (the 2nd and 4th of each beat) sound, in
 * sixteenths: the loop is played with Ableton's "Swing 16-85" groove, and its
 * hits on those sixteenths measure 0.40 to 0.46 of a sixteenth (32 to 37 ms)
 * late against the straight ones.
 */
const SWING_SIXTEENTHS = 0.42

/** Hits at sixteenths of the bar, each with its strength; an odd sixteenth is swung. */
const atSixteenths = (hits: Readonly<Record<number, number>>): LoopHit[] =>
  Object.entries(hits).map(([at, strength]) => {
    const sixteenth = Number(at)
    return { sec: (sixteenth + (sixteenth % 2) * SWING_SIXTEENTHS) * SIXTEENTH_SEC, strength }
  })

/**
 * The hits of one bar, as the loop was programmed (its author's piano roll),
 * in sixteenths from the bar's one; strengths follow the programmed velocities.
 */
export const LOOP_SCORE: Readonly<Record<LoopChannel, readonly LoopHit[]>> = {
  thump: atSixteenths({ 0: 1, 2: 1, 9: 0.3, 10: 1, 13: 1 }),
  pierce: atSixteenths({ 4: 1, 7: 0.5, 12: 1 }),
  tick: atSixteenths({ 0: 1, 2: 1, 4: 1, 6: 0.5, 8: 0.5, 10: 1, 12: 1, 14: 0.5 }),
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
 * and again, each copy placed one track length after the last (`timestampOffset`), so
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
