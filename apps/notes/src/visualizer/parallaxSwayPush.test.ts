import { describe, expect, it } from 'vitest'
import { applySway, registerSwayLayer, setSwayMotion, setSwayRange, setSwayReturnFall, swaySnareHit } from './parallaxSway'

function offsetAt(nowMs: number): number {
  const element = { style: { transform: '' } } as unknown as HTMLElement
  const unregister = registerSwayLayer(element, 0, 1, { periodPx: 1e6, angleDeg: 90 })
  applySway(0, 0, nowMs)
  const px = Number(/translate3d\((-?[\d.]+)px/.exec(element.style.transform)?.[1])
  unregister()
  return px
}

describe('the glaze push and its return', () => {
  it('a full return comes back to rest even when hits land faster than the fall', () => {
    setSwayRange(0)
    setSwayMotion(10, 1, 0)
    setSwayReturnFall(0.5, 0)
    let t = 1000
    const start = offsetAt(t)
    // Fifty hits 100ms apart against a 500ms fall: never fully fallen between hits.
    for (let hit = 0; hit < 50; hit++, t += 100) swaySnareHit(t)
    expect(offsetAt(t - 100) - start).toBeLessThan(60)
    expect(offsetAt(t + 600)).toBeCloseTo(start, 6)
  })

  it('a return below 1 keeps the same share of every push, and a hit pushes in full', () => {
    setSwayMotion(10, 0.8, 0)
    let t = 10_000
    const start = offsetAt(t)
    swaySnareHit(t)
    expect(offsetAt(t) - start).toBeCloseTo(10, 6)
    for (let hit = 0; hit < 3; hit++) swaySnareHit((t += 100))
    expect(offsetAt(t + 600) - start).toBeCloseTo(4 * 2, 6)
  })
})

describe('a reverse push', () => {
  it('moves the other way and returns to rest the same', () => {
    setSwayMotion(-10, 1, 0)
    setSwayReturnFall(0.5, 0)
    const t = 50_000
    const start = offsetAt(t)
    swaySnareHit(t)
    expect(offsetAt(t) - start).toBeCloseTo(-10, 6)
    expect(offsetAt(t + 600)).toBeCloseTo(start, 6)
  })
})
