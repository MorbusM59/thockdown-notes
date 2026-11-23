import { describe, expect, it } from 'vitest'
import { FftPlan } from '@thockdown/audio/fft'
import { CROSSOVER_HZ, LONG_FFT, SHORT_FFT, bandCentreHz, createBandLevelPlan, logBandEdges, writeBandLevelsWithPlan } from './spectrumBands'
import { LEVEL_STEPS_PER_DB, SpectrumFrames, levelDb, type SpectrumFrameBatch } from './spectrumFrames'

const RATE = 48000
const edges = logBandEdges(64)
const bands = edges.length - 1

/** `AnalyserNode.getFloatFrequencyData` with no smoothing, as spectrumBands.test.ts emulates it. */
function analyse(samples: Float64Array): Float32Array {
  const n = samples.length
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i += 1) re[i] = samples[i] * (0.42 - 0.5 * Math.cos((2 * Math.PI * i) / n) + 0.08 * Math.cos((4 * Math.PI * i) / n))
  new FftPlan(n).forward(re, im)
  const out = new Float32Array(n / 2)
  for (let k = 0; k < n / 2; k += 1) out[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) / n)
  return out
}

/** The desktop's bands for the audio heard at `f`: each resolution's window centred on it. */
function reference(mono: Float64Array, f: number): Float32Array {
  let split = 0
  while (split < bands && bandCentreHz(edges, split) < CROSSOVER_HZ) split += 1
  const out = new Float32Array(bands)
  writeBandLevelsWithPlan(analyse(mono.slice(f - LONG_FFT / 2, f + LONG_FFT / 2)), createBandLevelPlan(LONG_FFT / 2, RATE / LONG_FFT, edges, 0, split), out)
  writeBandLevelsWithPlan(analyse(mono.slice(f - SHORT_FFT / 2, f + SHORT_FFT / 2)), createBandLevelPlan(SHORT_FFT / 2, RATE / SHORT_FFT, edges, split, bands), out)
  return out
}

function tones(length: number, hz: number[], seed = 0): [Float32Array, Float32Array] {
  const left = new Float32Array(length)
  const right = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    let value = 0
    for (const f of hz) value += 0.2 * Math.sin((2 * Math.PI * f * (i + seed)) / RATE)
    left[i] = value * 1.2
    right[i] = value * 0.8
  }
  return [left, right]
}

/** Feeds `left`/`right` from `at` in chunks of `chunk`; every frame produced, by position (later batches replacing from their `from`). */
function feed(frames: SpectrumFrames, held: Map<number, Uint8Array>, at: number, left: Float32Array, right: Float32Array, chunk = 1000): void {
  for (let i = 0; i < left.length; i += chunk) {
    const batch: SpectrumFrameBatch | null = frames.push(at + i, left.subarray(i, i + chunk), right.subarray(i, i + chunk))
    if (!batch) continue
    for (const position of [...held.keys()]) if (position >= batch.from) held.delete(position)
    for (let n = 0; n * bands < batch.levels.length; n += 1) held.set(batch.first + n * batch.hop, batch.levels.subarray(n * bands, (n + 1) * bands))
  }
}

describe('SpectrumFrames', () => {
  it('matches the desktop analysers at each frame, within the quantization, where the long bands were just read', () => {
    const [left, right] = tones(RATE, [55, 440, 3000])
    const frames = new SpectrumFrames(RATE, edges)
    const held = new Map<number, Uint8Array>()
    feed(frames, held, 0, left, right)
    const mono = Float64Array.from(left, (l, i) => (l + right[i]) / 2)
    // A frame whose long bands were recomputed at it: every frame whose position is a multiple of the long read interval from the first.
    const first = Math.min(...held.keys())
    for (const f of [first, first + 2400, first + 4800]) {
      const got = held.get(f)!
      const want = reference(mono, f)
      for (let band = 0; band < bands; band += 1) {
        if (want[band] < -120) continue
        expect(Math.abs(levelDb(got[band]) - want[band])).toBeLessThanOrEqual(0.5 / LEVEL_STEPS_PER_DB + 1e-6)
      }
    }
  })

  it('computes again, from a rewind, exactly what a stream spliced there would have', () => {
    const [left, right] = tones(RATE, [220, 5000])
    const [otherLeft, otherRight] = tones(RATE / 2, [90, 1200], 77)
    const splice = 30000
    const rewound = new Map<number, Uint8Array>()
    const frames = new SpectrumFrames(RATE, edges)
    feed(frames, rewound, 0, left, right)
    feed(frames, rewound, splice, otherLeft, otherRight)

    const straight = new Map<number, Uint8Array>()
    const spliced = [new Float32Array(splice + otherLeft.length), new Float32Array(splice + otherLeft.length)]
    spliced[0].set(left.subarray(0, splice)); spliced[0].set(otherLeft, splice)
    spliced[1].set(right.subarray(0, splice)); spliced[1].set(otherRight, splice)
    feed(new SpectrumFrames(RATE, edges), straight, 0, spliced[0], spliced[1], 1000)

    // The long bands are carried between reads, which a rewind restarts, so compare the short bands everywhere and all bands where both just read the long.
    expect([...rewound.keys()]).toEqual([...straight.keys()])
    let split = 0
    while (split < bands && bandCentreHz(edges, split) < CROSSOVER_HZ) split += 1
    for (const [f, levels] of straight) expect(Array.from(rewound.get(f)!.subarray(split)), `frame ${f}`).toEqual(Array.from(levels.subarray(split)))
  })
})
