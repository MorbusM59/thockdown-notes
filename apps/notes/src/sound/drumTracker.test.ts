import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DrumCursor, DrumTracker, type Drum } from './drumTracker'

const RATE = 48000

/** A deterministic noise source, so a failing run reproduces. */
function noise(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 31 - 1
  }
}

interface Track {
  samples: Float32Array
  kicks: number[]
}

/**
 * Four-on-the-floor house: a pitched-down kick on every beat, an off-beat
 * bass line in the kick's own band (ducked by the kick and swelling back, as
 * sidechained bass does), off-beat open hats, a clap on two and four (unless
 * `clap` is false), and a kick-free breakdown between `breakFrom` and
 * `breakTo`. `kickGain` scales the kick that starts at a given time.
 */
function house(seconds: number, bpm: number, breakFrom = Infinity, breakTo = Infinity, kickGain: (t0: number) => number = () => 1, clap = true): Track {
  const n = Math.round(seconds * RATE)
  const out = new Float32Array(n)
  const beat = 60 / bpm
  const rand = noise(7)
  const kicks: number[] = []
  for (let b = 0; b * beat < seconds; b++) {
    const t0 = b * beat
    const inBreak = t0 >= breakFrom && t0 < breakTo
    if (!inBreak) kicks.push(t0)
    // Kick: a sine falling from 150Hz to 50Hz, decaying over a quarter second.
    if (!inBreak) {
      let phase = 0
      const gain = kickGain(t0)
      for (let i = 0; i < 0.3 * RATE; i++) {
        const at = Math.round(t0 * RATE) + i
        if (at >= n) break
        const t = i / RATE
        phase += (2 * Math.PI * (50 + 100 * Math.exp(-t / 0.03))) / RATE
        out[at] += gain * 0.9 * Math.sin(phase) * Math.exp(-t / 0.12)
        // The beater's click: a few milliseconds of noise.
        out[at] += gain * 0.25 * rand() * Math.exp(-t / 0.003)
      }
    }
    // Bass: a 55/73Hz note on the off-beat, rising over 60ms, held, ducked into the next kick.
    const note = b % 4 === 3 ? 73 : 55
    for (let i = 0; i < beat * 0.5 * RATE; i++) {
      const at = Math.round((t0 + beat / 2) * RATE) + i
      if (at >= n) break
      const t = i / RATE
      const env = Math.min(1, t / 0.06)
      const wave = Math.sin(2 * Math.PI * note * t) + 0.3 * Math.sin(4 * Math.PI * note * t)
      out[at] += 0.45 * env * wave
    }
    // Open hat on the off-beat, clap on two and four.
    for (let i = 0; i < 0.08 * RATE; i++) {
      const at = Math.round((t0 + beat / 2) * RATE) + i
      if (at < n) out[at] += 0.15 * rand() * Math.exp(-i / RATE / 0.03)
    }
    if (clap && b % 2 === 1) {
      for (let i = 0; i < 0.12 * RATE; i++) {
        const at = Math.round(t0 * RATE) + i
        if (at < n) out[at] += 0.3 * rand() * Math.exp(-i / RATE / 0.04)
      }
    }
  }
  return { samples: out, kicks }
}


/** One kick: a sine falling from 150Hz to 50Hz over a quarter second, and the beater's click. */
function addKick(out: Float32Array, t0: number, gain: number, rand: () => number): void {
  let phase = 0
  for (let i = 0; i < 0.3 * RATE; i++) {
    const at = Math.round(t0 * RATE) + i
    if (at >= out.length) break
    const t = i / RATE
    phase += (2 * Math.PI * (50 + 100 * Math.exp(-t / 0.03))) / RATE
    out[at] += gain * 0.9 * Math.sin(phase) * Math.exp(-t / 0.12)
    out[at] += gain * 0.25 * rand() * Math.exp(-t / 0.003)
  }
}

/** A burst of noise: a snare or clap (`decay` 0.04s) or a hat (0.02s). */
function addNoise(out: Float32Array, t0: number, gain: number, decay: number, rand: () => number): void {
  for (let i = 0; i < 4 * decay * RATE; i++) {
    const at = Math.round(t0 * RATE) + i
    if (at < out.length) out[at] += gain * rand() * Math.exp(-i / RATE / decay)
  }
}

interface Groove {
  /** Kicks in one bar, as [sixteenth 0-15, gain]; a gain of 0 is a kick dropped. */
  kicks: (bar: number) => Array<[number, number]>
  /** Sixteenths carrying a snare. */
  snares: number[]
  /** How late the off-beat sixteenths fall, as a share of a sixteenth (1/3 is triplet swing). */
  swing?: number
}

/**
 * A drum pattern over a bass line: kicks and snares where `groove` puts them,
 * closed hats on every eighth, and a bass note on every beat's second
 * eighth, so the low band is never only kick. Returns the kick times played.
 */
function drums(seconds: number, bpm: number, groove: Groove): Track {
  const out = new Float32Array(Math.round(seconds * RATE))
  const rand = noise(5)
  const sixteenth = 60 / bpm / 4
  const at = (bar: number, s: number) => (bar * 16 + s + (s % 2 === 1 ? groove.swing ?? 0 : 0)) * sixteenth
  const kicks: number[] = []
  for (let bar = 0; at(bar, 0) < seconds; bar++) {
    for (const [s, gain] of groove.kicks(bar)) {
      if (gain <= 0) continue
      addKick(out, at(bar, s), gain, rand)
      if (gain >= 0.5) kicks.push(at(bar, s))
    }
    for (const s of groove.snares) addNoise(out, at(bar, s), 0.35, 0.04, rand)
    for (let s = 0; s < 16; s += 2) addNoise(out, at(bar, s), 0.08, 0.02, rand)
    for (let beat = 0; beat < 4; beat++) {
      const t0 = at(bar, beat * 4 + 2)
      for (let i = 0; i < 2 * sixteenth * RATE; i++) {
        const k = Math.round(t0 * RATE) + i
        if (k >= out.length) break
        const t = i / RATE
        out[k] += 0.35 * Math.min(1, t / 0.04) * Math.sin(2 * Math.PI * 49 * t)
      }
    }
  }
  return { samples: out, kicks: kicks.filter((k) => k < seconds) }
}

/** The share of `kicks` between `from` and `to` that drew a hit above `floor`, and the hits above `floor` that matched no kick. */
function score(track: Track, hits: Array<{ at: number; response: number }>, from: number, to: number, floor: number) {
  const kicks = track.kicks.filter((k) => k > from && k < to)
  const found = kicks.filter((k) => (hitFor(k, hits)?.response ?? 0) > floor).length / kicks.length
  const strays = hits.filter((h) => h.at > from && h.at < to && h.response > floor && !track.kicks.some((k) => h.at >= k - EARLY_SEC && h.at <= k + LATE_SEC))
  return { found, strays }
}

interface PlayOptions {
  /** How far the hit asked for trails the feed, in seconds. */
  lagSec?: number
  /** Error in the media time each feed is stamped with, uniform within ±this, in seconds. */
  stampJitterSec?: number
  /** Every this many frames, the frame's samples are lost and only their count is reported. */
  loseEvery?: number
  /** How steadily the answer holds the learned pattern (`DrumTracker.hitBetween`). */
  groove?: number
}

/**
 * Plays a track through the tracker the way `musicBeat.ts` does: fed in
 * display-frame chunks of uneven size (a 60Hz display with jitter and the odd
 * long frame), and asked at each frame for the hit heard `lagSec` behind the
 * feed. Returns every hit reported, with its media time and response.
 */
function play(track: Track, contrast: number, options: PlayOptions = {}, drum: Drum = 'kick'): { hits: Array<{ at: number; response: number }>; tracker: DrumTracker } {
  const { lagSec = 5, stampJitterSec = 0, loseEvery = 0, groove = 0 } = options
  const tracker = new DrumTracker(RATE)
  const cursor = new DrumCursor()
  const rand = noise(3)
  const jitter = noise(11)
  let lost = 0
  const hits: Array<{ at: number; response: number }> = []
  let fed = 0
  let frame = 0
  while (fed < track.samples.length) {
    frame++
    const chunk = frame % 97 === 0 ? 2400 : Math.round(800 + 120 * rand())
    const end = Math.min(track.samples.length, fed + chunk)
    if (loseEvery > 0 && frame % loseEvery === 0) {
      lost += end - fed
    } else {
      tracker.feed(track.samples.subarray(fed, end), 0, (end - 1) / RATE + stampJitterSec * jitter(), lost)
      lost = 0
    }
    fed = end
    const heard = end / RATE - lagSec
    if (heard <= 0) continue
    const response = tracker.hitBetween(drum, cursor, heard, contrast, groove)
    if (response > 0) hits.push({ at: heard, response })
  }
  return { hits, tracker }
}

/**
 * The hit reported for a kick: the first frame at or after its onset peak,
 * which trails the kick's first sample by up to 20ms (more where a bass note
 * overlaps it), so up to that plus a long (50ms) frame late.
 */
const LATE_SEC = 0.075
/** How early a hit may be reported: the hop clock's resolution and the envelope's centre. */
const EARLY_SEC = 0.02

function hitFor(kick: number, hits: Array<{ at: number; response: number }>) {
  return hits.find((h) => h.at >= kick - EARLY_SEC && h.at <= kick + LATE_SEC)
}

