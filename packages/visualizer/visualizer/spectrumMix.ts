/**
 * WHAT THE SPECTRUM SHOWS: the music alone, or the music and the soundscape
 * together (`VisualizerSettings.spectrumSoundscape`, set by `useBeatFeedback`).
 * Only the live spectrum takes the soundscape; the beat analysis reads the
 * music either way, a soundscape having no beat to read.
 *
 * The weights keep the two sources at the ratio they are HEARD at and divide
 * out only the louder one's volume, so turning both down does not shrink the
 * picture while the balance shown is the balance heard. With the music alone
 * that is the music at full scale, as it always was. A source that is not
 * heard (stopped, paused, or at zero volume) weighs nothing.
 *
 * Each platform applies the weights where its sources meet: the desktop
 * sums the two taps' audio into one pair of analysers (`spectrumTap.ts`),
 * the phone sums each band's power from the two renderers' frames
 * (`addBandLevels`), which for two independent sources is the power of
 * their sum.
 */

let includeSoundscape = true

export function setSpectrumIncludesSoundscape(on: boolean): void {
  includeSoundscape = on
}

export function spectrumIncludesSoundscape(): boolean {
  return includeSoundscape
}

export interface SpectrumMixWeights {
  /** The gain to put on the music at full scale (its volume divided out). */
  music: number
  /** The gain to put on the soundscape at full scale. */
  soundscape: number
}

/** Below this a source counts as not heard. */
export const SILENT_GAIN = 1e-3

/**
 * The weights for sources heard at linear gains `musicGain` and
 * `soundscapeGain` (0 for one not heard), with the soundscape left out
 * unless `withSoundscape`.
 */
export function spectrumMixWeights(musicGain: number, soundscapeGain: number, withSoundscape = includeSoundscape): SpectrumMixWeights {
  const music = musicGain > SILENT_GAIN ? musicGain : 0
  const soundscape = withSoundscape && soundscapeGain > SILENT_GAIN ? soundscapeGain : 0
  const louder = Math.max(music, soundscape)
  if (louder === 0) return { music: 0, soundscape: 0 }
  return { music: music / louder, soundscape: soundscape / louder }
}

/**
 * The level (dB) of two independent sources' sum in one band, from each
 * one's level and the gain it takes: their powers add. A weight of 0 leaves
 * that source out, and two silent ones are silence.
 */
export function addBandLevels(levelA: number, weightA: number, levelB: number, weightB: number): number {
  const power = (weightA > 0 ? weightA * weightA * 10 ** (levelA / 10) : 0) + (weightB > 0 ? weightB * weightB * 10 ** (levelB / 10) : 0)
  return power > 0 ? 10 * Math.log10(power) : -Infinity
}
