/**
 * The DESKTOP's player for the delay calibration's loops
 * (`@thockdown/visualizer/beat/beatLoops.ts`, which holds the loops and their
 * written-down hits; the strip is its `BeatLoopCalibration.tsx`).
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

import type { BeatLoop, BeatLoopPlayer, LoopRun } from '@thockdown/visualizer/beat/beatLoops'
import { connectToOutput, holdOutputAlone, resumedOutputContext } from '@thockdown/soundscape/audioOutputBus'
import { outputLatencySec } from '@thockdown/visualizer/sound/desktopMusicListening'
import { SmoothClock } from '@thockdown/visualizer/sound/smoothClock'

const LOOP_MIME = 'audio/mp4; codecs="flac"'
/** How much of the loop is kept queued ahead of the listener, and behind them before it is let go. */
const AHEAD_SEC = 32
const BEHIND_SEC = 4
/** A loop fades in when it starts and out when it stops, so a start, a stop and a change of loop (the old one fading out as the new one fades in) never click. */
const FADE_SEC = 0.1

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
export const startBeatLoop: BeatLoopPlayer = (loop: BeatLoop, onFailed: () => void): LoopRun => {
  const element = new Audio()
  const mediaSource = new MediaSource()
  const clock = new SmoothClock()
  let source: MediaElementAudioSourceNode | null = null
  let fade: GainNode | null = null
  let over = false
  let releaseOutput: (() => void) | null = null
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
      fade = context.createGain()
      fade.gain.value = 0
      source.connect(fade)
      // The loop is heard alone: the music and the soundscape fall silent under it and come back where they are when it stops.
      connectToOutput(fade, true)
      releaseOutput = holdOutputAlone()
      await element.play()
      if (over) return
      fade.gain.setValueAtTime(0, context.currentTime)
      fade.gain.linearRampToValueAtTime(1, context.currentTime + FADE_SEC)
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
      releaseOutput?.()
      const release = () => {
        element.pause()
        source?.disconnect()
        fade?.disconnect()
        element.removeAttribute('src')
        element.load()
      }
      if (!fade || element.paused) return release()
      const now = fade.context.currentTime
      fade.gain.cancelScheduledValues(now)
      fade.gain.setValueAtTime(fade.gain.value, now)
      fade.gain.linearRampToValueAtTime(0, now + FADE_SEC)
      setTimeout(release, FADE_SEC * 1000 + 20)
    },
  }
}
