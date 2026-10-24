import { describe, expect, it } from 'vitest'
import { StreamResampler } from './streamResampler'

function sine(rate: number, hz: number, count: number): Float32Array {
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) out[i] = Math.sin((2 * Math.PI * hz * i) / rate)
  return out
}

describe('StreamResampler', () => {
  it('keeps a tone at its frequency, level and time', () => {
    const input = sine(44100, 1000, 44100)
    const { samples, behind } = new StreamResampler(44100, 48000).process(input, 0)
    const expected = sine(48000, 1000, samples.length)
    let worst = 0
    for (let k = 10; k < samples.length; k++) worst = Math.max(worst, Math.abs(samples[k] - expected[k]))
    expect(worst).toBeLessThan(0.005)
    // The last output sits `behind` input samples before the last input.
    expect((samples.length - 1) / 48000).toBeCloseTo((input.length - 1 - behind) / 44100, 9)
  })

  it('produces the same output whether the input arrives whole or in pieces', () => {
    const input = sine(44100, 440, 20000)
    const whole = Array.from(new StreamResampler(44100, 48000).process(input, 0).samples)
    const pieces: number[] = []
    const resampler = new StreamResampler(44100, 48000)
    for (let at = 0; at < input.length; at += 777) pieces.push(...resampler.process(input.subarray(at, at + 777), 0).samples)
    expect(pieces.length).toBe(whole.length)
    for (let k = 0; k < whole.length; k++) expect(pieces[k]).toBeCloseTo(whole[k], 6)
  })
})
