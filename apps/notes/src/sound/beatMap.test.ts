import { describe, expect, it } from 'vitest'
import { BeatMap, COMMIT_SEC } from './beatMap'

const RATE = 48000

/** A kick (falling sine and click) at each of `times`, over `seconds`, with a quiet pad under it when `pad`. */
function render(times: number[], seconds: number, pad = 0): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE))
  let seed = 5
  for (const t0 of times) {
    let phase = 0
    for (let i = 0; i < 0.25 * RATE; i++) {
      const at = Math.round(t0 * RATE) + i
      if (at >= out.length) break
      const t = i / RATE
      phase += (2 * Math.PI * (50 + 100 * Math.exp(-t / 0.03))) / RATE
      seed = (seed * 16807) % 2147483647
      out[at] += 0.8 * Math.sin(phase) * Math.exp(-t / 0.1) + 0.2 * (seed / 2147483647 - 0.5) * Math.exp(-t / 0.003)
    }
  }
  if (pad > 0) for (let i = 0; i < out.length; i++) out[i] += pad * Math.sin((2 * Math.PI * 220 * i) / RATE)
  return out
}

/** Beat times from `from` with the period at each beat given by `period(t)`, until `to`. */
function beatsOf(from: number, to: number, period: (t: number) => number): number[] {
  const out: number[] = []
  for (let t = from; t < to; t += period(t)) out.push(t)
  return out
}

/**
 * Plays `samples` through a map the way the worker does: decoded chunk by
 * chunk up to MAP_AHEAD ahead of a listener moving at real time from `start`,
 * updated each 60Hz frame, and records the committed beats as the listener
 * passes them.
 */
function play(samples: Float32Array, start: number, ahead = 30) {
  const map = new BeatMap(RATE)
  const chunk = 1152
  let fed = Math.floor((Math.max(0, start - 5) * RATE) / chunk) * chunk
  const seconds = samples.length / RATE
  const shown: number[] = []
  let lastPrevious = NaN
  for (let listener = start; listener < seconds; listener += 1 / 60) {
    while (fed < samples.length && fed / RATE < listener + ahead) {
      map.feed(samples.subarray(fed, Math.min(samples.length, fed + chunk)), fed / RATE)
      fed += chunk
    }
    map.update(listener)
    const { previous } = map.beatsAround(listener)
    if (!Number.isNaN(previous) && previous !== lastPrevious) shown.push(previous)
    lastPrevious = previous
  }
  return { map, shown }
}

/** For each expected beat in [from, to): the nearest shown beat's error; and shown beats in that span with no expected beat near. */
function match(expected: number[], shown: number[], from: number, to: number, tolerance = 0.03) {
  const want = expected.filter((t) => t >= from && t < to)
  // Shown beats a tolerance either side of the span's edges, so a beat smoothed a millisecond over an edge is neither missed nor extra.
  const got = shown.filter((t) => t >= from - tolerance && t < to - tolerance)
  const missed = want.filter((t) => !got.some((s) => Math.abs(s - t) <= tolerance))
  const extra = got.filter((s) => !want.some((t) => Math.abs(s - t) <= tolerance))
  return { want: want.length, missed: missed.length, extra: extra.length }
}

