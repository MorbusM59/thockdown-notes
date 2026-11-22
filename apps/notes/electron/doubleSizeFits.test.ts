import { describe, expect, it } from 'vitest'
import { doubleSizeFits } from './doubleSizeFits'

describe('doubleSizeFits', () => {
  it('fits when both dimensions of the doubled minimum fit the space, edges included', () => {
    expect(doubleSizeFits({ width: 1600, height: 1000 }, { width: 1600, height: 1000 })).toBe(true)
    expect(doubleSizeFits({ width: 1600, height: 1000 }, { width: 2560, height: 1440 })).toBe(true)
  })
  it('does not fit a portrait screen too narrow for it, whatever its height', () => {
    expect(doubleSizeFits({ width: 1600, height: 1000 }, { width: 1080, height: 1920 })).toBe(false)
  })
  it('does not fit when only the height falls short', () => {
    expect(doubleSizeFits({ width: 1600, height: 1000 }, { width: 1920, height: 960 })).toBe(false)
  })
})
