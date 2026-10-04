import { describe, expect, it } from 'vitest'

import {
  BASE_DAMAGE_SPREAD, damageBand, damageRollCount, damageSpread, rollAttackDamage, SPREAD_PIVOT,
} from './damageRoll'
import { createStatBlock, type StatBlock } from './stats'

const block = (over: Partial<StatBlock> = {}): StatBlock => ({ ...createStatBlock(0), ...over })

const draw = (nominal: number, stats: StatBlock, rng: number) =>
  rollAttackDamage({ nominal, attackerStats: stats, rng })

/**
 * A blow's nominal damage is its CEILING, not its value. How far below it the
 * blow can land reads Perception; how many draws at it you get reads Luck.
 */
describe('the band a blow is drawn from', () => {
  it('is widest at no Perception at all, and is the whole of BASE_DAMAGE_SPREAD', () => {
    expect(damageSpread(0)).toBe(BASE_DAMAGE_SPREAD)
    expect(damageBand(0)).toEqual({ low: 1 - BASE_DAMAGE_SPREAD, high: 1 })
  })

  it('closes to a point exactly at the base stat cap', () => {
    // Which is the reward for maxing it: full damage, every time.
    expect(damageSpread(SPREAD_PIVOT)).toBe(0)
    expect(damageBand(SPREAD_PIVOT)).toEqual({ low: 1, high: 1 })
  })

  it('REVERSES past the cap rather than inverting, so gear buys damage', () => {
    // The spread goes negative and `1 - spread` lands above 1. The band has to
    // come back low-first anyway, or a caller samples it the wrong way round.
    expect(damageSpread(SPREAD_PIVOT * 2)).toBe(-BASE_DAMAGE_SPREAD)
    const band = damageBand(SPREAD_PIVOT * 2)
    expect(band.low).toBe(1)
    expect(band.high).toBe(1 + BASE_DAMAGE_SPREAD)
    expect(band.low).toBeLessThan(band.high)
  })

  it('narrows monotonically as Perception climbs to the cap', () => {
    for (let perception = 0; perception < SPREAD_PIVOT; perception += 1) {
      const here = damageBand(perception)
      const next = damageBand(perception + 1)
      expect(next.high - next.low).toBeLessThan(here.high - here.low)
    }
  })
})

describe('drawing from it', () => {
  it('never lands outside the band, however the dice fall', () => {
    const stats = block({ perception: 1, luck: 2 })
    const band = damageBand(1)
    for (let seed = 1; seed <= 300; seed += 1) {
      const rolled = draw(10, stats, seed)
      expect(rolled.damage).toBeGreaterThanOrEqual(10 * band.low - 1e-9)
      expect(rolled.damage).toBeLessThanOrEqual(10 * band.high + 1e-9)
    }
  })

  it('takes one draw plus one per point of Luck, and keeps the best', () => {
    expect(damageRollCount(0)).toBe(1)
    expect(damageRollCount(4)).toBe(5)
    // Luck cannot push a blow past the ceiling -- only stop it landing at the
    // floor. That is what makes it read as luck rather than as a bonus.
    let lucky = 0
    let plain = 0
    for (let seed = 1; seed <= 400; seed += 1) {
      plain += draw(10, block({ luck: 0 }), seed).damage
      lucky += draw(10, block({ luck: 5 }), seed).damage
    }
    expect(lucky).toBeGreaterThan(plain)
    expect(lucky / 400).toBeLessThanOrEqual(10)
  })

  it('buys nothing at all where the band is a point, and spends no rng doing it', () => {
    // A band with no width has nothing to draw from, and drawing anyway would
    // move the seeded stream for an answer that cannot vary.
    const sharp = block({ perception: SPREAD_PIVOT, luck: 6 })
    const rolled = draw(10, sharp, 4242)
    expect(rolled.damage).toBe(10)
    expect(rolled.rolls).toBe(1)
    expect(rolled.rng).toBe(4242)
  })

  it('is the ATTACKER’s stats, so a lucky monster rolls as many times as a lucky player', () => {
    // Both sides read one stat table -- the invariant the thumb exists to
    // protect (model/chance.ts). Nothing here knows which side it is on.
    const monsterish = block({ perception: 2, luck: 4 })
    expect(draw(10, monsterish, 7).rolls).toBe(damageRollCount(4))
  })
})