describe('the rolling beat map', () => {
  it('keeps its beats while the look-ahead ends in a break, and resumes right after the break', () => {
    // Kicks, then fifteen seconds with no pulse, then kicks again: while the frontier lies in the break, the beats
    // before it are still beats; once the kicks return, so do the beats.
    const expected = [...beatsOf(0, 40, () => 0.5), ...beatsOf(55, 100, () => 0.5)]
    const { shown } = play(render(expected, 100), 0)
    expect(match(expected, shown, 5, 38)).toMatchObject({ missed: 0, extra: 0 })
    expect(match(expected, shown, 60, 95)).toMatchObject({ missed: 0, extra: 0 })
  })

  it('lands on every beat of a steady track, from a cold start mid-track', () => {
    const expected = beatsOf(0, 60, () => 0.5)
    const { shown } = play(render(expected, 60), 20)
    expect(match(expected, shown, 21, 55)).toMatchObject({ missed: 0, extra: 0 })
  })

  it('keeps the caret on the kicks of a hat-heavy track at 90 to 110 BPM', () => {
    for (const bpm of [90, 100, 110]) {
      const beat = 60 / bpm
      const kicks = render(beatsOf(0, 60, () => beat), 60)
      const hats = render(beatsOf(beat / 2, 60, () => beat), 60)
      const samples = new Float32Array(kicks.length)
      for (let i = 0; i < samples.length; i++) samples[i] = kicks[i] + 0.6 * hats[i]
      const { map } = play(samples.subarray(0, 50 * RATE), 20)
      for (const t of [36.1, 41.3, 47.9]) {
        const { phase, period } = map.caretAt(t)
        expect(period, `${bpm} BPM`).toBeCloseTo(beat, 1)
        const start = t - phase * period
        const off = Math.abs(start / beat - Math.round(start / beat)) * beat
        expect(off, `${bpm} BPM at ${t}`).toBeLessThan(0.04)
      }
    }
  })

  it('follows a ritardando beat by beat', () => {
    // 128 BPM easing to 100 BPM over twenty seconds.
    const period = (t: number) => 60 / (128 - 28 * Math.min(1, Math.max(0, (t - 15) / 20)))
    const expected = beatsOf(0, 55, period)
    const { shown } = play(render(expected, 55), 5)
    expect(match(expected, shown, 8, 50)).toMatchObject({ missed: 0, extra: 0 })
  })

  it('follows an accelerando beat by beat', () => {
    const period = (t: number) => 60 / (96 + 30 * Math.min(1, Math.max(0, (t - 15) / 20)))
    const expected = beatsOf(0, 55, period)
    const { shown } = play(render(expected, 55), 5)
    expect(match(expected, shown, 8, 50)).toMatchObject({ missed: 0, extra: 0 })
  })

  it('glides across a silence between two tempos and lands on the first beat after it', () => {
    // 120 BPM to 22s, six seconds of silence, then 126 BPM from 28s.
    const first = beatsOf(0, 22, () => 0.5)
    const second = beatsOf(28, 60, () => 60 / 126)
    const { shown } = play(render([...first, ...second], 60), 5)
    expect(match(first, shown, 8, 21.6)).toMatchObject({ missed: 0, extra: 0 })
    expect(match(second, shown, 28, 55)).toMatchObject({ missed: 0, extra: 0 })
    // Through the silence there is still a beat: the caret is carried, not left blinking.
    expect(shown.filter((t) => t > 22.2 && t < 27.8).length).toBeGreaterThanOrEqual(8)
  })

  it('has no beat in a passage with no pulse', () => {
    // Kicks at random moments over a pad: events, but nothing repeating.
    let seed = 9
    const times: number[] = []
    for (let t = 0; t < 60; ) {
      seed = (seed * 16807) % 2147483647
      t += 0.3 + 2.2 * (seed / 2147483647)
      times.push(t)
    }
    const { shown } = play(render(times, 60, 0.05), 5)
    expect(shown.filter((t) => t > 15 && t < 50).length).toBeLessThan(5)
  })

  it('never moves a beat once it is committed', () => {
    const period = (t: number) => 60 / (128 - 28 * Math.min(1, Math.max(0, (t - 15) / 20)))
    const samples = render(beatsOf(0, 50, period), 50)
    const map = new BeatMap(RATE)
    const chunk = 1152
    let fed = 0
    const seen = new Map<number, number>()
    for (let listener = 0; listener < 45; listener += 1 / 60) {
      while (fed < samples.length && fed / RATE < listener + 30) {
        map.feed(samples.subarray(fed, fed + chunk), fed / RATE)
        fed += chunk
      }
      map.update(listener)
      const committed = map.beatsBetween(listener - 10, listener + COMMIT_SEC).filter((b) => b.committed)
      for (const b of committed) seen.set(Math.round(b.time * 1000), (seen.get(Math.round(b.time * 1000)) ?? 0) + 1)
    }
    // Every committed beat, once committed, is seen on every later frame until it ages out: no time is ever replaced.
    const times = [...seen.keys()].sort((a, b) => a - b)
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThan(300)
  })

  it('finds the beat again after a gap too long to carry, from the first beat after it', () => {
    // 120 BPM, then ninety seconds of silence, then 124 BPM.
    const first = beatsOf(0, 20, () => 0.5)
    const second = beatsOf(110, 140, () => 60 / 124)
    const { shown } = play(render([...first, ...second], 140), 5)
    expect(shown.filter((t) => t > 40 && t < 100).length).toBe(0)
    expect(match(second, shown, 110, 135)).toMatchObject({ missed: 0, extra: 0 })
  })

  // SUSPENDED (2026-11-02, Joe's call to try the bar tracker live): while the look-ahead ends inside the break, plans a
  // second apart alternate between two paths, and the beats committed just before the break (45-48s) drift up to 0.1s
  // off the beat. A real defect in the tracker, not in this test: un-skip when it is fixed (TODO.md).
  it.skip('puts the caret on the kick (one and three) of a breakbeat whose snare is louder, and holds it through a break', () => {
    const beat = 60 / 174
    const samples = dnb(120, beat, 50, 72)
    const map = new BeatMap(RATE)
    const chunk = 1152
    let fed = 0
    const onsets: number[] = []
    let lastPhase = NaN
    for (let listener = 2; listener < 115; listener += 1 / 60) {
      while (fed < samples.length && fed / RATE < listener + 30) {
        map.feed(samples.subarray(fed, fed + chunk), fed / RATE)
        fed += chunk
      }
      map.update(listener)
      const { phase } = map.caretAt(listener)
      // A caret beat begins where the phase wraps.
      if (phase < lastPhase) onsets.push(listener - phase * map.caretAt(listener).period)
      lastPhase = phase
    }
    const late = onsets.filter((t) => t > 8)
    expect(late.length).toBeGreaterThan(100)
    // Every caret beat on the bar's one or three (positions 0 and 2 of four), never on a snare.
    for (const t of late) {
      const position = ((Math.round(t / beat) % 4) + 4) % 4
      expect(position % 2).toBe(0)
      expect(Math.abs(t - Math.round(t / beat) * beat)).toBeLessThan(0.02)
    }
  })
})

