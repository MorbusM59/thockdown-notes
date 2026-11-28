import { describe, expect, it } from 'vitest'
import { instanceResponse, MIN_RANKED_INSTANCES } from './instanceResponse'

describe('instanceResponse with too few instances to rank', () => {
  it('answers nothing until enough instances are held, then ranks as usual', () => {
    // A lone faint onset right after a restart must not read as the channel's loudest.
    for (let n = 1; n < MIN_RANKED_INSTANCES; n++) {
      const strengths = Array.from({ length: n }, (_, i) => i * 0.1)
      expect(instanceResponse(strengths[n - 1], strengths, 0.5)).toBe(0)
    }
    const full = Array.from({ length: MIN_RANKED_INSTANCES }, (_, i) => i * 0.1)
    expect(instanceResponse(full[full.length - 1], full, 0.5)).toBe(1)
  })
})
