import { describe, expect, it } from 'vitest'
import { SignalMap, SIGNAL_RATE as RATE, type SignalInstance } from './signalMap'
import { gridOf, mapOf, track, type Played, type Section } from './signalMap.testkit'

const TOLERANCE_SEC = 0.03

function found(map: SignalMap, times: number[], wants: (i: SignalInstance) => boolean): { missed: number[]; found: number } {
  const all = map.instancesBetween(-Infinity, Infinity).filter(wants)
  const missed = times.filter((t) => !all.some((i) => Math.abs(i.time - t) <= TOLERANCE_SEC))
  return { missed, found: times.length - missed.length }
}

/** Instances `wants` takes that nothing in `played` explains, within the part of the track `played` covers. */
function strays(map: SignalMap, played: number[], wants: (i: SignalInstance) => boolean): number[] {
  return map.instancesBetween(-Infinity, played[played.length - 1] + 0.1).filter(wants).map((i) => i.time).filter((t) => !played.some((p) => Math.abs(p - t) <= TOLERANCE_SEC))
}

const FOUR = [0, 4, 8, 12]
const BACKBEAT = [4, 12]
const EIGHTHS = [2, 6, 10, 14]

describe('SignalMap', { timeout: 60_000 }, () => {
  it('finds every kick and every snare of a four-on-the-floor kit, and flags no hat', () => {
    const played = track(30, 124, [{ from: 0, kicks: FOUR, snares: BACKBEAT, hats: EIGHTHS }])
    const map = mapOf(played)
    const kicks = found(map, played.kicks, (i) => i.kick >= 0.5)
    const snares = found(map, played.snares, (i) => i.hit >= 0.5)
    expect(kicks.missed).toEqual([])
    expect(snares.missed).toEqual([])
    expect(strays(map, played.kicks, (i) => i.kick >= 0.5)).toEqual([])
    expect(strays(map, played.snares, (i) => i.hit >= 0.5)).toEqual([])
  })

  it('a kick layered with a snare fires both, and a lone kick only the kick', () => {
    const played = track(30, 124, [{ from: 0, kicks: FOUR, snares: BACKBEAT, hats: [] }])
    const map = mapOf(played)
    expect(found(map, played.snares, (i) => i.hit >= 0.5).missed).toEqual([])
    expect(found(map, played.kicks, (i) => i.kick >= 0.5).missed).toEqual([])
    const lone = played.kicks.filter((t) => !played.snares.some((s) => Math.abs(s - t) < 0.01))
    expect(strays(map, played.snares, (i) => i.hit >= 0.5).filter((t) => lone.some((k) => Math.abs(k - t) < TOLERANCE_SEC))).toEqual([])
  })

  it('the first kick of a section with a new kick sound is a kick, judged with what follows it', () => {
    const played = track(40, 124, [
      { from: 0, kicks: FOUR, snares: BACKBEAT, hats: EIGHTHS },
      { from: 20, kicks: FOUR, snares: BACKBEAT, hats: EIGHTHS, kickSound: [60, 220, 0.06] },
    ])
    const map = mapOf(played)
    const first = played.kicks.find((t) => t >= 20)!
    expect(found(map, [first], (i) => i.kick >= 0.5).missed).toEqual([])
    expect(found(map, played.kicks, (i) => i.kick >= 0.5).missed).toEqual([])
  })

  it('records intensity in absolute dB: a kick 12 dB down reads 0.2 lower', () => {
    const loud = track(12, 124, [{ from: 0, kicks: FOUR, snares: [], hats: [] }])
    const quiet = { ...loud, samples: loud.samples.map((x) => x / 4) }
    const level = (p: Played) => {
      const i = mapOf(p).instancesBetween(4, 8).filter((x) => x.kick >= 0.5)
      return i.reduce((s, x) => s + x.intensity, 0) / i.length
    }
    expect(level(loud) - level(quiet)).toBeCloseTo(12 / 60, 1)
  })

  const STYLES: Array<[string, number, Omit<Section, 'from'>]> = [
    ['house with claps and sixteenth hats', 126, { kicks: FOUR, snares: BACKBEAT, hats: [...Array(16).keys()], clap: true, velocityDb: 3 }],
    ['an 808 trap beat at 70', 70, { kicks: [0, 6, 10], snares: [8], hats: [0, 2, 4, 6, 8, 10, 12, 14], eight08: true, velocityDb: 3 }],
    ['a swung hip-hop beat at 92', 92, { kicks: [0, 7, 10], snares: BACKBEAT, hats: [0, 2, 4, 6, 8, 10, 12, 14], swing: 1 / 3, velocityDb: 4 }],
    ['drum and bass at 172', 172, { kicks: [0, 10], snares: BACKBEAT, hats: [2, 6, 10, 14], velocityDb: 3 }],
  ]

  for (const [name, bpm, style] of STYLES) {
    it(`finds the kicks and the snares of ${name}`, () => {
      const played = track(40, bpm, [{ from: 0, ...style }])
      const map = mapOf(played)
      expect({
        kicksMissed: found(map, played.kicks, (i) => i.kick >= 0.5).missed,
        snaresMissed: found(map, played.snares, (i) => i.hit >= 0.5).missed,
        kickStrays: strays(map, played.kicks, (i) => i.kick >= 0.5),
        hitStrays: strays(map, played.snares, (i) => i.hit >= 0.5),
      }).toEqual({ kicksMissed: [], snaresMissed: [], kickStrays: [], hitStrays: [] })
    })
  }

  it('a map built ahead of a moving listener, ten seconds at first, finds what the whole track does', () => {
    const played = track(40, 124, [
      { from: 0, kicks: FOUR, snares: BACKBEAT, hats: EIGHTHS },
      { from: 20, kicks: FOUR, snares: BACKBEAT, hats: EIGHTHS, kickSound: [60, 220, 0.06] },
    ])
    const map = new SignalMap(gridOf(played.beats))
    const chunk = RATE / 4
    let fed = 0
    // Ten seconds of music first, then the listener moves on and the map keeps ten to twenty seconds ahead.
    while (fed < 10 * RATE) { map.feed(played.samples.subarray(fed, fed + chunk), fed / RATE); fed += chunk }
    for (let heard = 0; heard < 39.5; heard += 0.5) {
      while (fed < Math.min(played.samples.length, (heard + 20) * RATE)) { map.feed(played.samples.subarray(fed, fed + chunk), fed / RATE); fed += chunk }
      map.analyse(heard)
    }
    expect(found(map, played.kicks, (i) => i.kick >= 0.5).missed).toEqual([])
    expect(found(map, played.snares, (i) => i.hit >= 0.5).missed).toEqual([])
    expect(strays(map, played.kicks, (i) => i.kick >= 0.5)).toEqual([])
    expect(strays(map, played.snares, (i) => i.hit >= 0.5)).toEqual([])
  })

  it('read by a moving listener while it forgets what lies behind, gives every hit once and holds a bounded span', () => {
    const played = track(90, 124, [{ from: 0, kicks: FOUR, snares: BACKBEAT, hats: EIGHTHS }])
    const map = new SignalMap(gridOf(played.beats))
    const chunk = RATE / 4
    let fed = 0
    const kicks: number[] = []
    const hits: number[] = []
    let read = -Infinity
    let held = 0
    for (let heard = 0; heard < 89.5; heard += 0.5) {
      while (fed < Math.min(played.samples.length, (heard + 20) * RATE)) { map.feed(played.samples.subarray(fed, fed + chunk), fed / RATE); fed += chunk }
      map.forgetBefore(heard - 30)
      map.analyse(heard)
      held = Math.max(held, map.heldSec)
      // As a reader takes them: each instance once, when the listener reaches it.
      for (const x of map.instancesBetween(read, heard + 1e-9)) {
        if (x.time <= read) continue
        if (x.kick >= 0.5) kicks.push(x.time)
        if (x.hit >= 0.5) hits.push(x.time)
      }
      read = heard
    }
    const near = (times: number[], t: number) => times.some((x) => Math.abs(x - t) < 0.03)
    // The first ten seconds are learned before anything is flagged; from then on every hit is read, once.
    for (const t of played.kicks.filter((t) => t >= 12 && t < 89)) expect(near(kicks, t), `kick at ${t.toFixed(2)}`).toBe(true)
    for (const t of played.snares.filter((t) => t >= 12 && t < 89)) expect(near(hits, t), `snare at ${t.toFixed(2)}`).toBe(true)
    for (const t of kicks) expect(near(played.kicks, t), `stray kick at ${t.toFixed(2)}`).toBe(true)
    for (const t of hits) expect(near(played.snares, t), `stray hit at ${t.toFixed(2)}`).toBe(true)
    for (const list of [kicks, hits]) for (let i = 1; i < list.length; i++) expect(list[i] - list[i - 1], 'read twice').toBeGreaterThan(0.05)
    // Thirty seconds behind, twenty ahead, and up to a forget block more.
    expect(held).toBeLessThan(62)
  })

  it('finds a kick the pattern predicts under a crash that hides its onset', () => {
    const played = track(30, 124, [{ from: 0, kicks: FOUR, snares: BACKBEAT, hats: [] }])
    const crash = brightNoiseBurst(played.samples, 3)
    // A long crash swelling in before every fourth bar's first kick masks that kick's click and much of its climb.
    const bar = (4 * 60) / 124
    for (let t = 4 * bar; t < 28; t += 4 * bar) crash(t - 0.06, 0.06)
    const map = mapOf(played)
    expect(found(map, played.kicks, (i) => i.kick >= 0.5).missed).toEqual([])
  })
})

/** Adds a crash swelling for `swell` seconds into time `t`, then ringing. */
function brightNoiseBurst(out: Float32Array, seed: number): (t: number, swell: number) => void {
  let s = seed
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 31 - 1 }
  return (t, swell) => {
    for (let i = 0; i < (swell + 1) * RATE; i++) {
      const at = Math.round((t - swell) * RATE) + i
      if (at < 0 || at >= out.length) continue
      const u = i / RATE
      const env = u < swell ? u / swell : Math.exp(-(u - swell) / 0.5)
      out[at] += 0.8 * env * rand()
    }
  }
}

