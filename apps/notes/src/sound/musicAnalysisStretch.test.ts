import { describe, expect, it } from 'vitest'
import { stretchLevel } from './musicAnalysis'

describe('the levels stretch', () => {
  it('gives a window of near silence no response, however its noise moves', () => {
    // A hiss floor wandering a few dB around -85dBFS: before the silence
    // floor, its own percentiles stretched it into full responses.
    for (const level of [-90, -86, -84, -80, -75]) expect(stretchLevel(level, -88, -82)).toBe(0)
  })

  it('stretches an audible window over its own range', () => {
    expect(stretchLevel(-30, -40, -20)).toBeCloseTo(0.5)
    expect(stretchLevel(-20, -40, -20)).toBe(1)
    // A quiet but audible passage still reaches a full response.
    expect(stretchLevel(-55, -66, -55)).toBe(1)
  })

  it('measures a window that reaches from silence into the music from the silence floor', () => {
    expect(stretchLevel(-70, -95, -20)).toBe(0)
    expect(stretchLevel(-45, -95, -20)).toBeCloseTo(0.5)
  })
})
