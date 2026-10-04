// WHAT EVERY DECLARED CHANCE COMES TO, and that the curve behind them all
// keeps its shape.
//
// A `StatChance` no longer states its value at parity: it says how steeply it
// answers the delta and where the coin flip sits, and the parity value falls
// out (`model/chance.ts`). That is the right thing for the arithmetic and the
// wrong thing for a reader, who used to be able to read "50% + 5% a point"
// off the declaration and now cannot. So the numbers a designer actually
// argues about are written down HERE, checked rather than implied -- and a
// tuning change has to come and edit this file, which is the point.

import { describe, expect, it } from 'vitest'

import { chanceAtDelta, DEFAULT_DELTA_FORCE, type StatChance } from './chance'
import { CHARM_CHECK } from './charm'
import { LIGHTNING_REPEAT_CHANCE } from './spells'
import { CRIT_CHANCE, DODGE_CHANCE, HIT_CHANCE } from './stats'

/** Every stat-delta check in the game. A new one belongs in this list. */
const EVERY_CHANCE: Readonly<Record<string, StatChance>> = {
  dodge: DODGE_CHANCE,
  hit: HIT_CHANCE,
  crit: CRIT_CHANCE,
  charm: CHARM_CHECK,
  lightningRepeat: LIGHTNING_REPEAT_CHANCE,
}

describe('every declared chance', () => {
  it('sits where the design says at parity', () => {
    // Four of the five are even money between equals; crit is the exception
    // and is a quarter, which is what its -4 shift is for.
    expect(chanceAtDelta(DODGE_CHANCE, 0)).toBeCloseTo(0.5, 10)
    expect(chanceAtDelta(HIT_CHANCE, 0)).toBeCloseTo(0.5, 10)
    expect(chanceAtDelta(CHARM_CHECK, 0)).toBeCloseTo(0.5, 10)
    expect(chanceAtDelta(LIGHTNING_REPEAT_CHANCE, 0)).toBeCloseTo(0.5, 10)
    expect(chanceAtDelta(CRIT_CHANCE, 0)).toBeCloseTo(0.25, 10)
  })

  it('climbs at the shared rate: four points of delta halve what is left', () => {
    // The whole table for a centred chance, so a change to DEFAULT_DELTA_FORCE
    // has to be argued for in numbers rather than slipped in.
    const expected: readonly [number, number][] = [
      [-8, 0.125], [-4, 0.25], [0, 0.5], [4, 0.75], [8, 0.875], [12, 0.9375],
    ]
    for (const [delta, value] of expected) {
      expect(chanceAtDelta(HIT_CHANCE, delta)).toBeCloseTo(value, 10)
      // Crit is the same curve four points later, which is all the shift is.
      expect(chanceAtDelta(CRIT_CHANCE, delta + 4)).toBeCloseTo(value, 10)
    }
    expect(DEFAULT_DELTA_FORCE).toBe(0.25)
  })

  it('never reaches certainty or impossibility, at any delta', () => {
    // THE REASON THE CURVE REPLACED A LINE. A mono-stat build at the base cap
    // plus its tier is already past twelve against another build's nothing,
    // so the old clamp was reachable in ordinary play and made an immunity.
    for (const [name, chance] of Object.entries(EVERY_CHANCE)) {
      for (let delta = -40; delta <= 40; delta += 1) {
        const value = chanceAtDelta(chance, delta)
        expect(value, `${name} at ${delta}`).toBeGreaterThan(0)
        expect(value, `${name} at ${delta}`).toBeLessThan(1)
      }
    }
  })

  it('is monotone in the delta, so a point of a stat is never a downgrade', () => {
    for (const [name, chance] of Object.entries(EVERY_CHANCE)) {
      for (let delta = -40; delta < 40; delta += 1) {
        expect(chanceAtDelta(chance, delta + 1), `${name} at ${delta}`)
          .toBeGreaterThan(chanceAtDelta(chance, delta))
      }
    }
  })

  it('puts the coin flip exactly where the shift says', () => {
    for (const [name, chance] of Object.entries(EVERY_CHANCE)) {
      expect(chanceAtDelta(chance, -chance.deltaShift), name).toBeCloseTo(0.5, 10)
    }
  })

  it('is symmetric about that coin flip: what one side gains the other loses', () => {
    // p(x) + p(-x - 2s) = 1. The two halves are written as separate branches,
    // so this is the assertion that keeps them each other's mirror.
    for (const chance of Object.values(EVERY_CHANCE)) {
      for (let delta = -20; delta <= 20; delta += 1) {
        const mirror = -delta - 2 * chance.deltaShift
        expect(chanceAtDelta(chance, delta) + chanceAtDelta(chance, mirror)).toBeCloseTo(1, 10)
      }
    }
  })
})
