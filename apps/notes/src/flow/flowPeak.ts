/**
 * The PEAK: what reaching full flow does once (`flowMeter.subscribeKick`),
 * every part of it on ONE curve, `fadeCurve(t, PEAK_DURATION_SEC, PEAK_SHAPE)`,
 * and scaled by the reader's peak slider (0..1):
 *
 * - a high-pass over ALL of the app's sound (typing and the shared output that
 *   carries the soundscape and the music), its cutoff swept geometrically from
 *   `PEAK_HIGHPASS_HZ` down to where it rests below hearing, and its resonance
 *   raised to `PEAK_RESONANCE_Q` on the same curve, so the moving cutoff is
 *   heard as a tone sliding down rather than only as missing bass;
 * - a WHOOSH: white noise through a band-pass whose centre rides
 *   `WHOOSH_CENTRE_RATIO` above the cutoff, at a level on the same curve, so
 *   there is something audible moving with the sweep even in silence;
 * - the trail's alpha lift and colour drain (`flowTrail.ts`'s `peakTrail`).
 */

import { connectToOutput, outputContext, outputHighpass, OUTPUT_HIGHPASS_REST_HZ } from '@thockdown/soundscape/audioOutputBus'
import { typingSoundManager } from '../sound/TypingSoundManager'
import { fadeCurve } from './flowTrail'

export const PEAK_DURATION_SEC = 2
export const PEAK_SHAPE = -0.2
/** The high-pass cutoff at the top of a full-strength peak. */
const PEAK_HIGHPASS_HZ = 20000
/** The high-pass's resonance (Q, in dB for a Web Audio high-pass) at the top of a full-strength peak. */
const PEAK_RESONANCE_Q = 6
/** The high-pass's resonance at rest: the BiquadFilterNode default. */
const REST_RESONANCE_Q = 1
/** The whoosh's band-pass centre as a multiple of the high-pass cutoff, so the noise sits above the cut. */
const WHOOSH_CENTRE_RATIO = 1.5
const WHOOSH_BANDPASS_Q = 1.5
/** The whoosh's gain at the top of a full-strength peak. */
const WHOOSH_GAIN = 0.15
const CURVE_SAMPLES = 512

/** The peak curve sampled over `PEAK_DURATION_SEC`, mapped through `map`, ready for `setValueCurveAtTime`. */
function peakCurve(map: (fade: number) => number): Float32Array {
  const curve = new Float32Array(CURVE_SAMPLES + 1)
  for (let i = 0; i <= CURVE_SAMPLES; i += 1) {
    curve[i] = map(fadeCurve((PEAK_DURATION_SEC * i) / CURVE_SAMPLES, PEAK_DURATION_SEC, PEAK_SHAPE))
  }
  return curve
}

/** The cutoff at a point on the curve: geometric between rest and the peak's top. */
function cutoffAt(fade: number, peak: number): number {
  return OUTPUT_HIGHPASS_REST_HZ * (PEAK_HIGHPASS_HZ / OUTPUT_HIGHPASS_REST_HZ) ** (peak * fade)
}

/**
 * Plays `curve` on `param` from `startTime`. The curve's last value IS the
 * rest, so nothing has to be put back; a peak arriving during the last one
 * replaces it (cancelling from 0 removes the curve still running).
 */
function play(param: AudioParam, curve: Float32Array, startTime: number): void {
  param.cancelScheduledValues(0)
  param.setValueCurveAtTime(curve, startTime, PEAK_DURATION_SEC)
}

/** Sweeps one high-pass's cutoff and resonance on the peak curve. */
function sweep(filter: BiquadFilterNode, peak: number): void {
  const start = filter.context.currentTime
  play(filter.frequency, peakCurve((fade) => cutoffAt(fade, peak)), start)
  play(filter.Q, peakCurve((fade) => REST_RESONANCE_Q + (PEAK_RESONANCE_Q - REST_RESONANCE_Q) * peak * fade), start)
}

let noiseBuffer: AudioBuffer | null = null

/** One peak's length of white noise on `context`, made once and reused. */
function noiseFor(context: BaseAudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === context.sampleRate) return noiseBuffer
  const length = Math.ceil(PEAK_DURATION_SEC * context.sampleRate)
  noiseBuffer = context.createBuffer(1, length, context.sampleRate)
  const samples = noiseBuffer.getChannelData(0)
  for (let i = 0; i < length; i += 1) samples[i] = Math.random() * 2 - 1
  return noiseBuffer
}

/** The whoosh, on the shared output so it passes the same high-pass and limiter as everything else. */
function whoosh(peak: number): void {
  const context = outputContext()
  const start = context.currentTime
  const source = context.createBufferSource()
  source.buffer = noiseFor(context)
  const band = context.createBiquadFilter()
  band.type = 'bandpass'
  band.Q.value = WHOOSH_BANDPASS_Q
  const nyquistGuard = context.sampleRate * 0.45
  band.frequency.setValueCurveAtTime(
    peakCurve((fade) => Math.min(nyquistGuard, cutoffAt(fade, peak) * WHOOSH_CENTRE_RATIO)),
    start,
    PEAK_DURATION_SEC,
  )
  const level = context.createGain()
  level.gain.setValueCurveAtTime(peakCurve((fade) => WHOOSH_GAIN * peak * fade), start, PEAK_DURATION_SEC)
  source.connect(band).connect(level)
  connectToOutput(level)
  source.start(start)
  source.stop(start + PEAK_DURATION_SEC)
  source.onended = () => level.disconnect()
}

/** The peak's sound: the high-pass sweep on the shared output and on the typing sounds' own context, and the whoosh. */
export function peakSound(peak: number): void {
  if (peak <= 0) return
  sweep(outputHighpass(), peak)
  const typing = typingSoundManager.outputHighpass()
  if (typing) sweep(typing, peak)
  whoosh(peak)
}
