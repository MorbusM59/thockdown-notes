import { describe, expect, it } from 'vitest'
import { glazeLayerShare } from './glaze'

describe('glazeLayerShare', () => {
  it('gives every stack all of the strength at the centre and ramps by depth at either end', () => {
    for (const position of [0, 0.3, 1]) expect(glazeLayerShare(position, 0)).toBe(1)
    expect(glazeLayerShare(0, -1)).toBe(0)
    expect(glazeLayerShare(1, -1)).toBe(1)
    expect(glazeLayerShare(0, 1)).toBe(1)
    expect(glazeLayerShare(1, 1)).toBe(0)
    expect(glazeLayerShare(0, -0.5)).toBeCloseTo(0.5)
  })
})
