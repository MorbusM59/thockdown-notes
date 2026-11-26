import { afterEach, describe, expect, it, vi } from 'vitest'

describe('heardAtSec', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('maps a heard moment to the same page time whatever each report spent on the bridge', async () => {
    const { heardAtSec } = await import('./nativeClock')
    // The native clock runs 1000 s ahead of the page's; each report waits 0 to 50 ms on the bridge.
    const offset = 1000
    const delays = [0.04, 0.003, 0.05, 0.02, 0.001, 0.035, 0.012, 0.048]
    let pageNow = 10
    vi.spyOn(performance, 'now').mockImplementation(() => pageNow * 1000)
    const mapped: number[] = []
    for (let index = 0; index < 40; index += 1) {
      const sentSec = 10 + index * 0.1 + offset
      pageNow = sentSec - offset + delays[index % delays.length]
      // Heard 0.3 s after it was sent (the output's buffer and route).
      const heardSec = sentSec + 0.3
      mapped.push(heardAtSec({ heardNanos: heardSec * 1e9, sentNanos: sentSec * 1e9 }) - (heardSec - offset))
    }
    // Once the shortest delivery has been seen, every report maps within it of the truth, and they agree with each other.
    const settled = mapped.slice(delays.length)
    for (const error of settled) expect(Math.abs(error - 0.001)).toBeLessThan(1e-6)
  })
})
