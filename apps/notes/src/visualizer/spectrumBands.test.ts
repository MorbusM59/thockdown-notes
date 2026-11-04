import { describe, expect, it } from 'vitest'
import { FftPlan } from '@thockdown/soundscape/fft'
import {
  PEAK_HOLD_SEC,
  SEMITONE_BRIGHTNESS_CEILING_DB,
  SEMITONE_CONTRAST_DB,
  SEMITONE_FADE_SEC,
  RELEASE_DB_PER_SEC,
  SPECTRUM_CEILING_DB,
  SPECTRUM_FLOOR_DB,
  SemitoneActivityFilter,
  SemitoneFade,
  SpectrumBallistics,
  TILT_DB_PER_OCTAVE,
  TrackTuningEstimator,
  bandCentreHz,
  createBandLevelPlan,
  createSemitoneAttributionPlan,
  createSemitoneAttributionWorkspace,
  createSemitonePlan,
  litRows,
  logBandEdges,
  semitoneShare,
  writeAttributedSemitoneLevels,
  writeBandLevelsWithPlan,
  writeBandLevels,
  writeSemitoneLevels,
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

function spectrumWithPeaks(binCount: number, binHz: number, peakHz: number[]): Float32Array {
  const spectrum = new Float32Array(binCount).fill(-100)
  for (const hz of peakHz) {
    const centre = hz / binHz
    for (let bin = Math.max(0, Math.floor(centre) - 2); bin <= Math.min(binCount - 1, Math.ceil(centre) + 2); bin += 1) {
      const level = -18 - 2 * (bin - centre) ** 2
      spectrum[bin] = Math.max(spectrum[bin], level)
    }
  }
  return spectrum
}

function referenceBandLevels(
  spectrumDb: Float32Array,
  binHz: number,
  edges: Float64Array,
  fromBand: number,
  toBand: number,
  out: Float32Array,
): void {
  for (let band = fromBand; band < toBand; band += 1) {
    const lo = edges[band]
    const hi = edges[band + 1]
    let power = 0
    if (hi - lo < binHz) {
      const at = Math.min(spectrumDb.length - 1, Math.max(0, bandCentreHz(edges, band) / binHz))
      const below = Math.floor(at)
      const above = Math.min(spectrumDb.length - 1, below + 1)
      const share = at - below
      const a = spectrumDb[below]
      const b = spectrumDb[above]
      const db = Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * share : Math.max(a, b)
      power = (db > -400 ? 10 ** (db / 10) : 0) * ((hi - lo) / binHz)
    } else {
      const first = Math.max(0, Math.floor(lo / binHz + 0.5))
      const last = Math.min(spectrumDb.length - 1, Math.floor(hi / binHz + 0.5))
      for (let bin = first; bin <= last; bin += 1) {
        const overlap = Math.min(hi, (bin + 0.5) * binHz) - Math.max(lo, (bin - 0.5) * binHz)
        if (overlap > 0) power += (spectrumDb[bin] > -400 ? 10 ** (spectrumDb[bin] / 10) : 0) * (overlap / binHz)
      }
    }
    const tilt = TILT_DB_PER_OCTAVE * Math.log2(bandCentreHz(edges, band) / 1000)
    out[band] = power > 0 ? 10 * Math.log10(power) + tilt : -Infinity
  }
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
  it('matches the direct calculation when reusing plans for both FFT ranges', () => {
    const bands = 96
    const split = 37
    const binHz = 187.5
    const edges = logBandEdges(bands)
    const spectrum = Float32Array.from({ length: 256 }, (_, bin) => bin % 11 === 0 ? -Infinity : -90 + (bin * 17) % 70)
    const expected = new Float32Array(bands)
    const actual = new Float32Array(bands)
    referenceBandLevels(spectrum, binHz, edges, 0, split, expected)
    referenceBandLevels(spectrum, binHz, edges, split, bands, expected)
    writeBandLevelsWithPlan(spectrum, createBandLevelPlan(spectrum.length, binHz, edges, 0, split), actual)
    writeBandLevelsWithPlan(spectrum, createBandLevelPlan(spectrum.length, binHz, edges, split, bands), actual)
    expect(Array.from(actual)).toEqual(Array.from(expected))
  })

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

  describe('writeSemitoneLevels', () => {
    it('maps every semitone to its own box around A3', () => {
      const boxCount = 25
      const centreBox = Math.floor(boxCount / 2)
      for (let midi = 45; midi <= 69; midi += 1) {
        const binHz = 440 * 2 ** ((midi - 69) / 12)
        const spectrum = Float32Array.of(-Infinity, -20)
        const levels = new Float32Array(boxCount)
        writeSemitoneLevels(spectrum, createSemitonePlan(spectrum.length, binHz, boxCount), levels)
        const expectedBox = centreBox + midi - 57
        expect(levels[expectedBox]).toBeGreaterThan(-25)
        for (let other = 0; other < boxCount; other += 1) {
          if (other !== expectedBox) expect(levels[other]).toBe(-Infinity)
        }
      }
    })

    it('keeps octaves in separate boxes', () => {
      const spectrum = Float32Array.of(-Infinity, -20, -20)
      const levels = new Float32Array(49)
      writeSemitoneLevels(spectrum, createSemitonePlan(spectrum.length, 110, levels.length), levels)
      expect(levels[12]).toBeCloseTo(-20, 3)
      expect(levels[24]).toBeCloseTo(-20, 3)
    })

    it('puts tuned A3 in the center box or the right-center box for even widths', () => {
      const tunedA3Hz = 220 * 2 ** (20 / 1200)
      const spectrum = Float32Array.of(-Infinity, -20)
      for (const boxCount of [24, 25]) {
        const levels = new Float32Array(boxCount)
        const expectedBox = Math.floor(boxCount / 2)
        writeSemitoneLevels(spectrum, createSemitonePlan(spectrum.length, tunedA3Hz, boxCount, 20), levels)
        expect(levels[expectedBox]).toBeGreaterThan(-21)
        for (let other = 0; other < boxCount; other += 1) {
          if (other !== expectedBox) expect(levels[other]).toBe(-Infinity)
        }
      }
    })

    it('shares coarse-bin energy between adjacent semitones and ignores out-of-row frequencies', () => {
      const binHz = SAMPLE_RATE / FFT_SIZE
      const spectrum = new Float32Array(FFT_SIZE / 2).fill(-Infinity)
      const lowBin = Math.round(27.5 / binHz)
      const middleBin = Math.round((220 * 2 ** (0.5 / 12)) / binHz)
      const highBin = Math.round(21000 / binHz)
      spectrum[lowBin] = -20
      spectrum[middleBin] = -20
      spectrum[highBin] = -20
      const levels = new Float32Array(25)
      writeSemitoneLevels(spectrum, createSemitonePlan(spectrum.length, binHz, levels.length), levels)
      expect(levels[12]).toBeGreaterThan(-30)
      expect(levels[13]).toBeGreaterThan(-30)
      expect(levels.filter((level) => Number.isFinite(level))).toHaveLength(2)
    })
  })

  describe('writeAttributedSemitoneLevels', () => {
    function spectrumForNotes(
      plan: ReturnType<typeof createSemitoneAttributionPlan>,
      notes: ReadonlyArray<[number, number]>,
    ): Float32Array {
      const powers = new Float64Array(plan.boxCount)
      for (const [note, strength] of notes) {
        const offset = note * plan.boxCount
        for (let band = 0; band < plan.boxCount; band += 1) {
          powers[band] += strength * plan.templates[offset + band]
        }
      }
      return Float32Array.from(powers, (power) => power > 0 ? 10 * Math.log10(power) : -Infinity)
    }

    it("attributes one note's partials to that note instead of lighting their semitone bins", () => {
      const plan = createSemitoneAttributionPlan(49)
      const raw = spectrumForNotes(plan, [[12, 1e-3]])
      const mapped = new Float32Array(plan.boxCount)
      writeAttributedSemitoneLevels(raw, plan, mapped, createSemitoneAttributionWorkspace(plan.boxCount))

      expect(mapped[12]).toBeCloseTo(-30, 1)
      expect(mapped[24]).toBeLessThan(SEMITONE_CONTRAST_DB)
      expect(mapped[31]).toBeLessThan(SEMITONE_CONTRAST_DB)
      expect(raw[24]).toBeGreaterThan(-40)
    })

    it('recovers simultaneous notes and their relative strengths', () => {
      const plan = createSemitoneAttributionPlan(49)
      const raw = spectrumForNotes(plan, [[12, 1.58e-5], [24, 3.98e-6]])
      const mapped = new Float32Array(plan.boxCount)
      writeAttributedSemitoneLevels(raw, plan, mapped, createSemitoneAttributionWorkspace(plan.boxCount))

      expect(mapped[12]).toBeCloseTo(-48, 0)
      expect(mapped[24]).toBeCloseTo(-54, 0)
      expect(mapped[12]).toBeGreaterThan(mapped[24])
      expect(semitoneShare(mapped[12])).toBeGreaterThan(semitoneShare(mapped[24]))
    })

    it('rejects diffuse energy below the note contrast threshold', () => {
      const plan = createSemitoneAttributionPlan(49)
      const raw = new Float32Array(plan.boxCount).fill(SEMITONE_CONTRAST_DB - 10)
      const mapped = new Float32Array(plan.boxCount)
      writeAttributedSemitoneLevels(raw, plan, mapped, createSemitoneAttributionWorkspace(plan.boxCount))

      expect(mapped.every((level) => level <= SEMITONE_CONTRAST_DB)).toBe(true)
    })

    it('does not allow the attribution output to overwrite its input', () => {
      const levels = Float32Array.of(-20, -30)
      expect(() =>
        writeAttributedSemitoneLevels(
          levels,
          createSemitoneAttributionPlan(2),
          levels,
          createSemitoneAttributionWorkspace(2),
        ),
      ).toThrow(RangeError)
    })

    it('requires workspace buffers matching the plan', () => {
      const levels = Float32Array.of(-20, -30)
      const plan = createSemitoneAttributionPlan(2)
      const workspace = createSemitoneAttributionWorkspace(1)
      expect(() => writeAttributedSemitoneLevels(levels, plan, new Float32Array(2), workspace)).toThrow(RangeError)
    })
  })

  describe('TrackTuningEstimator', () => {
    it('locks to a stable tuning offset from recurring partials', () => {
      const binHz = SAMPLE_RATE / FFT_SIZE
      const tunedA3Hz = 220 * 2 ** (24 / 1200)
      const partials = Array.from({ length: Math.floor(5000 / tunedA3Hz) }, (_, index) => tunedA3Hz * (index + 1))
      const spectrum = spectrumWithPeaks(FFT_SIZE / 2, binHz, partials)
      const estimator = new TrackTuningEstimator()

      for (let frame = 0; frame < 7; frame += 1) {
        expect(estimator.addFrame(spectrum, binHz)).toBeNull()
      }
      const offset = estimator.addFrame(spectrum, binHz)
      if (offset === null) throw new Error('Expected the estimator to lock after consistent partials')
      expect(Math.abs(offset - 24)).toBeLessThan(4)
      expect(estimator.addFrame(new Float32Array(FFT_SIZE / 2).fill(-Infinity), binHz)).toBe(offset)
    })

    it('does not estimate a track from silence', () => {
      const binHz = SAMPLE_RATE / FFT_SIZE
      const estimator = new TrackTuningEstimator()
      const silence = new Float32Array(FFT_SIZE / 2).fill(-Infinity)
      for (let frame = 0; frame < 12; frame += 1) {
        expect(estimator.addFrame(silence, binHz)).toBeNull()
      }
    })
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

describe('semitoneShare', () => {
  it('maps note levels continuously from the contrast cutoff to the ceiling', () => {
    expect(semitoneShare(SEMITONE_CONTRAST_DB)).toBe(0)
    const span = SEMITONE_BRIGHTNESS_CEILING_DB - SEMITONE_CONTRAST_DB
    expect(semitoneShare(SEMITONE_CONTRAST_DB + span * 0.25)).toBeCloseTo(0.25)
    expect(semitoneShare(SEMITONE_CONTRAST_DB + span * 0.5)).toBeCloseTo(0.5)
    expect(semitoneShare(SEMITONE_CONTRAST_DB + span * 0.75)).toBeCloseTo(0.75)
    expect(semitoneShare(-12)).toBeGreaterThan(semitoneShare(-18))
    expect(semitoneShare(SEMITONE_BRIGHTNESS_CEILING_DB)).toBe(1)
    expect(semitoneShare(SEMITONE_BRIGHTNESS_CEILING_DB + 20)).toBe(1)
  })
})

describe('SemitoneActivityFilter', () => {
  it('carries established keys through a hit and raises the threshold for new keys as the field fills', () => {
    const filter = new SemitoneActivityFilter(5, 0.2)
    const levels = new Float32Array(5).fill(-Infinity)
    levels[0] = -30
    filter.step(levels, levels, 0)

    filter.recordTransient(1, 1)
    levels.fill(-34)
    levels[0] = -44
    const future = new Float32Array(5).fill(-Infinity)
    filter.step(levels, future, 1)

    expect(filter.levels[0]).toBe(-44)
    expect(Array.from(filter.levels.slice(1)).every((level) => level === -Infinity)).toBe(true)
  })

  it('rejects a short broadband transient before it can become a key set', () => {
    const filter = new SemitoneActivityFilter(4, 0.2)
    const levels = new Float32Array(4).fill(-Infinity)
    const future = new Float32Array(4).fill(-Infinity)
    filter.step(levels, future, 0)
    filter.recordTransient(0.01, 1)

    levels.fill(-25)
    filter.step(levels, future, 0.02)
    filter.step(levels, future, 0.15)
    expect(Array.from(filter.levels).every((level) => level === -Infinity)).toBe(true)

    levels.fill(-Infinity)
    filter.step(levels, future, 0.16)
    filter.step(levels, future, 0.25)
    expect(Array.from(filter.levels).every((level) => level === -Infinity)).toBe(true)
  })

  it('lets sustained future evidence confirm a transient at its original audio time', () => {
    const filter = new SemitoneActivityFilter(1, 0.2)
    const levels = Float32Array.of(-Infinity)
    const future = Float32Array.of(-Infinity)
    filter.step(levels, future, 0)
    filter.recordTransient(0.01, 1)

    levels[0] = -20
    filter.step(levels, future, 0.02)
    expect(filter.levels[0]).toBe(-Infinity)

    future[0] = -20
    filter.step(levels, future, 0.03)
    expect(filter.levels[0]).toBe(-20)
  })

  it('activates a qualified key immediately when no transient needs filtering', () => {
    const filter = new SemitoneActivityFilter(1, 0.2)
    const levels = Float32Array.of(-30)
    expect(filter.step(levels, levels, 0)[0]).toBe(-30)
  })
})

describe('SemitoneFade', () => {
  it('rises immediately and fades to zero on the configured shape and duration', () => {
    const fade = new SemitoneFade(1)
    const bright = Float32Array.of(1)
    const dark = Float32Array.of(0)

    fade.step(bright, 0)
    expect(fade.levels[0]).toBe(1)
    fade.step(dark, 0)
    fade.step(dark, SEMITONE_FADE_SEC / 2)
    expect(fade.levels[0]).toBeCloseTo((1 - 0.5) ** 2, 5)
    fade.step(dark, SEMITONE_FADE_SEC / 2)
    expect(fade.levels[0]).toBe(0)
    expect(fade.isAtRest()).toBe(true)
  })

  it('brightens immediately', () => {
    const fade = new SemitoneFade(1)
    fade.step(Float32Array.of(1), 0)
    fade.step(Float32Array.of(0), 0)
    fade.step(Float32Array.of(0), SEMITONE_FADE_SEC / 2)
    const halfway = fade.levels[0]

    fade.step(Float32Array.of(0.5), 0)

    expect(halfway).toBeGreaterThan(0)
    expect(fade.levels[0]).toBe(0.5)
  })

  it('retargets a falling light from its current value', () => {
    const fade = new SemitoneFade(1)
    fade.step(Float32Array.of(1), 0)
    fade.step(Float32Array.of(0), 0)
    fade.step(Float32Array.of(0), SEMITONE_FADE_SEC / 2)
    const beforeRetarget = fade.levels[0]
    const target = 0.1

    fade.step(Float32Array.of(target), 0)
    expect(fade.levels[0]).toBe(beforeRetarget)

    fade.step(Float32Array.of(target), SEMITONE_FADE_SEC / 4)
    expect(fade.levels[0]).toBeCloseTo(target + (beforeRetarget - target) * (1 - 0.25) ** 2, 5)
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
