import { describe, expect, it } from 'vitest'
import { arrivalPose, fallPose, hasFallenOut } from './solidSwapMotion'

describe('solid swap motion', () => {
  it('the arrival starts out of view, overshoots its place once and settles there', () => {
    const edge = 1
    expect(arrivalPose(0, edge)?.offsetY).toBe(-edge)
    let lowest = 0
    let t = 0
    let pose = arrivalPose(t, edge)
    while (pose) {
      lowest = Math.max(lowest, pose.offsetY)
      t += 1 / 120
      pose = arrivalPose(t, edge)
      expect(t).toBeLessThan(3)
    }
    expect(lowest).toBeGreaterThan(0.05)
    expect(lowest).toBeLessThan(0.4)
    // Just before it reports settled it is already at its place.
    expect(Math.abs(arrivalPose(t - 1 / 120, edge)!.offsetY)).toBeLessThan(0.001)
  })

  it('the fall shrinks the solid and takes it out of view in under a second', () => {
    let t = 0
    let pose = fallPose(t, { offsetY: 0, scale: 1 })
    while (!hasFallenOut(pose, 1)) {
      t += 1 / 120
      pose = fallPose(t, { offsetY: 0, scale: 1 })
      expect(pose.scale).toBeLessThan(1)
    }
    expect(t).toBeLessThan(1)
  })
})
