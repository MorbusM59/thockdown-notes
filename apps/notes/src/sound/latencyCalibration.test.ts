import { describe, expect, it } from 'vitest'
import { BEAT_DELAY_MAX_MS, BEAT_DELAY_MIN_MS } from '../shared/beatSettings'
import { CALIBRATION_MIN_TAPS, CALIBRATION_PERIOD_SEC, delayForLag, estimateLag, judgeCalibration } from './latencyCalibration'

const P = CALIBRATION_PERIOD_SEC

/** Taps lagging their clicks by `lag`, on beats 4.., with a deterministic wobble. */
function taps(lag: number, count: number, wobble = 0.01): number[] {
  return Array.from({ length: count }, (_, i) => (4 + i) * P + lag + wobble * Math.sin(i * 2.399))
}

describe('estimateLag', () => {
  it('recovers the lag whichever beat each tap belongs to, including across the beat boundary', () => {
    for (const lag of [0.02, 0.25, 0.59, 0.005]) {
      const estimate = estimateLag(taps(lag, 16))!
      const error = Math.abs(((estimate.lagSec - lag + P / 2) % P + P) % P - P / 2)
      expect(error).toBeLessThan(0.006)
      expect(estimate.inliers).toBe(16)
    }
  })

  it('drops a stray tap rather than averaging it in', () => {
    const lags = taps(0.2, 15, 0.005)
    lags.push(20 * P + 0.45)
    const estimate = estimateLag(lags)!
    expect(estimate.inliers).toBe(15)
    expect(Math.abs(estimate.lagSec - 0.2)).toBeLessThan(0.004)
  })
})

describe('delayForLag', () => {
  it('is what the audio path adds beyond the reported latency, without the visual offset', () => {
    const latency = 0.21
    for (const setting of [0, 120, 333, 500]) {
      const lag = latency + setting / 1000
      expect(delayForLag(((lag % P) + P) % P, latency)).toBe(setting)
    }
  })

  it('stays inside the setting range', () => {
    for (let lag = 0; lag < P; lag += 0.013) {
      const value = delayForLag(lag, 0.05)
      expect(value).toBeGreaterThanOrEqual(BEAT_DELAY_MIN_MS)
      expect(value).toBeLessThanOrEqual(BEAT_DELAY_MAX_MS)
    }
  })
})

describe('judgeCalibration', () => {
  it('ends a steady run as soon as enough taps agree, and fails one that never settles', () => {
    expect(judgeCalibration(CALIBRATION_MIN_TAPS - 1, estimateLag(taps(0.1, CALIBRATION_MIN_TAPS - 1)), false)).toBe('continue')
    expect(judgeCalibration(CALIBRATION_MIN_TAPS, estimateLag(taps(0.1, CALIBRATION_MIN_TAPS)), false)).toBe('done')
    const scattered = taps(0.1, 32, 0.12)
    expect(judgeCalibration(32, estimateLag(scattered), false)).toBe('failed')
  })
})
