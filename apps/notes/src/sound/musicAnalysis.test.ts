import { describe, expect, it } from 'vitest'
import { MusicAnalysis, type AnalysisAnswer } from './musicAnalysis'
import type { DecodedChunk, MusicDecodeStream } from './musicDecodeStream'

const RATE = 48000
const CHUNK = 1152

/** Kicks on every beat at `bpm` (a falling sine and a click), nothing else. */
function kicks(seconds: number, bpm: number): { samples: Float32Array; times: number[] } {
  const samples = new Float32Array(Math.round(seconds * RATE))
  const times: number[] = []
  let seed = 1
  for (let t0 = 0; t0 < seconds; t0 += 60 / bpm) {
    times.push(t0)
    let phase = 0
    for (let i = 0; i < 0.3 * RATE; i++) {
      const at = Math.round(t0 * RATE) + i
      if (at >= samples.length) break
      const t = i / RATE
      phase += (2 * Math.PI * (50 + 100 * Math.exp(-t / 0.03))) / RATE
      seed = (seed * 16807) % 2147483647
      samples[at] += 0.9 * Math.sin(phase) * Math.exp(-t / 0.12) + 0.25 * (seed / 2147483647 - 0.5) * Math.exp(-t / 0.003)
    }
  }
  return { samples, times }
}

/** A stand-in for the decoder: hands out `samples` chunk by chunk, synchronously, as far as `want` lets it. */
class FakeStream {
  private wanted = 0
  private next = 0
  private onChunk: DecodedChunk | null = null
  disposed = false

  constructor(readonly url: string, private readonly samples: Float32Array) {}

  sampleRate(): Promise<number | null> {
    return Promise.resolve(RATE)
  }

  run(fromSec: number, untilSec: number, onChunk: DecodedChunk): void {
    this.next = Math.floor((fromSec * RATE) / CHUNK) * CHUNK
    this.wanted = untilSec
    this.onChunk = onChunk
    this.pump()
  }

  want(untilSec: number): void {
    this.wanted = Math.max(this.wanted, untilSec)
    this.pump()
  }

  halt(): void {
    this.onChunk = null
  }

  dispose(): void {
    this.disposed = true
    this.halt()
  }

  private pump(): void {
    while (this.onChunk && this.next < this.samples.length && this.next / RATE < this.wanted) {
      const end = Math.min(this.samples.length, this.next + CHUNK)
      this.onChunk(this.samples.slice(this.next, end), this.next / RATE)
      this.next = end
    }
  }
}

/** Plays `samples` through the analysis the way `musicBeat.ts` asks it: once a 60Hz frame, from `from`, one frame ahead. */
async function play(samples: Float32Array, from: number, seconds: number, contrast = 0.5) {
  const streams: FakeStream[] = []
  const analysis = new MusicAnalysis((url) => {
    const stream = new FakeStream(url, samples)
    streams.push(stream)
    return stream as unknown as MusicDecodeStream
  })
  analysis.handle({ type: 'restart', run: 1, url: 'track', listenerTime: from, readers: [{ id: 7, source: 'kick', frequencyHz: 0, octaves: 0 }], drums: true })
  await Promise.resolve()
  await Promise.resolve()
  const answers: AnalysisAnswer[] = []
  for (let frame = 0; frame * (1 / 60) < seconds; frame++) {
    const at = from + frame / 60
    const answer = analysis.handle({ type: 'ask', run: 1, listenerTime: at, heardTime: at, readers: [{ id: 7, contrast, groove: 0 }], trace: false })
    if (answer) answers.push(answer)
  }
  return { answers, streams, analysis }
}

describe('the beat analysis behind the worker', () => {
  it('answers each kick once, from a cold start in the middle of a track', async () => {
    const track = kicks(40, 120)
    const { answers } = await play(track.samples, 15, 20)
    const hits = answers.filter((a) => a.raws[0] > 0).map((a) => a.heardTime)
    // Once the grid is found (a few seconds), every kick is answered, once, and only kicks are.
    const expected = track.times.filter((t) => t >= 22 && t < 34)
    const shown = hits.filter((t) => t >= 21.98 && t < 34)
    expect(shown.length).toBe(expected.length)
    for (const t of shown) expect(Math.min(...expected.map((k) => Math.abs(k - t)))).toBeLessThan(0.08)
  })

  it('reports the tempo grid and the window peak with every answer', async () => {
    const { answers } = await play(kicks(40, 120).samples, 15, 10)
    const last = answers[answers.length - 1]
    expect(last.gridPeriodSec).toBeCloseTo(0.5, 2)
    expect(last.peak).toBeGreaterThan(0.5)
  })

  it('drops an ask for a run the page has since restarted', async () => {
    const { analysis } = await play(kicks(20, 120).samples, 5, 1)
    analysis.handle({ type: 'restart', run: 2, url: 'track', listenerTime: 8, readers: [], drums: false })
    expect(analysis.handle({ type: 'ask', run: 1, listenerTime: 8, heardTime: 8, readers: [], trace: false })).toBeNull()
  })

  it('keeps the stream through a seek and replaces it for a new track', async () => {
    const { analysis, streams } = await play(kicks(20, 120).samples, 5, 1)
    analysis.handle({ type: 'restart', run: 2, url: 'track', listenerTime: 12, readers: [], drums: false })
    expect(streams.length).toBe(1)
    analysis.handle({ type: 'restart', run: 3, url: 'other', listenerTime: 0, readers: [], drums: false })
    expect(streams.length).toBe(2)
    expect(streams[0].disposed).toBe(true)
  })
})
