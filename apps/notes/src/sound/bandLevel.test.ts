import { describe, expect, it } from 'vitest'
import { BandLevelMeter } from './bandLevel'

const RATE = 44100

function sine(frequencyHz: number, amplitude: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE))
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * frequencyHz * i) / RATE)
  return out
}

function lastReading(meter: BandLevelMeter, samples: Float32Array): { time: number; db: number; count: number } {
  let time = NaN
  let db = NaN
  let count = 0
  meter.process(samples, 10, (t, d) => {
    time = t
    db = d
    count++
  })
  return { time, db, count }
}

describe('BandLevelMeter', () => {
  it('passes the centre of its band at full level and reads its RMS', () => {
    const { db } = lastReading(new BandLevelMeter(RATE, 1000, 1), sine(1000, 0.5, 1))
    // A sine of amplitude 0.5 has an RMS of 0.5/sqrt(2): -9.03 dB, give or
    // take the part-period at the window's edge.
    expect(Math.abs(db - 20 * Math.log10(0.5 / Math.SQRT2))).toBeLessThan(0.15)
  })

  it('reads a tone well outside its band far quieter', () => {
    const inside = lastReading(new BandLevelMeter(RATE, 100, 1), sine(100, 0.5, 1)).db
    const outside = lastReading(new BandLevelMeter(RATE, 100, 1), sine(5000, 0.5, 1)).db
    expect(inside - outside).toBeGreaterThan(30)
  })

  it('reads a hundred times a second, stamped with the media time of its newest sample', () => {
    const { time, count } = lastReading(new BandLevelMeter(RATE, 1000, 1), sine(1000, 0.5, 1))
    expect(count).toBe(100)
    expect(time).toBeCloseTo(10 + 1 - 1 / RATE, 6)
  })

  it('reads the same whether its samples arrive whole or in pieces', () => {
    const signal = sine(250, 0.3, 0.5)
    const whole: number[] = []
    new BandLevelMeter(RATE, 250, 1).process(signal, 0, (_t, d) => whole.push(d))
    const pieces: number[] = []
    const meter = new BandLevelMeter(RATE, 250, 1)
    for (let at = 0; at < signal.length; at += 1152) {
      meter.process(signal.subarray(at, at + 1152), at / RATE, (_t, d) => pieces.push(d))
    }
    expect(pieces).toEqual(whole)
  })
})
