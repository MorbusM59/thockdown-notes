import { describe, expect, it } from 'vitest'
import { applySway, registerSwayLayer, setSwayMotion, setSwayRange, setSwaySnare, swaySnareHit } from './parallaxSway'

function offsetAfter(run: () => void): number {
  const element = { style: { transform: '' } } as unknown as HTMLElement
  const unregister = registerSwayLayer(element, 0, 1, { periodPx: 1e6, angleDeg: 90 })
  run()
  applySway(0, 0)
  const px = Number(/translate3d\((-?[\d.]+)px/.exec(element.style.transform)?.[1])
  unregister()
  return px
}

describe('the glaze push and its return', () => {
  it('a full return comes back to rest after every hit, whatever the response does on the way down', () => {
    setSwayRange(0)
    setSwayMotion(10, 1, 0)
    const start = offsetAfter(() => {})
    const end = offsetAfter(() => {
      for (let hit = 0; hit < 20; hit++) {
        swaySnareHit(0.4)
        // A hit peaking below 1 (the loudness gain), wobbling upwards as it falls.
        for (const r of [0.4, 0.6, 0.5, 0.55, 0.3, 0.35, 0.1, 0]) setSwaySnare(r)
      }
    })
    expect(end).toBeCloseTo(start, 6)
  })

  it('a return below 1 keeps the same share of every push, and a hit pushes in full', () => {
    setSwayRange(0)
    setSwayMotion(10, 0.8, 0)
    const start = offsetAfter(() => {})
    const peak = offsetAfter(() => {
      // The listener not told of the hit's response at all.
      swaySnareHit(0.6)
    })
    expect(peak - start).toBeCloseTo(10, 6)
    const rest = offsetAfter(() => {
      for (let hit = 0; hit < 4; hit++) {
        swaySnareHit(0.6)
        for (const r of [0.6, 0.65, 0.2, 0]) setSwaySnare(r)
      }
    })
    expect(rest - peak).toBeCloseTo(8, 6)
  })
})
