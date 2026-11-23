import { describe, expect, it } from 'vitest'
import { loudnessGain, PeakWindow } from './peakWindow'

const RATE = 48000

function tone(seconds: number, amplitude: (t: number) => number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE))
  for (let i = 0; i < out.length; i++) out[i] = amplitude(i / RATE) * Math.sin((2 * Math.PI * 110 * i) / RATE)
  return out
}

describe('the peak window', () => {
  it('follows the largest magnitude in the window as it slides, fed in uneven chunks', () => {
    // Loud for two seconds, then quiet: the window's peak is the loud part's
    // while any of it is inside, and the quiet part's after.
    const samples = tone(6, (t) => (t < 2 ? 0.9 : 0.1))
    const window = new PeakWindow()
    let fed = 0
    let chunk = 0
    while (fed < samples.length) {
      const end = Math.min(samples.length, fed + 300 + ((chunk++ * 617) % 900))
      window.add(samples.subarray(fed, end), fed / RATE, RATE)
      fed = end
    }
    expect(window.peakSince(0)).toBeCloseTo(0.9, 2)
    expect(window.peakSince(1.5)).toBeCloseTo(0.9, 2)
    expect(window.peakSince(2.05)).toBeCloseTo(0.1, 2)
  })

  it('reads 0 once everything has left the window, and starts over on reset', () => {
    const window = new PeakWindow()
    window.add(tone(1, () => 0.5), 0, RATE)
    expect(window.peakSince(2)).toBe(0)
    window.reset()
    window.add(tone(1, () => 0.3), 10, RATE)
    expect(window.peakSince(10)).toBeCloseTo(0.3, 2)
  })
})

describe('the loudness gain', () => {
  it('is full within the headroom of full scale and falls with amplitude below it', () => {
    expect(loudnessGain(1, 5)).toBe(1)
    expect(loudnessGain(10 ** (-5 / 20), 5)).toBeCloseTo(1, 6)
    expect(loudnessGain(10 ** (-11 / 20), 5)).toBeCloseTo(0.5, 2)
    expect(loudnessGain(0, 5)).toBe(0)
  })
})