describe('DrumTracker on kicks', () => {
  it('locks to the tempo of four-on-the-floor house', () => {
    const { tracker } = play(house(20, 126), 0.5)
    expect(tracker.tempoBpm).toBeGreaterThan(125)
    expect(tracker.tempoBpm).toBeLessThan(127)
  })

  it('fires once per kick, on time and at full strength, and never on the bass line, hats or clap', () => {
    const track = house(30, 128)
    const { hits } = play(track, 0.5)
    const kicks = track.kicks.filter((k) => k > 6 && k < 24)
    for (const kick of kicks) expect(hitFor(kick, hits)?.response ?? 0, `kick at ${kick.toFixed(3)}`).toBeGreaterThan(0.75)
    const between = hits.filter((h) => h.at > 6 && h.at < 24 && !kicks.some((k) => h.at >= k - EARLY_SEC && h.at <= k + LATE_SEC))
    expect(between).toEqual([])
    expect(hits.filter((h) => h.at > 6 && h.at < 24 + LATE_SEC).length).toBe(kicks.length)
  })

  it('goes faint through a breakdown with no kick, and picks the kick up again after it', () => {
    const track = house(40, 124, 14, 22)
    const { hits } = play(track, 0.5)
    for (const hit of hits.filter((h) => h.at > 14.1 && h.at < 21.9)) expect(hit.response, `at ${hit.at.toFixed(3)}`).toBeLessThan(0.6)
    for (const kick of track.kicks.filter((k) => k > 24 && k < 34)) {
      expect(hitFor(kick, hits)?.response ?? 0, `kick at ${kick.toFixed(3)}`).toBeGreaterThan(0.75)
    }
  })

  it('reports a hit within a frame of the kick', () => {
    const track = house(20, 128)
    const { hits } = play(track, 0.5)
    // Asked every frame (about 17ms apart), a hit lands within a frame of the
    // onset peak, which trails the kick's first sample by about 15ms. A
    // picture trailing its sound by under 45ms is not perceived as late
    // (ITU-R BT.1359), so 40ms is the bound, with no frame landing early.
    const offsets = track.kicks.filter((k) => k > 6 && k < 14).map((k) => hitFor(k, hits)!.at - k)
    for (const offset of offsets) {
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThan(0.04)
    }
  })

  it('keeps firing on every kick after one far louder than the rest', () => {
    // A kick is judged against the band's recent kicks, so one outlier must
    // count as a full hit and leave the ones after it reading as before.
    const track = house(30, 128, Infinity, Infinity, (t0) => (Math.abs(t0 - 15) < 0.01 ? 3 : 1))
    const { hits } = play(track, 0.5)
    for (const kick of track.kicks.filter((k) => k > 12 && k < 24)) {
      expect(hitFor(kick, hits)?.response ?? 0, `kick at ${kick.toFixed(3)}`).toBeGreaterThan(0.75)
    }
  })

  it('stays on the kicks when the media time it is fed jitters by 10ms a frame', () => {
    // The browser reports a media element's position with jitter of several
    // milliseconds, more than a hop. The hop clock must follow the samples,
    // with the media time only aligning it, or the jitter walks it off the music.
    const track = house(30, 128)
    const { hits } = play(track, 0.5, { stampJitterSec: 0.01 })
    const kicks = track.kicks.filter((k) => k > 6 && k < 24)
    for (const kick of kicks) expect(hitFor(kick, hits)?.response ?? 0, `kick at ${kick.toFixed(3)}`).toBeGreaterThan(0.75)
    const between = hits.filter((h) => h.at > 6 && h.at < 24 && !kicks.some((k) => h.at >= k - EARLY_SEC && h.at <= k + LATE_SEC))
    expect(between).toEqual([])
  })

  it('keeps time across frames whose samples were lost', () => {
    const track = house(30, 128)
    const { hits } = play(track, 0.5, { loseEvery: 41 })
    const kicks = track.kicks.filter((k) => k > 10 && k < 24)
    const found = kicks.filter((k) => (hitFor(k, hits)?.response ?? 0) > 0.5)
    // A kick in a lost frame, or in the ~40ms the bands take to start over
    // after one, is not seen: about one kick in six at a loss every 41 frames.
    // What must hold is the clock: every kick that is seen lands on time and
    // nothing lands between them.
    expect(found.length).toBeGreaterThanOrEqual(Math.floor(kicks.length * 0.8))
    const between = hits.filter((h) => h.at > 10 && h.at < 24 && !kicks.some((k) => h.at >= k - EARLY_SEC && h.at <= k + LATE_SEC))
    expect(between).toEqual([])
  })
})

describe('DrumTracker on kicks in grooves other than four on the floor', () => {
  it.each([
    ['a jungle break at 172', 172, { kicks: () => [[0, 1], [2, 1], [10, 1], [11, 1]], snares: [4, 12] } as Groove],
    ['a hip-hop break at 92', 92, { kicks: () => [[0, 1], [7, 1], [10, 1]], snares: [4, 12] } as Groove],
    ['a swung groove at 118', 118, { kicks: () => [[0, 1], [4, 1], [8, 1], [11, 1], [12, 1]], snares: [4, 12], swing: 1 / 3 } as Groove],
    ['a 3-3-2 pattern at 125', 125, { kicks: () => [[0, 1], [6, 1], [12, 1]], snares: [4, 12] } as Groove],
    ['four on the floor with ghost kicks', 126, { kicks: () => [[0, 1], [4, 1], [7, 0.25], [8, 1], [12, 1], [15, 0.25]], snares: [4, 12] } as Groove],
  ])('fires on every kick of %s and nowhere else', (_name, bpm, groove) => {
    const track = drums(40, bpm, groove)
    const { hits } = play(track, 0.5)
    // 0.3, not the 0.75 of the house tests: these kicks overlap an unducked
    // bass at the kick's own pitch, and the energy they add over it is
    // honestly less than a kick alone (the jungle downbeat reads 0.46 every bar).
    const { found, strays } = score(track, hits, 10, 34, 0.3)
    expect(found).toBeGreaterThan(0.95)
    expect(strays).toEqual([])
  })

  it('locks to the beat of a 3-3-2 pattern rather than to its kicks', () => {
    const { tracker } = play(drums(30, 125, { kicks: () => [[0, 1], [6, 1], [12, 1]], snares: [4, 12] }), 0.5)
    expect(tracker.tempoBpm).toBeGreaterThan(124)
    expect(tracker.tempoBpm).toBeLessThan(126)
  })

  it('fires on the kicks that are played when one in five is dropped at random', () => {
    const drop = noise(17)
    const track = drums(40, 126, { kicks: () => [0, 4, 8, 12].map((s) => [s, drop() > -0.6 ? 1 : 0] as [number, number]), snares: [4, 12] })
    const { hits } = play(track, 0.5)
    const { found, strays } = score(track, hits, 10, 34, 0.3)
    expect(found).toBeGreaterThan(0.95)
    expect(strays).toEqual([])
  })

  it('shows nothing but kicks on a hip-hop break while frames are lost', () => {
    // The hardest case for the lock: a break's comb confidence is a quarter
    // of a four-on-the-floor track's, and before it locks every onset peak
    // (hats, snares, bass) used to flash at full strength.
    const track = drums(40, 92, { kicks: () => [[0, 1], [7, 1], [10, 1]], snares: [4, 12] })
    const { hits } = play(track, 0.5, { loseEvery: 41 })
    const { found, strays } = score(track, hits, 10, 34, 0.3)
    expect(found).toBeGreaterThan(0.8)
    expect(strays).toEqual([])
  })

  it('leaves the beat before a fill\'s downbeat dark, so the downbeat lands as a fresh hit', () => {
    // Every eighth bar ends in two beats of sixteenth toms and no kick, into
    // a kick and crash on the one. A tom pulsing a sixteenth before the one
    // left the pulse still falling when it landed, and it read as missed.
    const bpm = 126
    const beat = 60 / bpm
    const bar = 4 * beat
    const barOf = (t: number) => Math.floor(t / bar + 1e-6)
    const inFill = (t: number) => barOf(t) % 8 === 7 && t - barOf(t) * bar >= 2 * beat - 1e-6
    const isOne = (t: number) => barOf(t) % 8 === 0 && t > 1 && t - barOf(t) * bar < 1e-6
    const track = house(60, bpm, Infinity, Infinity, (t0) => (inFill(t0) ? 0 : isOne(t0) ? 1.4 : 1))
    track.kicks = track.kicks.filter((k) => !inFill(k))
    const rand = noise(21)
    for (let b = 7; b * bar < 60; b += 8) {
      for (let s = 0; s < 8; s++) {
        const t0 = b * bar + 2 * beat + (s * beat) / 4
        let phase = 0
        for (let i = 0; i < 0.1 * RATE; i++) {
          const at = Math.round(t0 * RATE) + i
          if (at >= track.samples.length) break
          const t = i / RATE
          phase += (2 * Math.PI * 140 * (1 + 0.5 * Math.exp(-t / 0.02))) / RATE
          track.samples[at] += 0.6 * Math.sin(phase) * Math.exp(-t / 0.08) + 0.3 * rand() * Math.exp(-t / 0.03)
        }
      }
      for (let i = 0; i < 2 * RATE; i++) {
        const at = Math.round((b + 1) * bar * RATE) + i
        if (at < track.samples.length) track.samples[at] += 0.4 * rand() * Math.exp(-i / RATE / 0.6)
      }
    }
    const { hits } = play(track, 0.5)
    for (const one of track.kicks.filter((k) => isOne(k) && k > 8 && k < 55)) {
      expect(hitFor(one, hits)?.response ?? 0, `downbeat at ${one.toFixed(3)}`).toBeGreaterThan(0.75)
      const before = hits.filter((h) => h.at > one - beat && h.at < one - EARLY_SEC && h.response > 0.3)
      expect(before, `before the downbeat at ${one.toFixed(3)}`).toEqual([])
    }
  })
})

/** White noise through `order` one-pole high-passes at `hz`: a bright burst with little below it. */
function brightNoise(hz: number, order: number, rand: () => number): () => number {
  const a = 1 / (1 + (2 * Math.PI * hz) / RATE)
  const x = new Float64Array(order + 1)
  const y = new Float64Array(order + 1)
  return () => {
    let input = rand()
    for (let k = 0; k < order; k++) {
      y[k] = a * (y[k] + input - x[k])
      x[k] = input
      input = y[k]
    }
    return input
  }
}

/** A snare: a 190Hz body decaying over 80ms under a burst of noise above 1kHz decaying over 120ms. */
function addSnare(out: Float32Array, t0: number, gain: number, bright: () => number): void {
  for (let i = 0; i < 0.5 * RATE; i++) {
    const at = Math.round(t0 * RATE) + i
    if (at >= out.length) break
    const t = i / RATE
    out[at] += gain * (0.5 * Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t / 0.08) + 0.6 * bright() * Math.exp(-t / 0.12))
  }
}

