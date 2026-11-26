import { describe, expect, it } from 'vitest'
import { swipeDirection } from './orbGestures'

describe('swipeDirection', () => {
  it('takes the dominant axis, y pointing down', () => {
    expect(swipeDirection(40, 10)).toBe('right')
    expect(swipeDirection(-40, 10)).toBe('left')
    expect(swipeDirection(5, 30)).toBe('down')
    expect(swipeDirection(5, -30)).toBe('up')
  })
  it('gives a diagonal tie to the horizontal', () => {
    expect(swipeDirection(-20, -20)).toBe('left')
  })
})
