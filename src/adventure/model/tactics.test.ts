// THE SIX FIGHT-SHAPE RULES, each checked as the rule it is rather than as
// one worked example -- a rule about the second, third and fourth attack of a
// round is not tested by asserting the second.

import { describe, expect, it } from 'vitest'

import {
  NO_TACTICS, NO_TALLY, blowDamageWith, poisonDamage, talliesIntoRound, tallyAfterBlow, thornsRecoil,
  type Tactics,
} from './tactics'
import { NO_ARMOR } from './armor'

const withTactic = (over: Partial<Tactics>): Tactics => ({ ...NO_TACTICS, ...over })

describe('Combo', () => {
  it('pays a share per strike ALREADY taken, so the round s first blow is the plain one', () => {
    const tactics = withTactic({ combo: 0.05 })
    let tally = NO_TALLY
    const swings: number[] = []
    for (let strike = 0; strike < 5; strike += 1) {
      const damage = blowDamageWith({ nominal: 100, tactics, tally, isLastOfRound: false, targetIsMaimed: false })
      swings.push(damage)
      tally = tallyAfterBlow(tally, tactics, damage)
    }
    // The design's own worked example: 100, 105, 110, and on in a straight
    // line. Close-to rather than equal, because a share of a share is binary
    // floating point -- the figure a player sees is whole, rounded once by
    // the exchange, and rounding here instead would hide the drift rather
    // than tolerate it.
    for (const [index, expected] of [100, 105, 110, 115, 120].entries()) {
      expect(swings[index]).toBeCloseTo(expected, 10)
    }
  })

  it('counts a MISS, which is what makes it scale with the action count alone', () => {
    const tactics = withTactic({ combo: 0.05 })
    // A blow of zero is a blow that did not land. It still happened.
    const missed = tallyAfterBlow(NO_TALLY, tactics, 0)
    expect(missed.strikes).toBe(1)
    expect(blowDamageWith({ nominal: 100, tactics, tally: missed, isLastOfRound: false, targetIsMaimed: false }))
      .toBe(105)
  })

  it('is gone when the round turns over', () => {
    const tactics = withTactic({ combo: 0.05 })
    const built = tallyAfterBlow(tallyAfterBlow(NO_TALLY, tactics, 10), tactics, 10)
    expect(built.strikes).toBe(2)
    expect(talliesIntoRound({ player: built, monster: NO_TALLY }).player.strikes).toBe(0)
  })
})

describe('Poison', () => {
  it('accrues a share of every LANDED blow and pays it every round', () => {
    const tactics = withTactic({ poison: 0.05 })
    // Three blows of 40 at 5% is 6, which is the worked example exactly.
    let tally = NO_TALLY
    for (let hit = 0; hit < 3; hit += 1) tally = tallyAfterBlow(tally, tactics, 40)
    expect(poisonDamage(tally)).toBe(6)

    // FOUR more hits, and the pool is the whole seven stacks -- it is not
    // spent by paying, which is what makes landing often compound.
    for (let hit = 0; hit < 4; hit += 1) tally = tallyAfterBlow(tally, tactics, 40)
    expect(poisonDamage(tally)).toBe(14)
    expect(poisonDamage(talliesIntoRound({ player: tally, monster: NO_TALLY }).player)).toBe(14)
  })

  it('takes nothing from a blow that missed', () => {
    const tactics = withTactic({ poison: 0.05 })
    expect(poisonDamage(tallyAfterBlow(NO_TALLY, tactics, 0))).toBe(0)
  })
})

describe('Mark', () => {
  it('adds a share of the round s FIRST blow to its last, and to nothing else', () => {
    const tactics = withTactic({ mark: 0.5 })
    const opener = blowDamageWith({ nominal: 40, tactics, tally: NO_TALLY, isLastOfRound: false, targetIsMaimed: false })
    const tally = tallyAfterBlow(NO_TALLY, tactics, opener)
    const middle = blowDamageWith({ nominal: 40, tactics, tally, isLastOfRound: false, targetIsMaimed: false })
    const last = blowDamageWith({ nominal: 40, tactics, tally, isLastOfRound: true, targetIsMaimed: false })
    expect(opener).toBe(40)
    expect(middle).toBe(40)
    expect(last).toBe(60)
  })

  it('forgets the opener when the round turns over', () => {
    const tactics = withTactic({ mark: 0.5 })
    const tally = tallyAfterBlow(NO_TALLY, tactics, 40)
    const next = talliesIntoRound({ player: tally, monster: NO_TALLY }).player
    expect(blowDamageWith({ nominal: 40, tactics, tally: next, isLastOfRound: true, targetIsMaimed: false })).toBe(40)
  })
})

describe('Setup', () => {
  it('adds a share of the FIGHT s first blow to every blow against a maimed foe', () => {
    const tactics = withTactic({ setup: 0.5 })
    const opener = blowDamageWith({ nominal: 40, tactics, tally: NO_TALLY, isLastOfRound: false, targetIsMaimed: false })
    let tally = tallyAfterBlow(NO_TALLY, tactics, opener)
    // Across a round boundary, because the opening blow of the FIGHT is what
    // it names -- this is the whole difference between Setup and Mark.
    tally = talliesIntoRound({ player: tally, monster: NO_TALLY }).player
    expect(blowDamageWith({ nominal: 40, tactics, tally, isLastOfRound: false, targetIsMaimed: true })).toBe(60)
    expect(blowDamageWith({ nominal: 40, tactics, tally, isLastOfRound: false, targetIsMaimed: false })).toBe(40)
  })
})

describe('Thorns', () => {
  it('throws back a share of the WHOLE pool, natural and worn together', () => {
    const armor = { natural: 2, pieces: [{ itemId: 'plate', points: 4, max: 6 }] }
    expect(thornsRecoil(withTactic({ thorns: 1 }), armor)).toBe(6)
    expect(thornsRecoil(withTactic({ thorns: 0.5 }), armor)).toBe(3)
  })

  it('is nothing at all for a character who holds none', () => {
    expect(thornsRecoil(NO_TACTICS, { natural: 9, pieces: [] })).toBe(0)
    expect(thornsRecoil(withTactic({ thorns: 1 }), NO_ARMOR)).toBe(0)
  })
})

describe('every tactic', () => {
  it('leaves a blow exactly as it found it when none is held', () => {
    // The property that makes every reader of these a plain multiplication
    // rather than a branch: a character with no tactics pays no tax for the
    // mechanism existing.
    for (const isLastOfRound of [false, true]) {
      for (const targetIsMaimed of [false, true]) {
        const tally = { strikes: 4, firstBlow: 50, openingBlow: 70, poison: 9 }
        expect(blowDamageWith({ nominal: 40, tactics: NO_TACTICS, tally, isLastOfRound, targetIsMaimed })).toBe(40)
      }
    }
  })

  it('stacks additively, because a tactic is a quantity and not a chance', () => {
    // Two sources of Combo make one bigger Combo -- the standing rule that an
    // active effect stacks, and the same arithmetic two sources of Damage take.
    const tally = { ...NO_TALLY, strikes: 2 }
    const once = blowDamageWith({ nominal: 100, tactics: withTactic({ combo: 0.05 }), tally, isLastOfRound: false, targetIsMaimed: false })
    const twice = blowDamageWith({ nominal: 100, tactics: withTactic({ combo: 0.1 }), tally, isLastOfRound: false, targetIsMaimed: false })
    expect(once).toBeCloseTo(110, 10)
    expect(twice).toBeCloseTo(120, 10)
  })
})