/** A closed hat: noise above 7kHz, decaying over 25ms. */
function addHat(out: Float32Array, t0: number, gain: number, bright: () => number): void {
  for (let i = 0; i < 0.15 * RATE; i++) {
    const at = Math.round(t0 * RATE) + i
    if (at < out.length) out[at] += gain * bright() * Math.exp(-i / RATE / 0.025)
  }
}

/** White noise through two one-pole low-passes at `hz`. */
function darkNoise(hz: number, rand: () => number): () => number {
  const a = 1 - Math.exp((-2 * Math.PI * hz) / RATE)
  let y1 = 0
  let y2 = 0
  return () => {
    y1 += a * (rand() - y1)
    y2 += a * (y1 - y2)
    return y2
  }
}

/**
 * A mixed kick: `addKick`'s body with its beater click below 3kHz, where a
 * mastered kick's click sits, some 10dB under its body. `addKick`'s click is white to the top of the
 * spectrum, brighter than a hat, and a hat landing on it cannot be told from it.
 */
function addMixedKick(out: Float32Array, t0: number, click: () => number): void {
  let phase = 0
  for (let i = 0; i < 0.3 * RATE; i++) {
    const at = Math.round(t0 * RATE) + i
    if (at >= out.length) break
    const t = i / RATE
    phase += (2 * Math.PI * (50 + 100 * Math.exp(-t / 0.03))) / RATE
    out[at] += 0.9 * Math.sin(phase) * Math.exp(-t / 0.12) + 0.3 * click() * Math.exp(-t / 0.004)
  }
}

interface Kit {
  /** Sixteenths in a bar carrying each drum. */
  kicks: number[]
  snares: number[]
  hats: number[]
  /** Clap-like snares: noise only, no body (a clap or a rim shot's crack). */
  clap?: boolean
  /** Where no drum plays, in seconds (the bass line goes on): a break. */
  silent?: [number, number]
  /** The hats from a bar on, replacing `hats`: a change of pattern. */
  hatsFrom?: { bar: number; hats: number[] }
  /** One-off extra snares, as [bar, sixteenth]. */
  accents?: Array<[number, number]>
}

/**
 * A full kit over a bass line on every beat's second eighth, with the times
 * each drum was played. A snare is the same sound throughout; hats vary in
 * gain the way a played hat does.
 */
function kit(seconds: number, bpm: number, groove: Kit): { samples: Float32Array; kicks: number[]; snares: number[]; hats: number[] } {
  const out = new Float32Array(Math.round(seconds * RATE))
  const rand = noise(9)
  const click = darkNoise(3000, noise(17))
  const snareNoise = brightNoise(1000, 2, noise(13))
  const hatNoise = brightNoise(7000, 3, noise(15))
  const sixteenth = 60 / bpm / 4
  const played = { kicks: [] as number[], snares: [] as number[], hats: [] as number[] }
  for (let bar = 0; bar * 16 * sixteenth < seconds; bar++) {
    const at = (s: number) => (bar * 16 + s) * sixteenth
    const plays = (s: number) => !groove.silent || at(s) < groove.silent[0] || at(s) >= groove.silent[1]
    const hats = groove.hatsFrom && bar >= groove.hatsFrom.bar ? groove.hatsFrom.hats : groove.hats
    const accents = (groove.accents ?? []).filter(([b]) => b === bar).map(([, s]) => s)
    for (const s of groove.kicks.filter(plays)) { addMixedKick(out, at(s), click); played.kicks.push(at(s)) }
    for (const s of [...groove.snares, ...accents].filter(plays)) {
      if (groove.clap) addHat(out, at(s), 0, hatNoise)
      addSnare(out, at(s), 1, snareNoise)
      played.snares.push(at(s))
    }
    for (const s of hats.filter(plays)) { addHat(out, at(s), 0.35 + 0.1 * rand(), hatNoise); played.hats.push(at(s)) }
    for (let beat = 0; beat < 4; beat++) {
      const t0 = at(beat * 4 + 2)
      for (let i = 0; i < 2 * sixteenth * RATE; i++) {
        const k = Math.round(t0 * RATE) + i
        if (k >= out.length) break
        const t = i / RATE
        out[k] += 0.35 * Math.min(1, t / 0.04) * Math.sin(2 * Math.PI * 49 * t)
      }
    }
  }
  const within = (times: number[]) => times.filter((t) => t < seconds)
  return { samples: out, kicks: within(played.kicks), snares: within(played.snares), hats: within(played.hats) }
}

/**
 * What a song puts in the mids over a kit: a strummed chord on every eighth
 * (sawtooth strings to 4kHz with a pick's click, each strum landing a little
 * after the grid as a player's does) and a voice (noise between 300Hz and
 * 3.5kHz in syllables of uneven length and loudness), neither reaching the
 * hat's band. Added to `out` in place.
 */
function addBusyMids(out: Float32Array, bpm: number): void {
  const rand = noise(21)
  const pick = darkNoise(4000, brightNoise(800, 1, noise(23)))
  const voice = darkNoise(3500, brightNoise(300, 1, noise(25)))
  const eighth = 60 / bpm / 2
  const chords = [[82, 123, 165, 207], [110, 165, 220, 277], [98, 147, 196, 247], [73, 110, 147, 185]]
  for (let e = 0; e * eighth < out.length / RATE; e++) {
    const t0 = e * eighth + 0.004 + 0.012 * Math.abs(rand())
    const chord = chords[Math.floor(e / 8) % chords.length]
    const gain = 0.12 + 0.05 * rand()
    for (let i = 0; i < 0.6 * RATE; i++) {
      const at = Math.round(t0 * RATE) + i
      if (at >= out.length) break
      const t = i / RATE
      let s = 0
      for (let n = 0; n < chord.length; n++) {
        // Strummed: each string a few ms after the last.
        const ts = t - 0.006 * n
        if (ts < 0) continue
        for (let h = 1; chord[n] * h < 4000; h++) s += Math.sin(2 * Math.PI * chord[n] * h * ts) / h
      }
      out[at] += gain * (0.25 * s * Math.min(1, t / 0.003) * Math.exp(-t / 0.25) + 0.6 * pick() * Math.exp(-t / 0.01))
    }
  }
  // The voice: syllables 80-400ms long, each its own loudness, with breaths between phrases.
  let t = 0
  while (t < out.length / RATE) {
    const length = 0.08 + 0.32 * Math.abs(rand())
    const gain = (Math.floor(t / 4) % 2 === 0 ? 0.5 : 0) * (0.6 + 0.4 * Math.abs(rand()))
    for (let i = 0; i < length * RATE; i++) {
      const at = Math.round(t * RATE) + i
      if (at >= out.length) break
      const u = i / RATE
      out[at] += gain * voice() * Math.min(1, u / 0.02) * Math.min(1, (length - u) / 0.03)
    }
    t += length + 0.03 * Math.abs(rand())
  }
}

/** `play` and `score` for one drum of a kit: the share of its hits found, and the hits that matched none of them. */
function scoreDrum(track: ReturnType<typeof kit>, drum: Drum, times: number[], options: PlayOptions = {}) {
  const { hits } = play({ samples: track.samples, kicks: times }, 0.5, options, drum)
  return score({ samples: track.samples, kicks: times }, hits, 10, 34, 0.3)
}

/** How long the kit's snare rings over a hat after it: its noise falls 6dB in about 70ms, measured from the end of its climb. */
const SNARE_RING_SEC = 0.15

