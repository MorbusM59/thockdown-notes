/** Synthesized drum tracks for the signal map's tests: what was played, and where. */
import { SignalMap, SIGNAL_RATE as RATE, type BeatPort } from './signalMap'

export function noise(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 31 - 1
  }
}

export function brightNoise(hz: number, order: number, rand: () => number): () => number {
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

/** A kick: a pitch falling from `top` to `bottom` Hz, its click below 3kHz. */
function addKick(out: Float32Array, t0: number, gain: number, click: () => number, bottom = 50, top = 150, decay = 0.12): void {
  let phase = 0
  for (let i = 0; i < 0.3 * RATE; i++) {
    const at = Math.round(t0 * RATE) + i
    if (at >= out.length) break
    const t = i / RATE
    phase += (2 * Math.PI * (bottom + (top - bottom) * Math.exp(-t / 0.03))) / RATE
    out[at] += gain * (0.9 * Math.sin(phase) * Math.exp(-t / decay) + 0.3 * click() * Math.exp(-t / 0.004))
  }
}

function addSnare(out: Float32Array, t0: number, gain: number, bright: () => number): void {
  for (let i = 0; i < 0.5 * RATE; i++) {
    const at = Math.round(t0 * RATE) + i
    if (at >= out.length) break
    const t = i / RATE
    out[at] += gain * (0.5 * Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t / 0.08) + 0.6 * bright() * Math.exp(-t / 0.12))
  }
}

/** A clap: three bursts of noise 10ms apart and a 60ms tail, nothing tonal. */
function addClap(out: Float32Array, t0: number, gain: number, bright: () => number): void {
  for (let i = 0; i < 0.4 * RATE; i++) {
    const at = Math.round(t0 * RATE) + i
    if (at >= out.length) break
    const t = i / RATE
    const burst = t < 0.03 ? Math.exp(-(t % 0.01) / 0.003) : 0
    out[at] += gain * 0.8 * bright() * Math.max(burst, Math.exp(-(t - 0.02) / 0.06) * (t >= 0.02 ? 1 : 0))
  }
}

function addHat(out: Float32Array, t0: number, gain: number, bright: () => number): void {
  for (let i = 0; i < 0.15 * RATE; i++) {
    const at = Math.round(t0 * RATE) + i
    if (at < out.length) out[at] += gain * bright() * Math.exp(-i / RATE / 0.025)
  }
}

/** A bass note on every beat's second eighth, so the low band is never only kick. */
function addBass(out: Float32Array, t0: number, length: number): void {
  for (let i = 0; i < length * RATE; i++) {
    const k = Math.round(t0 * RATE) + i
    if (k >= out.length) break
    const t = i / RATE
    out[k] += 0.35 * Math.min(1, t / 0.04) * Math.sin(2 * Math.PI * 49 * t)
  }
}

export interface Played {
  samples: Float32Array
  kicks: number[]
  snares: number[]
  hats: number[]
  beats: number[]
}

export interface Section {
  from: number
  kicks: number[]
  snares: number[]
  hats: number[]
  /** The kick's sound in this section: [bottom, top, decay]. */
  kickSound?: [number, number, number]
  /** An 808: a long sub kick with no beater click. */
  eight08?: boolean
  /** Claps instead of snares: three noise bursts and a tail, no tonal body. */
  clap?: boolean
  /** How late the off-beat sixteenths fall, as a share of a sixteenth. */
  swing?: number
  /** Each hit's gain varies by up to this many dB either way. */
  velocityDb?: number
}

/** Sixteenth-grid sections over a bass line; returns what was played where. */
export function track(seconds: number, bpm: number, sections: Section[]): Played {
  const out = new Float32Array(Math.round(seconds * RATE))
  const rand = noise(9)
  const click = darkNoise(3000, noise(17))
  const snareNoise = brightNoise(1000, 2, noise(13))
  const hatNoise = brightNoise(7000, 3, noise(15))
  const clapNoise = brightNoise(900, 2, noise(21))
  const sixteenth = 60 / bpm / 4
  const played: Played = { samples: out, kicks: [], snares: [], hats: [], beats: [] }
  for (let bar = 0; bar * 16 * sixteenth < seconds; bar++) {
    const straight = (s: number) => (bar * 16 + s) * sixteenth
    const section = [...sections].reverse().find((s) => straight(0) >= s.from)!
    const at = (s: number) => straight(s) + (s % 2 === 1 ? (section.swing ?? 0) * sixteenth : 0)
    const gain = () => 10 ** ((section.velocityDb ?? 0) * rand() / 20)
    const [bottom, top, decay] = section.kickSound ?? [50, 150, 0.12]
    for (const s of section.kicks) {
      if (section.eight08) addKick(out, at(s), gain(), () => 0, 45, 90, 0.4)
      else addKick(out, at(s), gain(), click, bottom, top, decay)
      played.kicks.push(at(s))
    }
    for (const s of section.snares) {
      if (section.clap) addClap(out, at(s), gain(), clapNoise)
      else addSnare(out, at(s), gain(), snareNoise)
      played.snares.push(at(s))
    }
    for (const s of section.hats) { addHat(out, at(s), (0.35 + 0.1 * rand()) * gain(), hatNoise); played.hats.push(at(s)) }
    for (let beat = 0; beat < 4; beat++) { played.beats.push(at(beat * 4)); addBass(out, at(beat * 4 + 2), 2 * sixteenth) }
  }
  const within = (times: number[]) => times.filter((t) => t < seconds - 0.5)
  return { samples: out, kicks: within(played.kicks), snares: within(played.snares), hats: within(played.hats), beats: played.beats }
}

export function gridOf(beats: number[]): BeatPort {
  return { beatsBetween: (from, to) => beats.filter((t) => t >= from && t < to) }
}

/** Feeds the whole track in quarter-second chunks and analyses it with the listener at `heard`. */
export function mapOf(played: Played, heard = 0): SignalMap {
  const map = new SignalMap(gridOf(played.beats))
  const chunk = RATE / 4
  for (let i = 0; i < played.samples.length; i += chunk) map.feed(played.samples.subarray(i, i + chunk), i / RATE)
  map.analyse(heard)
  return map
}

