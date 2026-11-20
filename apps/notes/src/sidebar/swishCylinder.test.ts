import { describe, expect, it } from 'vitest'
import { solidPointAt } from '../editor/EmptyStateScene'
import { SWISH_CYLINDER, CYLINDER_RADIUS } from './swishCylinder'

/** Where the marker face's centre (in front, (0, 0, -R), before any turn) is at `timeSec`. */
function markerAt(timeSec: number): { x: number; z: number } {
  const [x, , z] = solidPointAt(SWISH_CYLINDER, [0, 0, -CYLINDER_RADIUS], timeSec)
  return { x, z }
}

describe('the swish cylinder', () => {
  it('has the marker in front and centred at the swish apex, every second', () => {
    for (const t of [0.5, 1.5, 7.5]) {
      const { x, z } = markerAt(t)
      expect(x).toBeCloseTo(0, 9)
      expect(z).toBeCloseTo(-CYLINDER_RADIUS, 9)
    }
  })

  it('moves the marker left to right as it passes', () => {
    expect(markerAt(0.49).x).toBeLessThan(0)
    expect(markerAt(0.51).x).toBeGreaterThan(0)
  })

  it('carries one 60% face, 96 at 30% and two caps at 15%', () => {
    const counts = new Map<number, number>()
    for (const a of SWISH_CYLINDER.faceAlphas) counts.set(a, (counts.get(a) ?? 0) + 1)
    expect(counts.get(0.6)).toBe(1)
    expect(counts.get(0.3)).toBe(95)
    expect(counts.get(0.15)).toBe(2)
  })
})
