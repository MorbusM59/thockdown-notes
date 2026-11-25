import { beforeEach, describe, expect, it, vi } from 'vitest'

type Signals = typeof import('./soundscapeSignals')
let signals: Signals

beforeEach(async () => {
  vi.resetModules()
  signals = await import('./soundscapeSignals')
})

const drip = (salience: number, amplitude = 0.05) => ({ at: 0, kind: 'drip' as const, amplitude, salience })

describe('soundscape signals', () => {
  it('lets a full track bury a hit that a quiet drone leaves standing', () => {
    const weights = { music: 1, soundscape: 1 }
    // Warm the history so the hit is read against hits like it.
    for (let index = 0; index < 8; index += 1) signals.soundscapeHitResponse(drip(2 + index), 0, weights, 1)
    const hit = drip(10)
    const alone = signals.soundscapeHitResponse(hit, 0, weights, 1)
    // Heard at 0.025 (the engine's mix gain of a half): a drone peaking at 0.02 is below it, a full track 32 dB above.
    const drone = signals.soundscapeHitResponse(hit, 0.02, weights, 1)
    const track = signals.soundscapeHitResponse(hit, 1, weights, 1)
    expect(alone).toBeGreaterThan(0)
    expect(drone).toBeCloseTo(alone, 6)
    expect(track).toBe(0)
  })

  it('masks by the heard ratio: full at the masker, nothing MASK_RANGE_DB below it', () => {
    expect(signals.maskingShare(1, 1)).toBe(1)
    expect(signals.maskingShare(1, 10 ** (signals.MASK_RANGE_DB / 40))).toBeCloseTo(0.5, 9)
    expect(signals.maskingShare(1, 10 ** (signals.MASK_RANGE_DB / 20))).toBeCloseTo(0, 9)
    expect(signals.maskingShare(0.1, 0)).toBe(1)
    expect(signals.maskingShare(0, 0)).toBe(0)
  })

  it('doubles the motion in a full gust and halves it in a full lull, by the soundscape\'s share, gliding there', () => {
    let gains = { music: 0, soundscape: 1 }
    signals.setSoundscapeSignalGains(() => gains)
    const gustFrom = (from: number, value: number) => {
      const list = Array.from({ length: 100 }, (_, index) => ({ at: from + index * 0.1, kind: 'gust' as const, value }))
      signals.receiveSoundscapeSignals(list, from, from)
    }
    gustFrom(0, 1)
    expect(signals.gustSpeed(0)).toBe(2) // the first read takes the target
    expect(signals.gustSpeed(4.99)).toBeCloseTo(2, 6)
    gustFrom(5, -1)
    expect(signals.gustSpeed(5.01)).toBeGreaterThan(1.9) // and glides from there
    expect(signals.gustSpeed(12)).toBeCloseTo(0.5, 2)
    // Music twice as loud as the soundscape: the gust counts for half.
    gains = { music: 1, soundscape: 0.5 }
    gustFrom(13, -1)
    expect(signals.gustSpeed(21)).toBeCloseTo(2 ** -0.5, 2)
    // Gone stale (nothing reported): the motion returns to its own pace.
    expect(signals.gustSpeed(30)).toBeCloseTo(1, 2)
  })
})
