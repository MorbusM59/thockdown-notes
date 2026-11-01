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
  const got = shown.filter((t) => t >= from && t < to)
  const missed = want.filter((t) => !got.some((s) => Math.abs(s - t) <= tolerance))
  const extra = got.filter((s) => !want.some((t) => Math.abs(s - t) <= tolerance))
  return { want: want.length, missed: missed.length, extra: extra.length }
}

describe('the rolling beat map', () => {
  it('lands on every beat of a steady track, from a cold start mid-track', () => {
    const expected = beatsOf(0, 60, () => 0.5)
    const { shown } = play(render(expected, 60), 20)
    expect(match(expected, shown, 21, 55)).toMatchObject({ missed: 0, extra: 0 })
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
})