describe('DrumTracker on snares and hats', () => {
  const rock: Kit = { kicks: [0, 8, 10], snares: [4, 12], hats: [0, 2, 4, 6, 8, 10, 12, 14] }

  it.each([
    ['a rock beat at 110', 110, rock],
    ['a hip-hop break at 92', 92, { kicks: [0, 7, 10], snares: [4, 12], hats: [0, 2, 4, 6, 8, 10, 12, 14] }],
    ['a jungle break at 172', 172, { kicks: [0, 2, 10, 11], snares: [4, 12], hats: [0, 2, 4, 6, 8, 10, 12, 14] }],
    ['house with the clap on the kick at 126', 126, { kicks: [0, 4, 8, 12], snares: [4, 12], hats: [2, 6, 10, 14] }],
  ])('fires on every snare of %s and nowhere else', (_name, bpm, groove) => {
    const track = kit(40, bpm, groove)
    const { found, strays } = scoreDrum(track, 'snare', track.snares)
    expect(found).toBeGreaterThan(0.95)
    expect(strays).toEqual([])
  })

  it.each([
    ['a rock beat at 110', 110, rock],
    ['sixteenth hats at 124', 124, { kicks: [0, 4, 8, 12], snares: [4, 12], hats: [...Array(16).keys()] }],
    ['off-beat hats in house at 126', 126, { kicks: [0, 4, 8, 12], snares: [4, 12], hats: [2, 6, 10, 14] }],
  ])('fires on every hat of %s off the snares, and nowhere else', (_name, bpm, groove) => {
    const track = kit(40, bpm, groove)
    // A hat on a snare, or in the ring of its noise after it, is the snare's: the snare wins (VOICES).
    const free = track.hats.filter((h) => !track.snares.some((s) => h > s - 0.001 && h < s + SNARE_RING_SEC))
    const { hits } = play({ samples: track.samples, kicks: free }, 0.5, {}, 'hat')
    const { found } = score({ samples: track.samples, kicks: free }, hits, 10, 34, 0.3)
    // 0.9, not the kick's 0.95: a quiet stroke over the last of a snare's
    // noise, a quarter beat after it, is now and then lost under it.
    expect(found).toBeGreaterThan(0.9)
    const strays = hits.filter((h) => h.at > 10 && h.at < 34 && h.response > 0.3 && !track.hats.some((t) => h.at >= t - EARLY_SEC && h.at <= t + LATE_SEC))
    expect(strays).toEqual([])
  })

  it.each([
    ['a rock beat at 110', 110, rock, 0.9, 0],
    ['sixteenth hats at 124', 124, { kicks: [0, 4, 8, 12], snares: [4, 12], hats: [...Array(16).keys()] }, 0.9, 0],
    // Every hat lands on a strum, so most of them are mixtures and the hat's
    // own colour class is thin: 0.86 measured, from none before the learned
    // line had to start below the spec's. One stray, a voice syllable in
    // the last of a snare's noise, is a known open case.
    ['off-beat hats at 110', 110, { kicks: [0, 8, 10], snares: [4, 12], hats: [2, 6, 10, 14] }, 0.8, 1],
  ])('fires on every hat of %s under strummed guitars and a voice', (_name, bpm, groove, least, mostStrays) => {
    const track = kit(40, bpm, groove)
    addBusyMids(track.samples, bpm)
    const free = track.hats.filter((h) => !track.snares.some((s) => h > s - 0.001 && h < s + SNARE_RING_SEC))
    const { hits } = play({ samples: track.samples, kicks: free }, 0.5, {}, 'hat')
    const { found } = score({ samples: track.samples, kicks: free }, hits, 10, 34, 0.3)
    const strays = hits.filter((h) => h.at > 10 && h.at < 34 && h.response > 0.3 && !track.hats.some((t) => h.at >= t - EARLY_SEC && h.at <= t + LATE_SEC))
    expect(found).toBeGreaterThan(least)
    expect(strays.length).toBeLessThanOrEqual(mostStrays)
  }, 30_000)

  it('fires on no snare of a beat with no hats under strummed guitars and a voice', () => {
    // With no hats, the lowest colour class is the snare's (or the voice's
    // under it), and a line learned above it let every snare through.
    const track = kit(40, 110, { kicks: [0, 8, 10], snares: [4, 12], hats: [] })
    addBusyMids(track.samples, 110)
    const { hits } = play({ samples: track.samples, kicks: [] }, 0.5, {}, 'hat')
    expect(hits.filter((h) => h.at > 10 && h.at < 34 && h.response > 0.3)).toEqual([])
  }, 30_000)

  it('leaves the kicks alone: neither the snare nor the hat fires on a kick by itself', () => {
    const track = kit(40, 110, rock)
    const lone = track.kicks.filter((k) => !track.snares.concat(track.hats).some((t) => Math.abs(t - k) < 0.001))
    for (const drum of ['snare', 'hat'] as const) {
      const { hits } = play({ samples: track.samples, kicks: lone }, 0.5, {}, drum)
      expect(lone.filter((k) => k > 10 && k < 34 && (hitFor(k, hits)?.response ?? 0) > 0.3), drum).toEqual([])
    }
  })

  it('keeps the kick as it was when the kit has every drum', () => {
    const track = kit(40, 110, rock)
    const { found, strays } = scoreDrum(track, 'kick', track.kicks)
    expect(found).toBeGreaterThan(0.95)
    expect(strays).toEqual([])
  })

  it('keeps the snare and the hat on time while the media time jitters and frames are lost', () => {
    const track = kit(40, 110, rock)
    const options = { stampJitterSec: 0.01, loseEvery: 41 }
    const snare = scoreDrum(track, 'snare', track.snares, options)
    expect(snare.found).toBeGreaterThan(0.8)
    expect(snare.strays).toEqual([])
    const free = track.hats.filter((h) => !track.snares.some((s) => h > s - 0.001 && h < s + SNARE_RING_SEC))
    const { hits } = play({ samples: track.samples, kicks: free }, 0.5, options, 'hat')
    // A lost frame every 41 (one every 0.7s) blinds the hat for the frame
    // and the 85ms after it, where what a climb started from is the silence
    // the gap was filled with (`DrumTracker.settle`): about a fifth of these
    // dense hats.
    expect(score({ samples: track.samples, kicks: free }, hits, 10, 34, 0.3).found).toBeGreaterThan(0.7)
    expect(hits.filter((h) => h.at > 10 && h.at < 34 && h.response > 0.3 && !track.hats.some((t) => h.at >= t - EARLY_SEC && h.at <= t + LATE_SEC))).toEqual([])
  })
})

describe('DrumTracker on identical hits', () => {
  it('pulses identical kicks of a syncopated groove identically, wherever in the bar they land', () => {
    // A slow groove whose period is no whole number of hops, so each slot's
    // memory smears across neighbouring bins by a different amount.
    const track = drums(60, 79.2, { kicks: () => [[0, 1], [3, 1], [6, 1], [10, 1], [11, 1]], snares: [4, 12] })
    const responses = play(track, 0.5).hits.filter((h) => h.at > 20).map((h) => h.response).sort((a, b) => a - b)
    expect(responses.length).toBeGreaterThan(50)
    // Including the kick that lands as a bass note stops, whose climb over
    // the note reads a few dB short of an identical kick's over silence.
    expect(responses.filter((r) => r > 0.99).length / responses.length).toBeGreaterThan(0.95)
  })
})

/** The hats of a kit clear of its snares' ring, which the snare wins (VOICES). */
function freeHats(track: ReturnType<typeof kit>): number[] {
  return track.hats.filter((h) => !track.snares.some((s) => h > s - 0.001 && h < s + SNARE_RING_SEC))
}

/**
 * One drum of a kit played at `groove`: the share of `times` between `from`
 * and `to` drawing a hit above 0.3, the share drawing a FULL one (above
 * 0.95), and the hits above 0.3 that matched nothing in `played`.
 */
function grooveScore(track: { samples: Float32Array }, drum: Drum, times: number[], played: number[], groove: number, from = 10, to = 34, options: PlayOptions = {}) {
  const { hits } = play({ samples: track.samples, kicks: times }, 0.5, { ...options, groove }, drum)
  const due = times.filter((t) => t > from && t < to)
  const found = due.filter((t) => (hitFor(t, hits)?.response ?? 0) > 0.3).length / due.length
  const full = due.filter((t) => (hitFor(t, hits)?.response ?? 0) > 0.95).length / due.length
  const strays = hits.filter((h) => h.at > from && h.at < to && h.response > 0.3 && !played.some((t) => h.at >= t - EARLY_SEC && h.at <= t + LATE_SEC))
  return { hits, found, full, strays }
}

/**
 * The tracks the groove-0 fixture (`drumTracker.groove0.fixture.json`) was
 * captured on, with main's tracker, which has no groove (re-captured at 43031195, whose
 * grid hold changed what groove 0 shows; first captured at 0289d71).
 */
function groove0Tracks(): Array<[string, Float32Array]> {
  const busy = kit(20, 110, { kicks: [0, 8, 10], snares: [4, 12], hats: [2, 6, 10, 14] })
  addBusyMids(busy.samples, 110)
  const hipHop = drums(20, 92, { kicks: () => [[0, 1], [7, 1], [10, 1]], snares: [4, 12] })
  return [['busy kit', busy.samples], ['house', house(20, 128).samples], ['hip-hop', hipHop.samples]]
}

/** Feeds `samples` in `play`'s uneven frames and asks `ask` at each frame; returns [frame, response] for every frame that drew a hit. */
function playFrames(samples: Float32Array, feed: (chunk: Float32Array, endTime: number) => void, ask: (heard: number) => number): Array<[number, number]> {
  const rand = noise(3)
  const hits: Array<[number, number]> = []
  let fed = 0
  let frame = 0
  while (fed < samples.length) {
    frame++
    const end = Math.min(samples.length, fed + (frame % 97 === 0 ? 2400 : Math.round(800 + 120 * rand())))
    feed(samples.subarray(fed, end), (end - 1) / RATE)
    fed = end
    const heard = end / RATE - 5
    if (heard <= 0) continue
    const response = ask(heard)
    if (response > 0) hits.push([frame, response])
  }
  return hits
}

