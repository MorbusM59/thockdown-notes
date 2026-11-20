/**
 * Calibration of the visual delay (`BeatSettings.delayMsByDevice`) by
 * MATCHING rather than tapping: a swish (`assets/sounds/centerswish.wav`, one
 * second of noise panned left to right, silent at both ends and peaking at
 * 0.5 s) loops once a second, and a body orbiting in front of the reader
 * passes closest at the same moment of each second (`sidebar/SwishCalibration.tsx`).
 * The reader moves the delay until the pass and the peak coincide.
 *
 * Tapping measured the reader's reaction and their input device along with
 * the audio path (a wireless keyboard adds its own delay before a press is
 * seen), so it read 150 ms high on a wired headset whose visuals were right
 * at 0. A seen-against-heard match has neither in it, and it includes what
 * the music's visuals include: the screen's own delay.
 *
 * So that a match here is a match for the music, the swish takes the music's
 * path (an `<audio>` element through a MediaElementSource into the shared
 * output) and is read on the same `SmoothClock` the beat pulse reads the
 * music with, and the body is drawn at the heard time the pulse uses:
 * the media time less `heardLagSec`.
 */

import { connectToOutput, resumedOutputContext } from '@thockdown/soundscape/audioOutputBus'
import { outputLatencySec } from './musicBeat'
import { SmoothClock } from './smoothClock'

const SWISH_URL = new URL('../assets/sounds/centerswish.wav', import.meta.url).href
/** Seconds per swish; the sample is exactly this long. */
export const SWISH_PERIOD_SEC = 1
/** Where in each period the swish peaks. */
export const SWISH_APEX_SEC = 0.5
/**
 * Swishes in the track the element plays, the sample repeated: an element
 * looping a one-second file would jump its position back every second, which
 * the clock reads as a seek. Looping a minute of them jumps once a minute.
 */
const REPEATS = 60

let trackUrl: Promise<string> | null = null

/** The sample's PCM, found by walking its RIFF chunks, repeated REPEATS times into a new WAV. */
async function loopedTrackUrl(): Promise<string> {
  const bytes = new Uint8Array(await (await fetch(SWISH_URL)).arrayBuffer())
  const view = new DataView(bytes.buffer)
  let fmt = -1
  let data = -1
  let dataSize = 0
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3])
    const size = view.getUint32(at + 4, true)
    if (id === 'fmt ') fmt = at
    if (id === 'data') { data = at + 8; dataSize = Math.min(size, bytes.length - data) }
    at += 8 + size + (size & 1)
  }
  if (fmt < 0 || data < 0) throw new Error('centerswish.wav has no fmt or data chunk')
  const fmtSize = view.getUint32(fmt + 4, true)
  const head = 12 + 8 + fmtSize + 8
  const out = new Uint8Array(head + dataSize * REPEATS)
  const o = new DataView(out.buffer)
  out.set(bytes.subarray(0, 12), 0)
  o.setUint32(4, out.length - 8, true)
  out.set(bytes.subarray(fmt, fmt + 8 + fmtSize), 12)
  out.set([0x64, 0x61, 0x74, 0x61], 20 + fmtSize)
  o.setUint32(24 + fmtSize, dataSize * REPEATS, true)
  const pcm = bytes.subarray(data, data + dataSize)
  for (let i = 0; i < REPEATS; i++) out.set(pcm, head + i * dataSize)
  return URL.createObjectURL(new Blob([out], { type: 'audio/wav' }))
}

export interface SwishRun {
  /** Where in its period the swish the reader is hearing now is, 0..1, the apex at SWISH_APEX_SEC; NaN before the first report. */
  heardPhase(frameTimeMs: number, delaySec: number): number
  stop(): void
}

/** Starts the swish; `onFailed` is told if it cannot play. */
export function startSwish(onFailed: () => void): SwishRun {
  const element = new Audio()
  element.loop = true
  const clock = new SmoothClock()
  let source: MediaElementAudioSourceNode | null = null
  let over = false

  void (async () => {
    try {
      trackUrl ??= loopedTrackUrl()
      element.src = await trackUrl
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
    heardPhase(frameTimeMs, delaySec) {
      if (element.paused || element.readyState < 2) return NaN
      const heard = clock.read(element.currentTime, frameTimeMs / 1000) - outputLatencySec() - delaySec
      const phase = heard / SWISH_PERIOD_SEC
      return phase - Math.floor(phase)
    },
    stop() {
      over = true
      element.pause()
      source?.disconnect()
    },
  }
}
