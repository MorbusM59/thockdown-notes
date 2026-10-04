import { describe, expect, it } from 'vitest'

import { catalogFor, rolledPool, THOCKQUEST } from '../content'
import { drawOmenTraits, omenHealAmount, omenPool, omenTraitCount } from './specialEvents'

const TRAITS = rolledPool(THOCKQUEST, 0, 'trait')
const CATALOG = catalogFor(THOCKQUEST, 0)
const regionOf = (id: string) => THOCKQUEST.regions.find((region) => region.id === id)

describe('what the omen is worth', () => {
  it('pays a rest by Might, so it is worth most to whoever can take most', () => {
    expect(omenHealAmount(0)).toBe(10)
    expect(omenHealAmount(6)).toBe(22)
    // Gear carries Might past the base cap, and the rest follows it there.
    expect(omenHealAmount(10)).toBe(30)
  })

  it('widens the choice by Intellect rather than improving it', () => {
    // Two, and one more every second point -- the odd point is not lost, it
    // is half of the next one.
    expect([0, 1, 2, 3, 4, 5, 6].map(omenTraitCount)).toEqual([2, 2, 3, 3, 4, 4, 5])
  })

  it('never goes below the floor, whatever an origin did to the stat', () => {
    // A Berserker carries -2 Intellect and can start below zero.
    expect(omenTraitCount(-2)).toBe(2)
    expect(omenHealAmount(-3)).toBe(10)
  })
})

describe('what the region has to offer', () => {
  it('offers only what this region breeds', () => {
    for (const region of THOCKQUEST.regions) {
      const pool = omenPool(region, TRAITS, [])
      expect(pool).toHaveLength(10)
      expect(pool.every((trait) => region.traits.includes(trait.id))).toBe(true)
    }
  })

  it('leaves out what is already held, because a second copy is not a second trait', () => {
    const region = regionOf('caves')!
    const held = [CATALOG.get(region.traits[0])!, CATALOG.get(region.traits[1])!]
    const pool = omenPool(region, TRAITS, held)
    expect(pool).toHaveLength(8)
    expect(pool.map((trait) => trait.id)).not.toContain(region.traits[0])
  })

  it('offers fewer rather than failing when the region is picked clean', () => {
    // A run deep enough to hold most of a region's ten is offered what is
    // left. The rest is always on the table, so the screen is never empty.
    const region = regionOf('fen')!
    const held = region.traits.slice(0, 9).map((id) => CATALOG.get(id)!)
    const pool = omenPool(region, TRAITS, held)
    expect(drawOmenTraits(pool, 5, 1).traits).toHaveLength(1)
    expect(drawOmenTraits(omenPool(region, TRAITS, region.traits.map((id) => CATALOG.get(id)!)), 5, 1).traits)
      .toEqual([])
  })

  it('draws from the region it is given, and a neighbour shares half of it', () => {
    // The ring's grain, from the draw's side: travel one region along and
    // half of what can be found came with you.
    const caves = new Set(omenPool(regionOf('caves'), TRAITS, []).map((trait) => trait.id))
    const foothills = omenPool(regionOf('foothills'), TRAITS, []).map((trait) => trait.id)
    expect(foothills.filter((id) => caves.has(id))).toHaveLength(5)

    const island = omenPool(regionOf('island'), TRAITS, []).map((trait) => trait.id)
    expect(island.filter((id) => caves.has(id))).toHaveLength(5)

    // And a region across the ring shares nothing at all.
    const fen = omenPool(regionOf('fen'), TRAITS, []).map((trait) => trait.id)
    expect(fen.filter((id) => caves.has(id))).toEqual([])
  })

  it('has nothing to offer where there is no region, and does not crash asking', () => {
    expect(omenPool(undefined, TRAITS, [])).toEqual([])
  })
})
