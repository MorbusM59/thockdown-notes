import { describe, expect, it } from 'vitest'
import { MusicSemitoneScore } from './musicSemitoneScore'
import { SEMITONE_CONTRAST_DB } from '../visualizer/spectrumBands'

const RATE = 48000
const BANDS = 48

function toneTrack(frequency: number, seconds: number, toneStart: number, toneEnd: number): Float32Array {
  const samples = new Float32Array(Math.round(RATE * seconds))
  for (let i = Math.floor(toneStart * RATE); i < Math.min(samples.length, Math.ceil(toneEnd * RATE)); i += 1) {
    samples[i] = Math.sin((2 * Math.PI * frequency * i) / RATE)
  }
  return samples
}

function harmonicTrack(frequency: number, seconds: number, amplitude = 1): Float32Array {
  const samples = new Float32Array(Math.round(RATE * seconds))
  for (let i = Math.floor(0.1 * RATE); i < Math.ceil((seconds - 0.1) * RATE); i += 1) {
    const time = i / RATE
    for (let harmonic = 1; harmonic <= 10; harmonic += 1) {
      samples[i] += amplitude * Math.sin(2 * Math.PI * frequency * harmonic * time) / harmonic
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
    expect(at[a4]).toBeGreaterThan(SEMITONE_CONTRAST_DB)
    expect(after.every((level) => level === -Infinity)).toBe(true)
  })

  it('keeps a locally detuned A4 centered after estimating the track tuning', () => {
    const score = new MusicSemitoneScore(RATE, BANDS)
    score.feed(harmonicTrack(442, 3), 0)

    const levels = new Float32Array(BANDS)
    score.levelsAt(2.5, levels)

    const a4 = Math.floor(BANDS / 2) + 12
    expect(levels[a4]).toBeGreaterThan(SEMITONE_CONTRAST_DB)
    expect(levels[a4]).toBeGreaterThan(levels[a4 - 1])
    expect(levels[a4]).toBeGreaterThan(levels[a4 + 1])
  })

  it('keeps simultaneously played notes while attributing their overtones', () => {
    const score = new MusicSemitoneScore(RATE, BANDS)
    const samples = harmonicTrack(220, 3)
    const secondNote = harmonicTrack(220 * 2 ** (7 / 12), 3, 0.5)
    for (let i = 0; i < samples.length; i += 1) samples[i] += secondNote[i]
    score.feed(samples, 0)

    const attributed = new Float32Array(BANDS)
    score.levelsAt(2.5, attributed)

    const a3 = BANDS / 2
    const e4 = a3 + 7
    const a4 = a3 + 12
    expect(attributed[a3]).toBeGreaterThan(attributed[a4])
    expect(attributed[a4]).toBeLessThan(SEMITONE_CONTRAST_DB)
    expect(attributed[e4]).toBeGreaterThan(SEMITONE_CONTRAST_DB)
    expect(attributed[a3]).toBeGreaterThan(attributed[e4])
  })

  it('keeps a real octave note when its own partials support it', () => {
    const bands = 60
    const score = new MusicSemitoneScore(RATE, bands)
    const samples = harmonicTrack(220, 3)
    const octave = harmonicTrack(440, 3, 0.4)
    for (let i = 0; i < samples.length; i += 1) samples[i] += octave[i]
    score.feed(samples, 0)

    const attributed = new Float32Array(bands)
    score.levelsAt(2.5, attributed)

    const a3 = bands / 2
    const a4 = a3 + 12
    expect(attributed[a4]).toBeGreaterThan(SEMITONE_CONTRAST_DB)
    expect(attributed[a3]).toBeGreaterThan(attributed[a4])
  })

  it('does not light neighboring notes from one tone across different FFT-bin offsets', () => {
    const center = Math.floor(BANDS / 2)
    for (const midiOffset of [-12, -5, 0, 7, 12]) {
      const frequency = 220 * 2 ** (midiOffset / 12)
      const score = new MusicSemitoneScore(RATE, BANDS)
      score.feed(harmonicTrack(frequency, 2), 0)

      const levels = new Float32Array(BANDS)
      score.levelsAt(1.5, levels)
      const note = center + midiOffset
      expect(levels[note]).toBeGreaterThan(SEMITONE_CONTRAST_DB)
      expect(levels[note - 1]).toBeLessThanOrEqual(SEMITONE_CONTRAST_DB)
      expect(levels[note + 1]).toBeLessThanOrEqual(SEMITONE_CONTRAST_DB)
    }
  })

  it('retains both notes in an adjacent-semitone dyad', () => {
    const score = new MusicSemitoneScore(RATE, BANDS)
    const lowerFrequency = 220
    const samples = harmonicTrack(lowerFrequency, 3)
    const upperNote = harmonicTrack(lowerFrequency * 2 ** (1 / 12), 3, 0.3)
    for (let i = 0; i < samples.length; i += 1) samples[i] += upperNote[i]
    score.feed(samples, 0)

    const levels = new Float32Array(BANDS)
    score.levelsAt(2.5, levels)
    const lower = BANDS / 2
    expect(levels[lower]).toBeGreaterThan(SEMITONE_CONTRAST_DB)
    expect(levels[lower + 1]).toBeGreaterThan(SEMITONE_CONTRAST_DB)
    expect(levels[lower]).toBeGreaterThan(levels[lower + 1])
  })
})
