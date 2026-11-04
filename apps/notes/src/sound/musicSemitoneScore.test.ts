import { describe, expect, it } from 'vitest'
import { MusicSemitoneScore } from './musicSemitoneScore'

const RATE = 48000
const BANDS = 48

function toneTrack(frequency: number, seconds: number, toneStart: number, toneEnd: number): Float32Array {
  const samples = new Float32Array(Math.round(RATE * seconds))
  for (let i = Math.floor(toneStart * RATE); i < Math.min(samples.length, Math.ceil(toneEnd * RATE)); i += 1) {
    samples[i] = Math.sin((2 * Math.PI * frequency * i) / RATE)
  }
  return samples
}

function harmonicTrack(frequency: number, seconds: number): Float32Array {
  const samples = new Float32Array(Math.round(RATE * seconds))
  for (let i = Math.floor(0.1 * RATE); i < Math.ceil((seconds - 0.1) * RATE); i += 1) {
    const time = i / RATE
    for (let harmonic = 1; harmonic <= 10; harmonic += 1) {
      samples[i] += Math.sin(2 * Math.PI * frequency * harmonic * time) / harmonic
    }
  }
  return samples
}

describe('MusicSemitoneScore', () => {
  it('scores pitch energy at its decoded audio time, including the future confirmation window', () => {
    const score = new MusicSemitoneScore(RATE, BANDS)
    score.feed(toneTrack(440, 1, 0.2, 0.4), 0)

    const at = new Float32Array(BANDS)
    const after = new Float32Array(BANDS)
    score.levelsAt(0.3, at)
    score.levelsAt(0.5, after)

    const a4 = Math.floor(BANDS / 2) + 12
    expect(at[a4]).toBeGreaterThan(at[a4 - 1])
    expect(at[a4]).toBeGreaterThan(at[a4 + 1])
    expect(at[a4]).toBeGreaterThan(-45)
    expect(after.every((level) => level === -Infinity)).toBe(true)
  })

  it('keeps a locally detuned A4 centered after estimating the track tuning', () => {
    const score = new MusicSemitoneScore(RATE, BANDS)
    score.feed(harmonicTrack(442, 3), 0)

    const levels = new Float32Array(BANDS)
    score.levelsAt(2.5, levels)

    const a4 = Math.floor(BANDS / 2) + 12
    expect(levels[a4]).toBeGreaterThan(-45)
    expect(levels[a4]).toBeGreaterThan(levels[a4 - 1])
    expect(levels[a4]).toBeGreaterThan(levels[a4 + 1])
  })
})
