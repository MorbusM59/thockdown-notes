import { describe, expect, it } from 'vitest'
import { instanceResponse, MIN_RANKED_INSTANCES } from './instanceResponse'

describe('instanceResponse with too few instances to rank', () => {
  it('scales the top instance by the share of evidence held, reaching full once enough are held', () => {
    // A lone faint onset right after a restart shows faintly, never as the channel's loudest at full strength.
    let last = 0
    for (let n = 1; n < MIN_RANKED_INSTANCES; n++) {
      const strengths = Array.from({ length: n }, (_, i) => i * 0.1)
      const response = instanceResponse(strengths[n - 1], strengths, 0.5)
      expect(response).toBeCloseTo(n / MIN_RANKED_INSTANCES)
      expect(response).toBeGreaterThan(last)
      last = response
    }
    const full = Array.from({ length: MIN_RANKED_INSTANCES }, (_, i) => i * 0.1)
    expect(instanceResponse(full[full.length - 1], full, 0.5)).toBe(1)
  })
})
