/**
 * The PEAK: what reaching full flow does once (`flowMeter.subscribeKick`),
 * every part of it on ONE curve, `fadeCurve(t, PEAK_DURATION_SEC, PEAK_SHAPE)`,
 * and scaled by the reader's peak slider (0..1):
 *
 * - a high-pass over ALL of the app's sound (typing and the shared output that
 *   carries the soundscape and the music), its cutoff swept geometrically from
 *   `PEAK_HIGHPASS_HZ` down to where it rests below hearing;
 * - the trail's alpha lift and colour drain (`flowTrail.ts`'s `peakTrail`).
 */

import { outputContext, outputHighpassFrequency, OUTPUT_HIGHPASS_REST_HZ } from '@thockdown/soundscape/audioOutputBus'
import { typingSoundManager } from '../sound/TypingSoundManager'
import { fadeCurve } from './flowTrail'

export const PEAK_DURATION_SEC = 1.2
export const PEAK_SHAPE = -1.5
/** The high-pass cutoff at the top of a full-strength peak. */
const PEAK_HIGHPASS_HZ = 4000
const HIGHPASS_SAMPLES = 512

/**
 * Sweeps a cutoff from its peak back to rest on the peak curve, starting at
 * `startTime` on its own context's clock. The sweep's last value IS the rest,
 * so nothing has to be put back; a peak arriving during the last one replaces
 * it (cancelling from 0 removes the curve still running).
 */
function sweep(frequency: AudioParam, startTime: number, peak: number): void {
  const curve = new Float32Array(HIGHPASS_SAMPLES + 1)
  const ratio = PEAK_HIGHPASS_HZ / OUTPUT_HIGHPASS_REST_HZ
  for (let i = 0; i <= HIGHPASS_SAMPLES; i += 1) {
    const fade = fadeCurve((PEAK_DURATION_SEC * i) / HIGHPASS_SAMPLES, PEAK_DURATION_SEC, PEAK_SHAPE)
    curve[i] = OUTPUT_HIGHPASS_REST_HZ * ratio ** (peak * fade)
  }
  frequency.cancelScheduledValues(0)
  frequency.setValueCurveAtTime(curve, startTime, PEAK_DURATION_SEC)
}

/** The peak's sound: the high-pass sweep on the shared output and on the typing sounds' own context. */
export function peakSound(peak: number): void {
  if (peak <= 0) return
  sweep(outputHighpassFrequency(), outputContext().currentTime, peak)
  const typing = typingSoundManager.outputHighpass()
  if (typing) sweep(typing.frequency, typing.currentTime, peak)
}
