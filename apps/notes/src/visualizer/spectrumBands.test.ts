import { describe, expect, it } from 'vitest'
import { FftPlan } from '@thockdown/soundscape/fft'
import {
  PEAK_HOLD_SEC,
  RELEASE_DB_PER_SEC,
  SPECTRUM_CEILING_DB,
  SPECTRUM_FLOOR_DB,
  SpectrumBallistics,
  TILT_DB_PER_OCTAVE,
  bandCentreHz,
  litRows,
  logBandEdges,
  writeBandLevels,
} from './spectrumBands'

const SAMPLE_RATE = 48000
const FFT_SIZE = 8192

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * What `AnalyserNode.getFloatFrequencyData` returns for `samples` with its
 * smoothing at 0: a Blackman window (alpha 0.16), an FFT, each magnitude
 * divided by the size, in dB.
 */
function analyse(samples: Float64Array): Float32Array {
  const n = samples.length
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / n) + 0.08 * Math.cos((4 * Math.PI * i) / n)
    re[i] = samples[i] * w
  }
  new FftPlan(n).forward(re, im)
  const out = new Float32Array(n / 2)
  for (let k = 0; k < n / 2; k += 1) out[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) / n)
  return out
}

/** Pink noise (power falling 3 dB an octave), `rms` overall, built in the frequency domain with random phases. */
function pinkNoise(seed: number, rms: number): Float64Array {
  const rand = mulberry32(seed)
  const re = new Float64Array(FFT_SIZE)
  const im = new Float64Array(FFT_SIZE)
  for (let k = 1; k < FFT_SIZE / 2; k += 1) {
    const phase = rand() * 2 * Math.PI
    const magnitude = 1 / Math.sqrt(k)
    re[k] = magnitude * Math.cos(phase)
    im[k] = magnitude * Math.sin(phase)
    re[FFT_SIZE - k] = re[k]
    im[FFT_SIZE - k] = -im[k]
  }
  new FftPlan(FFT_SIZE).inverse(re, im)
  let sum = 0
  for (let i = 0; i < FFT_SIZE; i += 1) sum += re[i] * re[i]
  const scale = rms / Math.sqrt(sum / FFT_SIZE)
  for (let i = 0; i < FFT_SIZE; i += 1) re[i] *= scale
  return re
}

describe('logBandEdges', () => {
  it('spans the range with every band the same width in octaves', () => {
    const edges = logBandEdges(100)
    expect(edges[0]).toBeCloseTo(20, 9)
    expect(edges[100]).toBeCloseTo(20000, 6)
    const octaves = Math.log2(edges[1] / edges[0])
    for (let i = 1; i < 100; i += 1) expect(Math.log2(edges[i + 1] / edges[i])).toBeCloseTo(octaves, 9)
  })
})

describe('writeBandLevels', () => {
  it('draws pink noise flat apart from the stated tilt', () => {
    const bands = 100
    const edges = logBandEdges(bands)
    const binHz = SAMPLE_RATE / FFT_SIZE
    // Averaged over several noises, so what is measured is the band rule
    // rather than one noise's random dips.
    const runs = 24
    const sums = new Float64Array(bands)
    const levels = new Float32Array(bands)
    for (let run = 0; run < runs; run += 1) {
      writeBandLevels(analyse(pinkNoise(run + 1, 0.1)), binHz, edges, 0, bands, levels)
      for (let band = 0; band < bands; band += 1) sums[band] += 10 ** (levels[band] / 10)
    }
    const untilted: number[] = []
    for (let band = 0; band < bands; band += 1) {
      const centre = bandCentreHz(edges, band)
      if (centre < 40 || centre > 18000) continue
      untilted.push(10 * Math.log10(sums[band] / runs) - TILT_DB_PER_OCTAVE * Math.log2(centre / 1000))
    }
    const mean = untilted.reduce((a, b) => a + b, 0) / untilted.length
    for (const level of untilted) expect(Math.abs(level - mean)).toBeLessThan(1.5)
  })

  it('has no staircase where bands are narrower than a bin', () => {
    // Below ~130 Hz a band is narrower than one 5.9 Hz bin: neighbouring
    // bands there must still differ, rather than repeating one bin's value.
    const bands = 100
    const edges = logBandEdges(bands)
    const levels = new Float32Array(bands)
    writeBandLevels(analyse(pinkNoise(7, 0.1)), SAMPLE_RATE / FFT_SIZE, edges, 0, bands, levels)
    for (let band = 0; band < bands - 1; band += 1) {
      if (bandCentreHz(edges, band + 1) > 130) break
      expect(levels[band]).not.toBe(levels[band + 1])
    }
  })

  it('puts a full-scale sine at the top of its band and nowhere else', () => {
    const bands = 100
    const edges = logBandEdges(bands)
    const samples = new Float64Array(FFT_SIZE)
    for (let i = 0; i < FFT_SIZE; i += 1) samples[i] = Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE)
    const levels = new Float32Array(bands)
    writeBandLevels(analyse(samples), SAMPLE_RATE / FFT_SIZE, edges, 0, bands, levels)
    let loudest = 0
    for (let band = 1; band < bands; band += 1) if (levels[band] > levels[loudest]) loudest = band
    expect(edges[loudest] <= 1000 * 1.08 && edges[loudest + 1] >= 1000 / 1.08).toBe(true)
    expect(litRows(levels[loudest], 10)).toBeGreaterThanOrEqual(9)
    // Three bands away (about a third of an octave) it has dropped out of sight.
    expect(litRows(levels[loudest + 4], 10)).toBeLessThanOrEqual(2)
  })
})

