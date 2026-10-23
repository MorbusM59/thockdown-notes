import { describe, expect, it } from 'vitest'
import { KickTracker } from './kickTracker'

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
 * sidechained bass does), off-beat open hats, a clap on two and four, and a
 * kick-free breakdown between `breakFrom` and `breakTo`.
 */
function house(seconds: number, bpm: number, breakFrom = Infinity, breakTo = Infinity): Track {
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
      for (let i = 0; i < 0.3 * RATE; i++) {
        const at = Math.round(t0 * RATE) + i
        if (at >= n) break
        const t = i / RATE
        phase += (2 * Math.PI * (50 + 100 * Math.exp(-t / 0.03))) / RATE
        out[at] += 0.9 * Math.sin(phase) * Math.exp(-t / 0.12)
        // The beater's click: a few milliseconds of noise.
        out[at] += 0.25 * rand() * Math.exp(-t / 0.003)
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
    if (b % 2 === 1) {
      for (let i = 0; i < 0.12 * RATE; i++) {
        const at = Math.round(t0 * RATE) + i
        if (at < n) out[at] += 0.3 * rand() * Math.exp(-i / RATE / 0.04)
      }
    }
  }
  return { samples: out, kicks }
}

/**
 * Plays a track through the tracker the way `musicBeat.ts` does: fed in
 * display-frame chunks of uneven size (a 60Hz display with jitter and the odd
 * long frame), and asked at each frame for the hit heard `lagSec` behind the
 * feed. Returns every hit reported, with its media time and response.
 */
function play(track: Track, contrast: number, lagSec = 5): { hits: Array<{ at: number; response: number }>; tracker: KickTracker } {
  const tracker = new KickTracker(RATE)
  const rand = noise(3)
  const hits: Array<{ at: number; response: number }> = []
  let fed = 0
  let frame = 0
  while (fed < track.samples.length) {
    frame++
    const chunk = frame % 97 === 0 ? 2400 : Math.round(800 + 120 * rand())
    const end = Math.min(track.samples.length, fed + chunk)
    tracker.feed(track.samples.subarray(fed, end), 0, (end - 1) / RATE)
    fed = end
    const heard = end / RATE - lagSec
    if (heard <= 0) continue
    const response = tracker.hitBetween(heard, contrast)
    if (response > 0) hits.push({ at: heard, response })
  }
  return { hits, tracker }
}

/** The hit reported for a kick: the first frame at or after it, so up to a (long) frame late. */
const LATE_SEC = 0.06
/** How early a hit may be reported: the hop clock's resolution and the envelope's centre. */
const EARLY_SEC = 0.02

function hitFor(kick: number, hits: Array<{ at: number; response: number }>) {
  return hits.find((h) => h.at >= kick - EARLY_SEC && h.at <= kick + LATE_SEC)
}

describe('KickTracker', () => {
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
    const { hits } = play(track, 0.5, 5)
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
})
