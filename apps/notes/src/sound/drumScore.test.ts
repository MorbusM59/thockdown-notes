import { describe, expect, it } from 'vitest'
import { BeatMap } from './beatMap'
import { writeDrumScore, type DrumInstance } from './drumScore'

const RATE = 48000
const BEAT = 0.5

/** A deterministic noise source in -0.5..0.5. */
function noise(seed: number): () => number {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5
}

/**
 * A bar of rock at 120 BPM for `seconds`: a kick on one and three, a snare on two and four, a closed hat on every
 * off-beat eighth. `kickGain` scales each kick by its time, to make one weak.
 */
function rock(seconds: number, kickGain: (t: number) => number = () => 1) {
  const out = new Float32Array(Math.round(seconds * RATE))
  const kicks: number[] = []
  const snares: number[] = []
  const hats: number[] = []
  const rand = noise(7)
  const add = (t0: number, length: number, sample: (t: number) => number) => {
    for (let i = 0; i < length * RATE; i++) {
      const at = Math.round(t0 * RATE) + i
      if (at < out.length) out[at] += sample(i / RATE)
    }
  }
  for (let beat = 0; beat * BEAT < seconds; beat++) {
    const t0 = beat * BEAT
    if (beat % 2 === 0) {
      kicks.push(t0)
      const gain = kickGain(t0)
      let phase = 0
      add(t0, 0.25, (t) => {
        phase += (2 * Math.PI * (50 + 100 * Math.exp(-t / 0.03))) / RATE
        return gain * 0.8 * Math.sin(phase) * Math.exp(-t / 0.1)
      })
    } else {
      snares.push(t0)
      // Noise low-passed around 3 kHz (a snare's rattle, not a cymbal's sizzle), and a body at 200 Hz.
      let v = 0
      add(t0, 0.2, (t) => {
        v += 0.35 * (rand() - v)
        return 1.2 * v * Math.exp(-t / 0.05) + 0.3 * Math.sin(2 * Math.PI * 200 * t) * Math.exp(-t / 0.04)
      })
    }
    hats.push(t0 + BEAT / 2)
    // White noise differenced: a high-passed tick.
    let last = 0
    add(t0 + BEAT / 2, 0.12, (t) => {
      const n = rand()
      const v = n - last
      last = n
      return 0.25 * v * Math.exp(-t / 0.03)
    })
  }
  // A quiet bed of noise under it all, as music has: from digital silence any sound at all is an infinite rise.
  for (let i = 0; i < out.length; i++) out[i] += 0.01 * rand()
  return { samples: out, kicks, snares, hats }
}

/** The drum score written at `listener` with everything up to `listener + ahead` decoded and the map planned. */
function scoreOf(samples: Float32Array, listener: number, ahead = 20): DrumInstance[] {
  const map = new BeatMap(RATE)
  const chunk = 1152
  for (let fed = 0; fed < samples.length && fed / RATE < listener + ahead; fed += chunk) map.feed(samples.subarray(fed, fed + chunk), fed / RATE)
  map.update(listener)
  return writeDrumScore(map.onsets, map.beatsBetween(-Infinity, Infinity), listener)
}

function near(score: DrumInstance[], time: number): DrumInstance | undefined {
  return score.find((x) => Math.abs(x.time - time) < 0.03)
}

describe('the drum score', () => {
  it('puts each drum in its own channel: the kick a thump, the snare a pierce, the hat a tick', () => {
    const { samples, kicks, snares, hats } = rock(40)
    const score = scoreOf(samples, 10)
    const within = (t: number) => t >= 12 && t < 28
    const drums = { thump: kicks.filter(within), pierce: snares.filter(within), tick: hats.filter(within) }
    const channels = ['thump', 'pierce', 'tick'] as const
    // Every drum is found and is present in its own channel. An attack splashes across the spectrum, so it may show
    // in another channel too, but only fainter than that channel's own drum ever does.
    const faintest = Object.fromEntries(channels.map((c) => [c, Math.min(...drums[c].map((t) => near(score, t)?.[c] ?? Infinity))]))
    for (const own of channels) {
      for (const t of drums[own]) {
        const x = near(score, t)
        expect(x, `${own} at ${t}`).toBeDefined()
        expect(x![own], `${own} at ${t}`).not.toBeNaN()
        for (const other of channels) if (other !== own && !Number.isNaN(x![other])) expect(x![other], `${other} of the ${own} at ${t}`).toBeLessThan(faintest[other])
      }
    }
  })

  it('marks the one of every bar and nothing else', () => {
    const { samples } = rock(40)
    const ones = scoreOf(samples, 10).filter((x) => x.one && x.time >= 12 && x.time < 28).map((x) => x.time)
    expect(ones.length).toBe(8)
    for (let j = 1; j < ones.length; j++) expect(ones[j] - ones[j - 1]).toBeCloseTo(4 * BEAT, 1)
  })

  it('lifts a weak kick of the pattern toward the kicks around it', () => {
    const weak = 20
    const { samples } = rock(40, (t) => (Math.abs(t - weak) < 0.01 ? 0.25 : 1))
    const score = scoreOf(samples, 10)
    const x = near(score, weak)
    expect(x).toBeDefined()
    expect(x!.thump).not.toBeNaN()
    // A quarter-strength kick's flux is a quarter of the others' (ln 4 below in strength); lifted half of the way to
    // the kicks at the same place in the bars around it, it is half that below.
    const others = [16, 18, 22, 24].map((t) => near(score, t)!.thump)
    const typical = others.reduce((a, b) => a + b) / others.length
    expect(typical - x!.thump).toBeLessThan(0.75 * Math.log(4))
  })
})