describe('litRows', () => {
  it('maps the floor to nothing and the ceiling to everything', () => {
    expect(litRows(-Infinity, 10)).toBe(0)
    expect(litRows(SPECTRUM_FLOOR_DB, 10)).toBe(0)
    expect(litRows(SPECTRUM_CEILING_DB, 10)).toBe(10)
    expect(litRows(SPECTRUM_CEILING_DB + 30, 10)).toBe(10)
    expect(litRows((SPECTRUM_FLOOR_DB + SPECTRUM_CEILING_DB) / 2, 10)).toBe(5)
  })
})

describe('SpectrumBallistics', () => {
  it('rises at once and falls at the release rate', () => {
    const meter = new SpectrumBallistics(1)
    meter.step(Float32Array.of(-20), 1 / 60)
    expect(meter.levels[0]).toBe(-20)
    meter.step(Float32Array.of(-Infinity), 0.5)
    expect(meter.levels[0]).toBeCloseTo(-20 - RELEASE_DB_PER_SEC * 0.5, 4)
  })

  it('holds a peak, then lets it fall until the bar catches it', () => {
    const meter = new SpectrumBallistics(1)
    meter.step(Float32Array.of(-20), 1 / 60)
    const quiet = Float32Array.of(-60)
    let elapsed = 0
    while (elapsed < PEAK_HOLD_SEC - 0.05) { meter.step(quiet, 1 / 60); elapsed += 1 / 60 }
    expect(meter.peaks[0]).toBe(-20)
    for (let i = 0; i < 600; i += 1) meter.step(quiet, 1 / 60)
    expect(meter.peaks[0]).toBe(-60)
    expect(meter.levels[0]).toBe(-60)
  })

  it('moves the same at any frame rate', () => {
    const at = (fps: number) => {
      const meter = new SpectrumBallistics(1)
      meter.step(Float32Array.of(-20), 1 / fps)
      const quiet = Float32Array.of(-Infinity)
      for (let i = 0; i < fps * 1.25; i += 1) meter.step(quiet, 1 / fps)
      return { level: meter.levels[0], peak: meter.peaks[0] }
    }
    const slow = at(60)
    const fast = at(144)
    expect(Math.abs(slow.level - fast.level)).toBeLessThan(0.01)
    expect(Math.abs(slow.peak - fast.peak)).toBeLessThan(1)
  })

  it('comes to rest once everything is below the floor', () => {
    const meter = new SpectrumBallistics(2)
    meter.step(Float32Array.of(-20, -30), 1 / 60)
    expect(meter.isAtRest()).toBe(false)
    const silent = Float32Array.of(-Infinity, -Infinity)
    for (let i = 0; i < 60 * 5; i += 1) meter.step(silent, 1 / 60)
    expect(meter.isAtRest()).toBe(true)
  })
})