describe('DrumTracker with groove', () => {
  it('is the tracker as it was before groove existed at groove 0, response for response', () => {
    // Captured from main's tracker (43031195) on the same tracks, frames and contrast.
    const fixture = JSON.parse(readFileSync(new URL('./drumTracker.groove0.fixture.json', import.meta.url), 'utf8')) as Record<string, Array<[number, number]>>
    for (const [name, samples] of groove0Tracks()) {
      for (const drum of ['kick', 'snare', 'hat'] as const) {
        const tracker = new DrumTracker(RATE)
        const cursor = new DrumCursor()
        const hits = playFrames(samples, (chunk, t) => tracker.feed(chunk, 0, t), (heard) => tracker.hitBetween(drum, cursor, heard, 0.5, 0))
        expect(hits, `${name}/${drum}`).toEqual(fixture[`${name}/${drum}`])
      }
    }
  }, 120_000)

  it('never shows fewer of the pattern\'s hits at a higher groove', () => {
    // Every hit the evidence alone shows (groove 0) that the track played on
    // its pattern is still shown at the middle and at the top of the groove:
    // holding the pattern may add hits, never take a played one away. Among
    // the tracks, a slow syncopated break whose tempo the grid can read at
    // either octave (79 or 158), and a song that starts with no drums.
    const tracks: Array<[string, ReturnType<typeof kit>]> = []
    for (const [bpm, groove] of [
      [110, { kicks: [0, 8, 10], snares: [4, 12], hats: [0, 2, 4, 6, 8, 10, 12, 14] }],
      [124, { kicks: [0, 4, 8, 12], snares: [4, 12], hats: [...Array(16).keys()] }],
      [79, { kicks: [0, 3, 6, 10, 11], snares: [4, 12], hats: [0, 2, 4, 6, 8, 10, 12, 14] }],
      [100, { kicks: [0, 7, 10], snares: [4, 12], hats: [2, 6, 10, 14], silent: [0, 12] }],
    ] as Array<[number, Kit]>) {
      const track = kit(40, bpm, groove)
      addBusyMids(track.samples, bpm)
      tracks.push([`${bpm}`, track])
    }
    for (const [name, track] of tracks) {
      for (const drum of ['kick', 'snare', 'hat'] as const) {
        const times = { kick: track.kicks, snare: track.snares, hat: track.hats }[drum]
        const found = (groove: number) => {
          const { hits } = play({ samples: track.samples, kicks: times }, 0.5, { groove }, drum)
          return times.filter((t) => t > 5 && t < 35 && (hitFor(t, hits)?.response ?? 0) > 0.3)
        }
        const evidence = found(0)
        for (const groove of [0.5, 1]) {
          const held = found(groove)
          expect(evidence.filter((t) => !held.includes(t)).map((t) => t.toFixed(3)), `${name} ${drum} at ${groove}`).toEqual([])
        }
      }
    }
  }, 300_000)

  it('adds nothing before the drums come in, nor once they have faded out, while the bass and the mids go on', () => {
    const bpm = 110
    const comeIn = 12
    const track = kit(40, bpm, { kicks: [0, 8, 10], snares: [4, 12], hats: [0, 2, 4, 6, 8, 10, 12, 14], silent: [0, comeIn] })
    // Faded out over 26..30s, then silent; the mids are added after, so they go on.
    for (let i = Math.round(26 * RATE); i < track.samples.length; i++) track.samples[i] *= Math.max(0, 1 - (i / RATE - 26) / 4)
    addBusyMids(track.samples, bpm)
    for (const drum of ['kick', 'snare', 'hat'] as const) {
      const times = { kick: track.kicks, snare: track.snares, hat: track.hats }[drum]
      const { hits } = play({ samples: track.samples, kicks: times }, 0.5, { groove: 1 }, drum)
      // The evidence itself takes some of what goes on through both for hits
      // (the bass line's notes for kicks, a strum for a snare): the groove
      // adds none.
      const evidence = play({ samples: track.samples, kicks: times }, 0.5, {}, drum).hits
      const added = (from: number, to: number) => hits.filter((h) => h.at > from && h.at < to && h.response > 0.3 && !evidence.some((e) => e.response > 0 && Math.abs(e.at - h.at) < 0.06))
      expect(added(0, comeIn - EARLY_SEC), `${drum} before`).toEqual([])
      expect(added(30, 40), `${drum} after`).toEqual([])
    }
  }, 60_000)

  it('finds the hits of a new tracker at once after reading an older one, at full groove', () => {
    const track = house(60, 124)
    const cursor = new DrumCursor()
    const read = (from: number, to: number) => {
      const tracker = new DrumTracker(RATE)
      let fed = Math.max(0, Math.round((from - 5) * RATE))
      const hits: number[] = []
      for (let heard = from; heard < to; heard += 1 / 60) {
        const end = Math.min(track.samples.length, Math.round((heard + 6) * RATE))
        if (end > fed) tracker.feed(track.samples.subarray(fed, end), 0, (end - 1) / RATE)
        fed = Math.max(fed, end)
        if (tracker.hitBetween('kick', cursor, heard, 0.5, 1) > 0) hits.push(heard)
      }
      return hits
    }
    expect(read(0, 30).length).toBeGreaterThan(40)
    // A seek back: the second tracker's hops count from zero again, and the
    // cursor's answered occurrences belong to the first.
    const after = read(10, 20)
    expect(after[0]).toBeLessThan(11.5)
    expect(after.length).toBeGreaterThan(10)
  })

  it('lands the hats a strummed guitar masks at full groove, at full strength and nowhere off the pattern', () => {
    for (const [bpm, groove] of [
      [110, { kicks: [0, 8, 10], snares: [4, 12], hats: [2, 6, 10, 14] }],
      [124, { kicks: [0, 4, 8, 12], snares: [4, 12], hats: [...Array(16).keys()] }],
    ] as Array<[number, Kit]>) {
      const track = kit(40, bpm, groove)
      addBusyMids(track.samples, bpm)
      const evidence = grooveScore(track, 'hat', freeHats(track), track.hats, 0)
      const held = grooveScore(track, 'hat', freeHats(track), track.hats, 1)
      // Measured: 0.86 and 0.91 found by the evidence alone, 1.0 and 0.99 held.
      expect(evidence.found, `${bpm}`).toBeLessThan(0.95)
      expect(held.found, `${bpm}`).toBeGreaterThan(0.98)
      expect(held.full, `${bpm}`).toBeGreaterThan(0.98)
      // The groove adds nothing off the pattern: the one stray at 110 is the
      // evidence's own (a voice syllable in the last of a snare's noise).
      expect(held.strays.length, `${bpm}`).toBeLessThanOrEqual(evidence.strays.length)
    }
  }, 60_000)

  it('stops within a beat of a two-bar break, while the bass and the mids go on, and resumes on the first hit after it', () => {
    const bpm = 110
    const bar = 240 / bpm
    const silent: [number, number] = [10 * bar, 12 * bar]
    const track = kit(40, bpm, { kicks: [0, 8, 10], snares: [4, 12], hats: [0, 2, 4, 6, 8, 10, 12, 14], silent })
    addBusyMids(track.samples, bpm)
    for (const drum of ['kick', 'snare', 'hat'] as const) {
      const times = { kick: track.kicks, snare: track.snares, hat: track.hats }[drum]
      const evidence = play({ samples: track.samples, kicks: times }, 0.5, {}, drum).hits
      const { hits } = play({ samples: track.samples, kicks: times }, 0.5, { groove: 1 }, drum)
      // Nothing at all from the moment the drum stops: a break is seen before
      // anything is shown for it (the window reaches past the listener).
      expect(hits.filter((h) => h.at > silent[0] - EARLY_SEC && h.at < silent[1] - EARLY_SEC && h.response > 0.3), drum).toEqual([])
      // The first hit after it that the evidence shows is shown, and nothing before it.
      const first = times.find((t) => t >= silent[1] && (hitFor(t, evidence)?.response ?? 0) > 0.3)!
      expect(hitFor(first, hits)?.response ?? 0, drum).toBeGreaterThan(0.3)
      expect(hits.filter((h) => h.at >= silent[1] - EARLY_SEC && h.at < first - EARLY_SEC && h.response > 0.3), drum).toEqual([])
    }
  }, 60_000)

  it('keeps a house breakdown dark, whose bass goes on in the kick\'s own band', () => {
    const track = house(40, 124, 14, 22)
    const { hits } = play(track, 0.5, { groove: 1 })
    expect(hits.filter((h) => h.at > 14.1 && h.at < 21.9)).toEqual([])
    expect(score(track, hits, 24, 34, 0.75).found).toBe(1)
  })

  it('adopts a new pattern within two bars, and lets go of one the drum has left', () => {
    const bpm = 124
    const bar = 240 / bpm
    const eighths = [0, 2, 4, 6, 8, 10, 12, 14]
    const sixteenths = [...Array(16).keys()]
    const kicks = [0, 4, 8, 12]
    const offBeat = (t: number) => Math.round(t / (bar / 16)) % 2 === 1
    // Eighths, then sixteenths from bar 10: every new off-beat sixteenth shows from bar 12.
    const denser = kit(40, bpm, { kicks, snares: [4, 12], hats: eighths, hatsFrom: { bar: 10, hats: sixteenths } })
    const added = freeHats(denser).filter((t) => t >= 12 * bar && offBeat(t))
    expect(grooveScore(denser, 'hat', added, denser.hats, 1).found).toBe(1)
    // Sixteenths, then eighths from bar 10: nothing is shown where the hats stopped.
    const sparser = kit(40, bpm, { kicks, snares: [4, 12], hats: sixteenths, hatsFrom: { bar: 10, hats: eighths } })
    expect(grooveScore(sparser, 'hat', sparser.hats, sparser.hats, 1, 9 * bar).strays).toEqual([])
  }, 60_000)

  it('shows a one-off syncopated snare at a middle groove and holds the pattern over it at full groove', () => {
    const bpm = 110
    const track = kit(40, bpm, { kicks: [0, 8, 10], snares: [4, 12], hats: [0, 2, 4, 6, 8, 10, 12, 14], accents: [[8, 7], [12, 7]] })
    const accents = [8, 12].map((b) => ((b * 16 + 7) * 15) / bpm)
    const regular = track.snares.filter((t) => !accents.some((accent) => Math.abs(t - accent) < 0.001))
    const responses = (groove: number) => {
      const { hits } = play({ samples: track.samples, kicks: track.snares }, 0.5, { groove }, 'snare')
      return accents.map((t) => hitFor(t, hits)?.response ?? 0)
    }
    // Groove 0 is the evidence: the snare's sound is found off the pattern
    // too (the learned counter, `DrumTracker.counterHit`), and the top of
    // the groove holds the pattern over it as over any one-off.
    for (const response of responses(0)) expect(response).toBeGreaterThan(0.95)
    for (const response of responses(0.5)) expect(response).toBeGreaterThan(0.95)
    expect(responses(1)).toEqual([0, 0])
    const held = grooveScore(track, 'snare', regular, track.snares, 1)
    expect(held.found).toBe(1)
    expect(held.full).toBe(1)
  }, 60_000)

  it('holds the hats and kicks while the media time jitters and frames are lost', () => {
    const track = kit(40, 110, { kicks: [0, 8, 10], snares: [4, 12], hats: [2, 6, 10, 14] })
    addBusyMids(track.samples, 110)
    const options = { stampJitterSec: 0.01, loseEvery: 41 }
    const hats = grooveScore(track, 'hat', freeHats(track), track.hats, 1, 10, 34, options)
    // Measured 0.68 by the evidence alone, 0.93 held: a hat in a lost frame
    // whose slot a bar on is lost as well cannot be told from a break.
    expect(hats.found).toBeGreaterThan(0.9)
    expect(hats.strays.length).toBeLessThanOrEqual(2)
    const kicks = grooveScore(track, 'kick', track.kicks, track.kicks, 1, 10, 34, options)
    expect(kicks.found).toBeGreaterThan(0.85)
    expect(kicks.strays.length).toBeLessThanOrEqual(1)
  }, 60_000)

  it('follows a change of tempo and pattern in a long track', () => {
    const a = kit(40, 110, { kicks: [0, 8, 10], snares: [4, 12], hats: [0, 2, 4, 6, 8, 10, 12, 14] })
    const b = kit(40, 128, { kicks: [0, 4, 8, 12], snares: [4, 12], hats: [2, 6, 10, 14] })
    const samples = new Float32Array(a.samples.length + b.samples.length)
    samples.set(a.samples)
    samples.set(b.samples, a.samples.length)
    addBusyMids(samples, 120)
    const joined = (first: number[], second: number[]) => [...first, ...second.map((t) => t + 40)]
    const track = { samples, kicks: joined(a.kicks, b.kicks), snares: joined(a.snares, b.snares), hats: joined(a.hats, b.hats) }
    // The second half, from once the new tempo has filled the window.
    const kicks = grooveScore(track, 'kick', track.kicks, track.kicks, 1, 55, 74)
    expect(kicks.found).toBeGreaterThan(0.9)
    expect(kicks.strays).toEqual([])
    const hats = grooveScore(track, 'hat', freeHats(track), track.hats, 1, 55, 74)
    expect(hats.found).toBeGreaterThan(0.9)
    expect(hats.strays.length).toBeLessThanOrEqual(1)
  }, 60_000)

  it('never fires one hit twice where a jittered kick moves its slot between neighbouring bins', () => {
    // Each kick lands off its sixteenth by up to most of a bin (a bin is a
    // third of a sixteenth), so the learned slot moves between
    // two neighbouring bins from fold to fold: the evidence can match a peak
    // to one and the pattern find the other due a hop later.
    for (const bpm of [96, 118, 124]) {
      const jitter = noise(17)
      const offsets = new Map<number, number>()
      // Up to a fifth of a sixteenth (three fifths of a bin) either side, fixed per kick.
      const nudge = (bar: number, s: number) => {
        const key = bar * 16 + s
        if (!offsets.has(key)) offsets.set(key, 0.2 * jitter())
        return offsets.get(key)!
      }
      const track = drums(40, bpm, { kicks: (bar) => [0, 4, 8, 12].map((s) => [s + nudge(bar, s), 1] as [number, number]), snares: [4, 12] })
      for (const groove of [0.5, 1]) {
        const { hits } = play(track, 0.5, { groove })
        const twice = hits.filter((h, i) => i > 0 && h.at - hits[i - 1].at < 0.08)
        expect(twice.map((h) => h.at.toFixed(3)), `${bpm} at ${groove}`).toEqual([])
        expect(score(track, hits, 10, 34, 0.5).found, `${bpm} at ${groove}`).toBeGreaterThan(0.95)
      }
    }
  }, 120_000)

  it('answers two readers of one drum, each at its own groove, as if each read alone', () => {
    const track = kit(30, 110, { kicks: [0, 8, 10], snares: [4, 12], hats: [2, 6, 10, 14] })
    addBusyMids(track.samples, 110)
    const alone = (groove: number) => play({ samples: track.samples, kicks: [] }, 0.5, { groove }, 'hat').hits
    const tracker = new DrumTracker(RATE)
    const readers = [{ groove: 0, cursor: new DrumCursor(), hits: [] as Array<{ at: number; response: number }> }, { groove: 1, cursor: new DrumCursor(), hits: [] as Array<{ at: number; response: number }> }]
    const rand = noise(3)
    let fed = 0
    let frame = 0
    while (fed < track.samples.length) {
      frame++
      const end = Math.min(track.samples.length, fed + (frame % 97 === 0 ? 2400 : Math.round(800 + 120 * rand())))
      tracker.feed(track.samples.subarray(fed, end), 0, (end - 1) / RATE)
      fed = end
      const heard = end / RATE - 5
      if (heard <= 0) continue
      for (const reader of readers) {
        const response = tracker.hitBetween('hat', reader.cursor, heard, 0.5, reader.groove)
        if (response > 0) reader.hits.push({ at: heard, response })
      }
    }
    expect(readers[0].hits).toEqual(alone(0))
    expect(readers[1].hits).toEqual(alone(1))
    expect(readers[1].hits).not.toEqual(readers[0].hits)
  }, 60_000)
})

