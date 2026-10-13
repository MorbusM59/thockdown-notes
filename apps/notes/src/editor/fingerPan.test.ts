import { describe, expect, it } from 'vitest'
import { beginFingerPan, moveFingerPan, releaseFingerPan } from './fingerPan'

const LINE = 20
const SLOP = 10

describe('a finger dragging the edit view', () => {
  it('scrolls nothing until the finger leaves the slop', () => {
    const pan = beginFingerPan(1, 500, 0)
    expect(moveFingerPan(pan, 492, 10, LINE, SLOP)).toBe(0)
    expect(pan.panning).toBe(false)
  })

  it('moves exactly one row for every row height the finger travels, and never a fraction', () => {
    const pan = beginFingerPan(1, 500, 0)
    let total = 0
    for (let y = 499; y >= 300; y -= 3) {
      const rows = moveFingerPan(pan, y, 500 - y, LINE, SLOP)
      expect(Number.isInteger(rows)).toBe(true)
      total += rows
      // The text stays under the finger to within one row.
      expect(Math.abs((500 - y) - total * LINE)).toBeLessThan(LINE)
    }
    expect(total).toBe(Math.trunc((500 - 302) / LINE))
  })

  it('scrolls back up when the finger moves down', () => {
    const pan = beginFingerPan(1, 100, 0)
    expect(moveFingerPan(pan, 145, 10, LINE, SLOP)).toBe(-2)
  })
})

describe('the coast after a lift', () => {
  const swipe = (gapMs: number) => {
    const pan = beginFingerPan(1, 500, 0)
    let t = 0
    for (let y = 500 - LINE; y >= 500 - LINE * 6; y -= LINE) {
      t += gapMs
      moveFingerPan(pan, y, t, LINE, SLOP)
    }
    return { pan, t }
  }

  it('coasts at the rate the finger set when it lifts mid-swipe', () => {
    const { pan, t } = swipe(8)
    expect(releaseFingerPan(pan, t + 2, 20)).toEqual({ direction: 1, averageGapMs: 8 })
  })

  it('does not coast a swipe slower than the spin threshold', () => {
    const { pan, t } = swipe(30)
    expect(releaseFingerPan(pan, t + 2, 20)).toBeNull()
  })

  it('does not coast a finger that stopped before it lifted', () => {
    const { pan, t } = swipe(8)
    expect(releaseFingerPan(pan, t + 200, 20)).toBeNull()
  })

  it('does not coast when coasting is off, or after a tap', () => {
    const { pan, t } = swipe(8)
    expect(releaseFingerPan(pan, t + 2, 0)).toBeNull()
    expect(releaseFingerPan(beginFingerPan(1, 0, 0), 5, 20)).toBeNull()
  })

  it('reads several rows in one event as crossed in turn, not all at once', () => {
    const pan = beginFingerPan(1, 500, 0)
    moveFingerPan(pan, 488, 4, LINE, SLOP)
    moveFingerPan(pan, 500 - LINE * 3, 16, LINE, SLOP)
    expect(releaseFingerPan(pan, 17, 20)?.averageGapMs).toBeCloseTo(4, 5)
  })
})
