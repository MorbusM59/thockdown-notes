import { describe, expect, it } from 'vitest'

import { THOCKQUEST } from './thockquest'

/**
 * THE ARITHMETIC THE RING EXISTS TO SATISFY, held to it.
 *
 * Six regions, thirty traits, every trait in two regions, ten traits per
 * region: 30 x 2 = 60 = 6 x 10. The hexagon makes all four true at once, but
 * only while the border groups stay five long and stay a partition -- and
 * both of those are hand-typed lists of ids. A typo that repeats one trait
 * and drops another keeps every count intact and quietly puts a trait in four
 * regions, which is exactly the kind of content error nobody notices from
 * inside a run.
 */
describe('the regions and the traits they breed', () => {
  const regions = THOCKQUEST.regions
  const traitIds = THOCKQUEST.traits.map((trait) => trait.id)

  it('is six regions of ten', () => {
    expect(regions).toHaveLength(6)
    for (const region of regions) {
      expect(region.traits).toHaveLength(10)
      // No region may list the same trait twice: its two borders are
      // different borders, and a repeat would mean one of them is not.
      expect(new Set(region.traits).size).toBe(10)
    }
  })

  it('puts every trait in exactly two regions, and nothing else anywhere', () => {
    const appearances = new Map<string, number>()
    for (const region of regions) {
      for (const id of region.traits) appearances.set(id, (appearances.get(id) ?? 0) + 1)
    }
    // Every trait content has, and no id content does not.
    expect([...appearances.keys()].sort()).toEqual([...traitIds].sort())
    for (const [id, count] of appearances) {
      expect(`${id}:${count}`).toBe(`${id}:2`)
    }
  })

  it('has every region share exactly five traits with each neighbour and none with the rest', () => {
    // THE RING ITSELF, asserted as a shape rather than as a list: each region
    // overlaps two others by a whole border and the remaining three by
    // nothing. That is what makes travel feel like moving along a grain, and
    // it is the property a careless edit breaks first.
    const overlaps = regions.map((region) => regions
      .filter((other) => other.id !== region.id)
      .map((other) => region.traits.filter((id) => other.traits.includes(id)).length)
      .sort((left, right) => right - left))
    for (const row of overlaps) {
      expect(row).toEqual([5, 5, 0, 0, 0])
    }
  })
})