describe('DrumCursor', () => {
  it('finds the hits of a new tracker at once after reading an older one, as a reader kept across a restart does', () => {
    const track = house(60, 124)
    const cursor = new DrumCursor()
    // Each tracker is fed from LEAD before its first question, as the
    // analysis decodes the window either side of the listener on a restart.
    const LEAD = 6
    const read = (from: number, to: number) => {
      const tracker = new DrumTracker(RATE)
      const at = Math.max(0, Math.round((from - 5) * RATE))
      let fed = at
      const hits: number[] = []
      for (let heard = from; heard < to; heard += 1 / 60) {
        const end = Math.min(track.samples.length, Math.round((heard + LEAD) * RATE))
        if (end > fed) tracker.feed(track.samples.subarray(fed, end), 0, (end - 1) / RATE)
        fed = Math.max(fed, end)
        if (tracker.hitBetween('kick', cursor, heard, 0.5) > 0) hits.push(heard)
      }
      return hits
    }
    expect(read(0, 30).length).toBeGreaterThan(40)
    // A seek back: the second tracker's hops count from zero again.
    const after = read(10, 20)
    expect(after[0]).toBeLessThan(11.5)
  })
})

/**
 * A club track's arrangement at `bpm`, one section per run of beats: the
 * groove (a kick on every beat, an off-beat bass and hat, a clap on two and
 * four), a RISER (a noise sweep and nothing else), kick ROLLS on every eighth
 * and then every sixteenth under the sweep, and a BREAKDOWN of a held chord
 * and no drums. Every hit is placed up to `jitterSec` either way of its beat.
 */
type Section = 'groove' | 'riser' | 'roll8' | 'roll16' | 'breakdown'
function arrangement(seconds: number, bpm: number, sectionAt: (beat: number) => Section, jitterSec: number): { samples: Float32Array; beats: number[] } {
  const out = new Float32Array(Math.round(seconds * RATE))
  const rand = noise(7)
  const jitter = noise(13)
  const beat = 60 / bpm
  const beats: number[] = []
  for (let b = 0; b * beat < seconds; b++) {
    const t0 = b * beat
    beats.push(t0)
    const section = sectionAt(b)
    const at = t0 + jitterSec * jitter()
    if (section === 'groove') {
      addKick(out, at, 1, rand)
      addNoise(out, at + beat / 2, 0.15, 0.03, rand)
      if (b % 2 === 1) addNoise(out, at, 0.3, 0.04, rand)
      for (let i = 0; i < beat * 0.5 * RATE; i++) {
        const k = Math.round((at + beat / 2) * RATE) + i
        if (k >= out.length) break
        const t = i / RATE
        out[k] += 0.45 * Math.min(1, t / 0.06) * Math.sin(2 * Math.PI * 55 * t)
      }
    }
    if (section === 'roll8' || section === 'roll16') {
      const strokes = section === 'roll8' ? 2 : 4
      for (let s = 0; s < strokes; s++) {
        addKick(out, at + (s * beat) / strokes, 0.7, rand)
        addNoise(out, at + (s * beat) / strokes, 0.3, 0.04, rand)
      }
    }
    for (let i = 0; i < beat * RATE; i++) {
      const k = Math.round(t0 * RATE) + i
      if (k >= out.length) break
      if (section === 'riser' || section === 'roll8' || section === 'roll16') out[k] += 0.1 * rand()
      if (section === 'breakdown') out[k] += 0.2 * Math.sin((2 * Math.PI * 220 * k) / RATE)
    }
  }
  return { samples: out, beats }
}

describe('DrumTracker grid through an arrangement', () => {
  it('keeps the beat of the groove through a riser, kick rolls and a breakdown, and finds it again at the drop', () => {
    // 96 beats of groove, 32 of riser, 16 of eighth and 16 of sixteenth
    // rolls, 64 of breakdown, then the drop. A grid read from the riser or the
    // breakdown's chord (whose rises, normalised to peaks that have faded,
    // are as periodic as kicks) took 135 to 181 BPM, and one read from a roll
    // moved by up to a quarter beat; each dragged the caret's clock with it.
    const bpm = 128
    const seconds = 150
    const section = (b: number): Section => {
      const m = b % 256
      return m < 96 ? 'groove' : m < 128 ? 'riser' : m < 144 ? 'roll8' : m < 160 ? 'roll16' : m < 224 ? 'breakdown' : 'groove'
    }
    const track = arrangement(seconds, bpm, section, 0.002)
    const tracker = new DrumTracker(RATE)
    const LEAD = 6
    let fed = 0
    const misses: string[] = []
    let lockedAfterDrop = false
    const drop = 224 * (60 / bpm)
    for (let heard = 0; heard < seconds - LEAD; heard += 0.25) {
      const end = Math.min(track.samples.length, Math.round((heard + LEAD) * RATE))
      tracker.feed(track.samples.subarray(fed, end), 0, (end - 1) / RATE)
      fed = end
      const period = tracker.gridPeriodSec
      if (Number.isNaN(period)) continue
      if (heard > drop + 2) lockedAfterDrop = true
      // The tempo to an octave, and the grid's beat nearest the true beat
      // nearest the listener (the onset peak trails a kick's first sample by
      // up to 20ms).
      const octaves = Math.log2((60 / period) / bpm)
      const beatAt = track.beats.reduce((a, b) => (Math.abs(b - heard) < Math.abs(a - heard) ? b : a))
      const steps = (beatAt - tracker.gridBeatTime) / period
      const offset = (Math.round(steps) - steps) * period
      if (Math.abs(octaves - Math.round(octaves)) > 0.01 || offset < -0.01 || offset > 0.03) {
        misses.push(`${heard.toFixed(2)}s: ${(60 / period).toFixed(1)} BPM, ${(offset * 1000).toFixed(0)}ms`)
      }
    }
    expect(misses).toEqual([])
    expect(lockedAfterDrop).toBe(true)
  })
})

/** A counter hit the fixed snare recipe (`VOICES.snare`) does not describe. */
type CounterSound = 'clap' | 'rim' | 'stab' | 'lofi' | 'bright' | 'snare'

