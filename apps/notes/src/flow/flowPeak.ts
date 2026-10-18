/**
 * The PEAK: what reaching full flow does once (`flowMeter.subscribeKick`),
 * every part of it on ONE curve, `fadeCurve(t, PEAK_DURATION_SEC, PEAK_SHAPE)`,
 * and scaled by the reader's peak slider (0..1):
 *
 * - a high-pass over ALL of the app's sound (typing and the shared output that
 *   carries the soundscape and the music), its cutoff swept geometrically from
 *   `PEAK_HIGHPASS_HZ` down to where it rests below hearing, and its resonance
 *   raised to `PEAK_RESONANCE_Q` on the same curve. Nothing new is played:
 *   the sweep only filters what is already sounding;
 * - an ACCENT on the keystroke that reached full flow, played by
 *   `TypingSoundManager` (louder, higher, into the flow room); the editor
 *   carries it on that key's own edit (`flowMeter.reportKey`'s return);
 * - the trail's alpha lift and colour drain (`flowTrail.ts`'s `peakTrail`).
 */

import { outputHighpass, OUTPUT_HIGHPASS_REST_HZ } from '@thockdown/soundscape/audioOutputBus'
import { typingSoundManager } from '../sound/TypingSoundManager'
import { fadeCurve } from './flowTrail'

export const PEAK_DURATION_SEC = 1.5
export const PEAK_SHAPE = -0.3
/**
 * Where the high-pass cutoff starts, in Hz, at a full-strength peak. A
 * high-pass removes everything BELOW its cutoff, so at the start of the peak
 * only what is above this frequency is heard; the cutoff then falls along the
 * peak curve to `OUTPUT_HIGHPASS_REST_HZ` (below hearing), letting first the
 * mids and finally the bass back in. The sweep is geometric, so each octave
 * of the way down takes the same share of the curve. Lower values make the
 * cut milder (only the bass drops out); 20000 starts with almost nothing.
 */
const PEAK_HIGHPASS_HZ = 20000
/**
 * How much the high-pass rings at its cutoff at the start of a full-strength
 * peak. For a Web Audio high-pass, Q is the height of a resonant bump just
 * above the cutoff, in dB: 0 is a flat cut, and each extra dB boosts the
 * frequencies right at the cutoff, so a moving cutoff is heard as a tone
 * sliding down with it (the classic synth filter sweep). It returns to
 * `REST_RESONANCE_Q` on the same curve as the cutoff. Above about 12 the
 * ring gets loud and whistly.
 */
const PEAK_RESONANCE_Q = 6
/** The resonance at rest: the BiquadFilterNode default, a gentle 1 dB bump, inaudible at a 10 Hz cutoff. */
const REST_RESONANCE_Q = 1
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


/** The peak's sound: the high-pass sweep on the shared output and on the typing sounds' own context. */
export function peakSound(peak: number): void {
  if (peak <= 0) return
  sweep(outputHighpass(), peak)
  const typing = typingSoundManager.outputHighpass()
  if (typing) sweep(typing, peak)
}