/** Drum and bass at `beat` seconds a beat: kick on one and the and of three, a loud snare on two and four, eighth hats, a sub under it all, and no kick between `breakFrom` and `breakTo`. */
function dnb(seconds: number, beat: number, breakFrom: number, breakTo: number): Float32Array {
  const out = new Float32Array(seconds * RATE)
  let seed = 3
  const rnd = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647 - 0.5
  }
  const add = (t0: number, len: number, f: (t: number) => number) => {
    for (let i = 0; i < len * RATE; i++) {
      const at = Math.round(t0 * RATE) + i
      if (at >= out.length) break
      out[at] += f(i / RATE)
    }
  }
  const kick = (t0: number, gain: number) => {
    let phase = 0
    add(t0, 0.25, (t) => {
      phase += (2 * Math.PI * (50 + 90 * Math.exp(-t / 0.02))) / RATE
      return gain * Math.sin(phase) * Math.exp(-t / 0.1) + 0.2 * rnd() * Math.exp(-t / 0.003)
    })
  }
  for (let b = 0; b * beat < seconds; b++) {
    const t0 = b * beat
    const position = b % 4
    const inBreak = t0 >= breakFrom && t0 < breakTo
    if (!inBreak && position === 0) kick(t0, 0.8)
    if (!inBreak && position === 2) kick(t0 + beat / 2, 0.7)
    if (position === 1 || position === 3) add(t0, 0.2, (t) => (0.9 * rnd() + 0.4 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-t / 0.06))
    add(t0, 0.05, (t) => 0.15 * rnd() * Math.exp(-t / 0.01))
    add(t0 + beat / 2, 0.05, (t) => 0.1 * rnd() * Math.exp(-t / 0.01))
  }
  for (let i = 0; i < out.length; i++) out[i] += 0.2 * Math.sin((2 * Math.PI * 45 * i) / RATE)
  return out
}