/**
 * Plays one counter hit of `kind` at `t0` into `out`, `gain` its loudness:
 * - CLAP: three bursts of noise 10ms apart and a short tail, all between 1 and 3kHz.
 * - RIM: a short tonal click, two partials at 520Hz and 830Hz ringing 12ms, with a 2ms tick.
 * - STAB: a synth chord (E4, G#4, B4 sawtooths to 2.5kHz), 2ms attack, 100ms decay.
 * - LOFI: a snare lowpassed under 1.2kHz: its 190Hz body and noise through four poles at 1kHz.
 * - BRIGHT: a snare of noise above 6kHz only, decaying over 80ms.
 * - SNARE: the kit's own snare (`addSnare`), which the recipe describes.
 */
function counterVoice(kind: CounterSound, seed: number): (out: Float32Array, t0: number, gain: number) => void {
  const rand = noise(seed)
  const band = darkNoise(3000, brightNoise(1000, 2, noise(seed + 1)))
  const low = darkNoise(1000, darkNoise(1000, noise(seed + 2)))
  const high = brightNoise(6000, 3, noise(seed + 3))
  const snareNoise = brightNoise(1000, 2, noise(seed + 4))
  return (out, t0, gain) => {
    if (kind === 'snare') {
      addSnare(out, t0, gain, snareNoise)
      return
    }
    const length = kind === 'stab' ? 0.3 : 0.4
    for (let i = 0; i < length * RATE; i++) {
      const at = Math.round(t0 * RATE) + i
      if (at >= out.length) break
      const t = i / RATE
      let s = 0
      if (kind === 'clap') {
        let bursts = 0
        for (let b = 0; b < 3; b++) if (t >= 0.01 * b) bursts += Math.exp(-(t - 0.01 * b) / 0.004)
        s = 1.6 * band() * (bursts + 0.5 * Math.exp(-t / 0.06))
      } else if (kind === 'rim') {
        s = 0.7 * (Math.sin(2 * Math.PI * 520 * t) + 0.6 * Math.sin(2 * Math.PI * 830 * t)) * Math.exp(-t / 0.012) + 0.3 * rand() * Math.exp(-t / 0.002)
      } else if (kind === 'stab') {
        for (const f of [330, 415, 494]) for (let h = 1; f * h < 2500; h++) s += Math.sin(2 * Math.PI * f * h * t) / h
        s *= 0.12 * Math.min(1, t / 0.002) * Math.exp(-t / 0.1)
      } else if (kind === 'lofi') {
        s = 0.5 * Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t / 0.08) + 3 * low() * Math.exp(-t / 0.1)
      } else {
        s = 0.9 * high() * Math.exp(-t / 0.08)
      }
      out[at] += gain * s
    }
  }
}

interface CounterKit {
  kicks: number[]
  /** Sixteenths of the counter hit, at full strength. */
  counter: number[]
  /** Sixteenths of GHOST counter hits, a quarter of the strength (not scored as the counter). */
  ghosts?: number[]
  hats: number[]
  busy?: boolean
  /** A reese bass (two detuned sawtooths, 41 and 43Hz, held) instead of the off-beat bass line. */
  reese?: boolean
  sound: (bar: number) => CounterSound
  gain?: (bar: number, s: number) => number
  /** Extra hits of the counter's sound per bar, off its pattern (a fill, a roll), scored as snares, at `fillGain` (0.8). */
  fill?: (bar: number) => number[]
  fillGain?: number
  /** Sixteenths a sawtooth bass note (55Hz, filtered under 400Hz, a 5ms attack, held an eighth) starts on, besides the bass line: not snares. */
  saw?: number[]
  /** Extra kicks and (loud) hats per bar, off the pattern: not snares. */
  extraKicks?: (bar: number) => number[]
  extraHats?: (bar: number) => number[]
}

/** A kit whose counter is a `sound` hit, over a bass line, hats and kicks, with strummed guitars and a voice when `busy`. */
function counterKit(seconds: number, bpm: number, options: CounterKit) {
  const out = new Float32Array(Math.round(seconds * RATE))
  const rand = noise(9)
  const click = darkNoise(3000, noise(17))
  const hatNoise = brightNoise(7000, 3, noise(15))
  const voices = new Map<CounterSound, ReturnType<typeof counterVoice>>()
  const voiceOf = (kind: CounterSound) => {
    if (!voices.has(kind)) voices.set(kind, counterVoice(kind, 31 + voices.size * 7))
    return voices.get(kind)!
  }
  const sixteenth = 60 / bpm / 4
  const played = { kicks: [] as number[], snares: [] as number[], hats: [] as number[], ghosts: [] as number[] }
  const sorted = (times: number[]) => [...times].sort((a, b) => a - b)
  for (let bar = 0; bar * 16 * sixteenth < seconds; bar++) {
    const at = (s: number) => (bar * 16 + s) * sixteenth
    for (const s of [...options.kicks, ...(options.extraKicks?.(bar) ?? [])]) { addMixedKick(out, at(s), click); played.kicks.push(at(s)) }
    for (const s of options.fill?.(bar) ?? []) { voiceOf(options.sound(bar))(out, at(s), options.fillGain ?? 0.8); played.snares.push(at(s)) }
    for (const s of options.extraHats?.(bar) ?? []) { addHat(out, at(s), 0.5, hatNoise); played.hats.push(at(s)) }
    for (const s of options.counter) { voiceOf(options.sound(bar))(out, at(s), options.gain?.(bar, s) ?? 1); played.snares.push(at(s)) }
    for (const s of options.ghosts ?? []) { voiceOf(options.sound(bar))(out, at(s), 0.25); played.ghosts.push(at(s)) }
    for (const s of options.hats) { addHat(out, at(s), 0.35 + 0.1 * rand(), hatNoise); played.hats.push(at(s)) }
    for (const s of options.saw ?? []) {
      const t0 = at(s)
      for (let i = 0; i < 2 * sixteenth * RATE; i++) {
        const k = Math.round(t0 * RATE) + i
        if (k >= out.length) break
        const t = i / RATE
        let saw = 0
        for (let h = 1; 55 * h < 400; h++) saw += Math.sin(2 * Math.PI * 55 * h * t) / h
        out[k] += 0.4 * Math.min(1, t / 0.005) * saw
      }
    }
    if (!options.reese) {
      for (let beat = 0; beat < 4; beat++) {
        const t0 = at(beat * 4 + 2)
        for (let i = 0; i < 2 * sixteenth * RATE; i++) {
          const k = Math.round(t0 * RATE) + i
          if (k >= out.length) break
          const t = i / RATE
          out[k] += 0.35 * Math.min(1, t / 0.04) * Math.sin(2 * Math.PI * 49 * t)
        }
      }
    }
  }
  if (options.reese) {
    // Held through each bar, a new note every bar, swelling in over 50ms.
    const notes = [41, 49, 37, 44]
    const barSamples = 16 * sixteenth * RATE
    for (let i = 0; i < out.length; i++) {
      const bar = Math.floor(i / barSamples)
      const f = notes[bar % notes.length]
      const t = (i - bar * barSamples) / RATE
      const saw = (hz: number) => 2 * ((hz * t) % 1) - 1
      out[i] += 0.25 * Math.min(1, t / 0.05) * (saw(f) + saw(f * 1.04))
    }
  }
  if (options.busy) addBusyMids(out, bpm)
  const within = (times: number[]) => times.filter((t) => t < seconds)
  return { samples: out, kicks: sorted(within(played.kicks)), snares: sorted(within(played.snares)), hats: sorted(within(played.hats)), ghosts: within(played.ghosts) }
}

/** The snare's share of `times` drawing a hit above 0.3 and the strays, as `scoreDrum`, plus the response at each of `times`. */
function counterScore(track: ReturnType<typeof counterKit>, options: PlayOptions = {}, from = 10, to = 34) {
  const { hits, tracker } = play({ samples: track.samples, kicks: track.snares }, 0.5, options, 'snare')
  const all = [...track.snares, ...track.ghosts]
  const due = track.snares.filter((t) => t > from && t < to)
  const found = due.filter((t) => (hitFor(t, hits)?.response ?? 0) > 0.3).length / due.length
  const full = due.filter((t) => (hitFor(t, hits)?.response ?? 0) > 0.95).length / due.length
  const strays = hits.filter((h) => h.at > from && h.at < to && h.response > 0.3 && !all.some((t) => h.at >= t - EARLY_SEC && h.at <= t + LATE_SEC))
  return { found, full, strays, hits, tracker }
}

/** Logs a counter test's numbers when MEASURE is set, for the record of what each case measured. */
function report(name: string, result: { found: number; full: number; strays: unknown[]; tracker: DrumTracker }): void {
  if (process.env.MEASURE) console.log(`MEASURE ${name}: found ${result.found.toFixed(2)} full ${result.full.toFixed(2)} strays ${result.strays.length} grid ${result.tracker.tempoBpm.toFixed(1)} cycle ${result.tracker.counterCycleBeats}`)
}

/** The media times (in steps of 800 samples) at which a tracker fed `samples`, with the snare followed, holds a counter. */
function learnedAt(samples: Float32Array): number[] {
  const tracker = new DrumTracker(RATE)
  const cursor = new DrumCursor()
  const learned: number[] = []
  for (let fed = 0; fed < samples.length; fed += 800) {
    const end = Math.min(samples.length, fed + 800)
    tracker.feed(samples.subarray(fed, end), 0, (end - 1) / RATE)
    tracker.hitBetween('snare', cursor, end / RATE - 5, 0.5)
    if (tracker.counterCycleBeats > 0) learned.push(end / RATE)
  }
  return learned
}

const EIGHTHS = [0, 2, 4, 6, 8, 10, 12, 14]
const SIXTEENTHS = [...Array(16).keys()]

