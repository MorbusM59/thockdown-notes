import { describe, expect, it } from 'vitest'
import { placeTooltip } from './tooltipPlacement'

const W = 800
const H = 600
const M = 4

function inside(p: { left: number; top: number }, w: number, h: number) {
  return p.left >= M && p.top >= M && p.left + w <= W - M && p.top + h <= H - M
}

describe('placeTooltip', () => {
  it('keeps the margin to every window edge wherever the anchor sits', () => {
    for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H], [W / 2, H / 2], [-50, -50], [W + 50, H + 50]]) {
      const anchor = { left: x - 5, right: x + 5, top: y - 5, bottom: y + 5 }
      expect(inside(placeTooltip(anchor, 240, 40, W, H, M), 240, 40)).toBe(true)
    }
  })

  it('sits centred above the anchor when there is room, below when there is not', () => {
    const mid = placeTooltip({ left: 390, right: 410, top: 300, bottom: 320 }, 100, 20, W, H, M)
    expect(mid).toEqual({ left: 350, top: 300 - 6 - 20 })
    const top = placeTooltip({ left: 390, right: 410, top: 5, bottom: 25 }, 100, 20, W, H, M)
    expect(top.top).toBe(25 + 6)
  })
})
