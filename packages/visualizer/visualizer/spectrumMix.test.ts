import { describe, expect, it } from 'vitest'
import { addBandLevels, spectrumMixWeights } from './spectrumMix'

describe('spectrumMixWeights', () => {
  it('shows the music alone at full scale whatever its volume', () => {
    expect(spectrumMixWeights(0.3, 0.8, false)).toEqual({ music: 1, soundscape: 0 })
  })

  it('keeps the heard ratio and divides out only the louder volume', () => {
    expect(spectrumMixWeights(0.2, 0.5, true)).toEqual({ music: 0.4, soundscape: 1 })
    expect(spectrumMixWeights(0.5, 0.25, true)).toEqual({ music: 1, soundscape: 0.5 })
  })

  it('shows a soundscape heard alone at full scale, and nothing when nothing is heard', () => {
    expect(spectrumMixWeights(0, 0.1, true)).toEqual({ music: 0, soundscape: 1 })
    expect(spectrumMixWeights(0, 0, true)).toEqual({ music: 0, soundscape: 0 })
  })
})

describe('addBandLevels', () => {
  it('adds powers: two equal sources are 3 dB up, a weight scales in amplitude', () => {
    expect(addBandLevels(-20, 1, -20, 1)).toBeCloseTo(-20 + 10 * Math.log10(2), 9)
    expect(addBandLevels(-20, 0.5, -Infinity, 1)).toBeCloseTo(-20 + 20 * Math.log10(0.5), 9)
    expect(addBandLevels(-20, 0, -30, 0)).toBe(-Infinity)
  })
})