describe('DrumTracker on counter hits the snare recipe does not describe', () => {
  it.each([
    ['clap', false], ['clap', true], ['rim', false], ['rim', true], ['stab', false], ['stab', true],
    ['lofi', false], ['lofi', true], ['bright', false], ['bright', true],
  ] as Array<[CounterSound, boolean]>)('finds every %s on 2 and 4 (busy mids: %s), at full strength and nowhere else', (kind, busy) => {
    const track = counterKit(40, 110, { kicks: [0, 8, 10], counter: [4, 12], hats: EIGHTHS, busy, sound: () => kind })
    const result = counterScore(track)
    report(`${kind}${busy ? ' busy' : ''}`, result)
    expect(result.found).toBeGreaterThanOrEqual(0.95)
    expect(result.full).toBeGreaterThanOrEqual(0.9)
    // A stab is a chord in the voice's own band, and two of the voice's
    // sharpest syllables (of some sixty) read as one: the one case here the
    // sound alone cannot settle.
    expect(result.strays.length).toBeLessThanOrEqual(kind === 'stab' && busy ? 2 : 0)
  }, 60_000)

  it.each([170, 172, 175])('finds the snare of a drum and bass two-step at %s, at whichever octave the grid reads it', (bpm) => {
    for (const [name, kicks] of [['two-step', [0, 10]], ['with a ghost kick', [0, 9, 10]]] as Array<[string, number[]]>) {
      for (const kind of ['snare', 'clap'] as CounterSound[]) {
        const track = counterKit(40, bpm, { kicks, counter: [4, 12], hats: EIGHTHS, sound: () => kind })
        const result = counterScore(track)
        report(`dnb ${bpm} ${name} ${kind}`, result)
        expect(result.found, `${name} ${kind}`).toBeGreaterThanOrEqual(0.95)
        expect(result.full, `${name} ${kind}`).toBeGreaterThanOrEqual(0.9)
        expect(result.strays.map((h) => h.at.toFixed(2)), `${name} ${kind}`).toEqual([])
      }
    }
  }, 120_000)

  it('finds the snare of a busy break over a reese bass, ghost notes weaker than the backbeat', () => {
    const track = counterKit(40, 172, { kicks: [0, 2, 10, 11], counter: [4, 12], ghosts: [7, 9, 15], hats: SIXTEENTHS, reese: true, sound: () => 'snare' })
    const result = counterScore(track)
    report('amen over reese', result)
    expect(result.found).toBeGreaterThanOrEqual(0.95)
    expect(result.full).toBeGreaterThanOrEqual(0.9)
    expect(result.strays.map((h) => h.at.toFixed(2))).toEqual([])
    const ghosts = track.ghosts.filter((t) => t > 10 && t < 34).map((t) => hitFor(t, result.hits)?.response ?? 0)
    expect(Math.max(...ghosts)).toBeLessThan(0.95)
  }, 60_000)

  it('finds a half-time counter on 3 alone', () => {
    const track = counterKit(40, 140, { kicks: [0, 10], counter: [8], hats: EIGHTHS, busy: true, sound: () => 'clap' })
    const result = counterScore(track)
    report('half time', result)
    expect(result.found).toBeGreaterThanOrEqual(0.95)
    expect(result.strays.map((h) => h.at.toFixed(2))).toEqual([])
  }, 60_000)

  it('learns the clap of house on two and four, and shows no kick alone as a full snare', () => {
    // The clap lands WITH a kick, so both sides of the backbeat carry one:
    // what tells the clap's beats from the others is only what it adds
    // above the kick, and with it removed there is nothing to learn.
    const bpm = 128
    const beat = 60 / bpm
    const { hits, tracker } = play(house(30, bpm), 0.5, {}, 'snare')
    expect(tracker.counterCycleBeats).toBe(2)
    const claps = [...Array(Math.floor(30 / beat)).keys()].filter((b) => b % 2 === 1).map((b) => b * beat).filter((t) => t > 10 && t < 25)
    expect(claps.filter((t) => (hitFor(t, hits)?.response ?? 0) > 0.95).length / claps.length).toBeGreaterThanOrEqual(0.95)
    const full = hits.filter((h) => h.at > 10 && h.at < 25 && h.response > 0.95)
    expect(full.filter((h) => !claps.some((t) => h.at >= t - EARLY_SEC && h.at <= t + LATE_SEC)).map((h) => h.at.toFixed(2))).toEqual([])
    expect(learnedAt(house(30, bpm, Infinity, Infinity, () => 1, false).samples)).toEqual([])
  }, 60_000)

  it.each([['hats on the off-beat of 2 and 4', { kicks: [0, 8, 10], counter: [], hats: [6, 14] }], ['a sawtooth bass on 2 and 4', { kicks: [0, 8, 10], counter: [], hats: EIGHTHS, saw: [4, 12] }]] as Array<[string, Omit<CounterKit, 'sound'>]>)('never learns %s as the counter', (_, kit) => {
    // Each recurs against the kick on a backbeat's cycle, but neither has a
    // climb in the body of the spectrum (400Hz up, below the hats' bands)
    // that a hit punching against the kick has.
    for (const busy of [false, true]) {
      const track = counterKit(40, 110, { ...kit, busy, sound: () => 'clap' })
      expect(learnedAt(track.samples), `busy ${busy}`).toEqual([])
    }
  }, 60_000)

  it.each([['sixteenths', SIXTEENTHS], ['eighths', EIGHTHS]])('keeps a steady counter through a whole track whose grid reads a hair off its tempo (hats in %s)', (name, hats) => {
    // At 95 BPM the grid reads 95 to 96.4 from one window to the next, and a
    // window's positions extrapolated from one phase across ten seconds land
    // further off the hits than a snap at the window's far end.
    const track = counterKit(70, 95, { kicks: [0, 7, 10], counter: [4, 12], ghosts: [2, 14], hats, sound: () => 'rim' })
    const learned = learnedAt(track.samples)
    expect(learned[0]).toBeLessThan(10)
    // Learned from its first window to the end, without a gap.
    const gaps = learned.slice(1).filter((t, i) => t - learned[i] > 0.1).map((t) => t.toFixed(1))
    expect(gaps).toEqual([])
    expect(learned[learned.length - 1]).toBeGreaterThan(69)
    const result = counterScore(track, {}, 10, 65)
    report(`95 rim ${name}`, result)
    expect(result.found).toBeGreaterThanOrEqual(0.95)
  }, 120_000)

  it('never learns a counter in four on the floor with nothing between the kicks', () => {
    // What the snare shows here is the recipe's alone, as before the counter
    // existed (it takes this kit's kicks for snares: its click reaches the
    // snare's noise bands); the counter adds nothing to it.
    for (const busy of [false, true]) {
      const track = counterKit(40, 126, { kicks: [0, 4, 8, 12], counter: [], hats: [2, 6, 10, 14], busy, sound: () => 'clap' })
      const tracker = new DrumTracker(RATE)
      const cursor = new DrumCursor()
      const learned: number[] = []
      for (let fed = 0; fed < track.samples.length; fed += 800) {
        const end = Math.min(track.samples.length, fed + 800)
        tracker.feed(track.samples.subarray(fed, end), 0, (end - 1) / RATE)
        tracker.hitBetween('snare', cursor, end / RATE - 5, 0.5)
        if (tracker.counterCycleBeats > 0) learned.push(end / RATE)
      }
      expect(learned.slice(0, 3).map((t) => t.toFixed(2)), `busy ${busy}`).toEqual([])
    }
  }, 60_000)

  it('finds the counter of a slow syncopated groove the grid can read at either octave', () => {
    const track = counterKit(40, 79, { kicks: [0, 3, 6, 10, 11], counter: [4, 12], hats: EIGHTHS, busy: true, sound: () => 'lofi' })
    const result = counterScore(track)
    report('79 syncopated', result)
    expect(result.found).toBeGreaterThanOrEqual(0.95)
    // One kick of the pair on 10 and 11 whose click a strum lifted to the
    // counter's typical hit (of some thirty kicks off the pattern).
    expect(result.strays.length).toBeLessThanOrEqual(1)
  }, 60_000)

  it('follows the counter from one sound to another at a change of section', () => {
    const bpm = 110
    const track = counterKit(40, bpm, { kicks: [0, 8, 10], counter: [4, 12], hats: EIGHTHS, busy: true, sound: (bar) => (bar < 10 ? 'clap' : 'rim') })
    const result = counterScore(track)
    report('section change', result)
    expect(result.found).toBeGreaterThanOrEqual(0.9)
    expect(result.strays.map((h) => h.at.toFixed(2))).toEqual([])
  }, 60_000)

  it('keeps the counter while the media time jitters and frames are lost', () => {
    const track = counterKit(40, 110, { kicks: [0, 8, 10], counter: [4, 12], hats: EIGHTHS, busy: true, sound: () => 'clap' })
    const result = counterScore(track, { stampJitterSec: 0.01, loseEvery: 41 })
    report('jitter and loss', result)
    expect(result.found).toBeGreaterThanOrEqual(0.8)
    expect(result.strays.map((h) => h.at.toFixed(2))).toEqual([])
  }, 60_000)

  it('keeps every counter at full strength after one far louder than the rest', () => {
    const track = counterKit(40, 110, { kicks: [0, 8, 10], counter: [4, 12], hats: EIGHTHS, busy: true, sound: () => 'clap', gain: (bar, s) => (bar === 8 && s === 4 ? 3 : 1) })
    const result = counterScore(track)
    report('loud outlier', result)
    expect(result.found).toBeGreaterThanOrEqual(0.95)
    expect(result.full).toBeGreaterThanOrEqual(0.9)
    expect(result.strays.map((h) => h.at.toFixed(2))).toEqual([])
  }, 60_000)

  it('finds the counter\'s sound off its pattern, in a fill and a roll, but never a kick or a hat there', () => {
    const track = counterKit(40, 110, {
      kicks: [0, 8, 10], counter: [4, 12], hats: EIGHTHS, busy: true, sound: () => 'clap',
      // A fill every fourth bar ending in a roll; in the bar after each, a kick and a loud hat where the fill's hits were.
      fill: (bar) => (bar % 4 === 3 ? [7, 13, 14, 15] : []),
      extraKicks: (bar) => (bar % 4 === 1 ? [7, 13, 14] : []),
      extraHats: (bar) => (bar % 4 === 1 ? [15] : []),
    })
    const result = counterScore(track)
    report('fill and roll', result)
    expect(result.found).toBeGreaterThanOrEqual(0.9)
    expect(result.strays.map((h) => h.at.toFixed(2))).toEqual([])
  }, 60_000)
})

