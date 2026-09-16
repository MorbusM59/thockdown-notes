import { describe, expect, it } from 'vitest'

import { beginRound, monsterActionsLeft, UNTOUCHED_FIGHT, type RoundState } from './combat'
import { PREPARE_PER_POINT, prepareLines, resolvePreparedAttack } from './prepare'
import { buildMonster, type Monster } from './monsters'
import { createStatBlock, deriveStats, type StatBlock } from './stats'
import { NO_ARMOR } from './armor'
import { spellAt } from './spells'

const block = (over: Partial<StatBlock> = {}): StatBlock => ({ ...createStatBlock(0), ...over })

function monsterOf(): Monster {
  return buildMonster({
    classId: 'fighter',
    classBaseStats: block({ might: 2, agility: 1 }),
    type: 'regular',
    level: 1,
    against: block({ might: 2 }),
  })
}

function roundOf(over: Partial<RoundState> = {}): RoundState {
  return beginRound({
    ...UNTOUCHED_FIGHT,
    playerHitPoints: 80,
    playerArmor: NO_ARMOR,
    monsterDamageTaken: 0,
    monsterFleeing: false,
    playerFled: false,
    ...over,
  })
}

function aim(stats: StatBlock, rng: number, over: Partial<RoundState> = {}) {
  return resolvePreparedAttack({
    state: roundOf({ prepared: 1, ...over }),
    monster: monsterOf(),
    playerStats: stats,
    playerDerived: deriveStats(stats),
    rng,
  })
}

/**
 * The one action that does nothing now. Every stat is worth the same ten
 * percent to it, which is what makes it the place a character built ANY way
 * has something to spend an action on.
 */
describe('a prepared attack', () => {
  it('spends every banked preparation, whatever else happens', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      expect(aim(block({ might: 2, agility: 2 }), seed).state.prepared).toBe(0)
      expect(aim(block({ might: 2, agility: 2 }), seed, { prepared: 3 }).state.prepared).toBe(0)
    }
  })

  it('doubles every term for a second preparation', () => {
    // "Double prepare doubles the stats" -- every one of them, including the
    // rider, which comes down once per preparation.
    const stats = block({ might: 4, agility: 5, charisma: 5, perception: 4, intellect: 6 })
    const once = aim(stats, 9, { spellReach: 0 })
    const twice = aim(stats, 9, { spellReach: 0, prepared: 2 })
    // Agility 5 is a coin-flip once and a certainty twice; Charisma likewise.
    expect(twice.blows.length).toBe(2)
    expect(twice.stunned).toBe(true)
    // The rider fires once per preparation.
    expect(once.rider?.blows).toHaveLength(1)
    expect(twice.rider?.blows).toHaveLength(2)
    // ...and still costs exactly the one action the attack itself is.
    expect(twice.state.playerActionsSpent).toBe(1)
  })

  it('costs exactly one action, however many times it swung', () => {
    // Agility buys a second SWING, not a second action -- the whole point is
    // that a prepared attack is one press.
    const nimble = block({ might: 2, agility: 10, perception: 4 })
    let sawTwo = false
    for (let seed = 1; seed <= 40; seed += 1) {
      const struck = aim(nimble, seed)
      expect(struck.state.playerActionsSpent).toBe(1)
      if (struck.blows.length === 2) sawTwo = true
    }
    expect(sawTwo).toBe(true)
  })

  it('never swings twice for a character with no speed in them', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      expect(aim(block({ might: 2, agility: 0 }), seed).blows).toHaveLength(1)
    }
  })

  it('hits harder than the same character unprepared', () => {
    // Might scales the damage; the comparison is against the same seed, so
    // the hit and crit rolls are the same rolls.
    const strong = block({ might: 6, perception: 6 })
    let compared = 0
    for (let seed = 1; seed <= 60 && compared < 5; seed += 1) {
      const loose = aim(block({ ...strong, might: 0 }), seed)
      const aimed = aim(strong, seed)
      if (!loose.blows[0].hit || !aimed.blows[0].hit) continue
      expect(aimed.blows[0].damage).toBeGreaterThan(loose.blows[0].damage)
      compared += 1
    }
    expect(compared).toBe(5)
  })

  it('ends the round of the monster sometimes, and never for a mute character', () => {
    let staggered = 0
    for (let seed = 1; seed <= 60; seed += 1) {
      const struck = aim(block({ might: 2, charisma: 10 }), seed)
      if (struck.stunned) {
        staggered += 1
        expect(monsterActionsLeft(struck.state, monsterOf())).toBe(0)
      }
      expect(aim(block({ might: 2, charisma: 0 }), seed).stunned).toBe(false)
    }
    expect(staggered).toBeGreaterThan(0)
  })

  it('brings the strongest spell in reach along for free, once', () => {
    // ONCE however many times the attack swung: "on top of its regular
    // attack" is one spell on one action, and a doubled Meteor is not what a
    // ten-percent chance should buy.
    const nimble = block({ might: 2, agility: 10, intellect: 6 })
    for (let seed = 1; seed <= 20; seed += 1) {
      const struck = aim(nimble, seed, { spellReach: 5 })
      expect(struck.rider?.spell.id).toBe('meteor')
      expect(struck.rider?.blows).toHaveLength(1)
      // One action, still.
      expect(struck.state.playerActionsSpent).toBe(1)
    }
  })

  it('rides nothing along when the round dealt nothing', () => {
    expect(aim(block({ might: 2, intellect: 6 }), 5).rider).toBeNull()
  })

  it('says what it would do, computed from the stats rather than written down', () => {
    const lines = prepareLines(block({ might: 3, agility: 2, perception: 1, luck: 4, charisma: 5 }), spellAt(2))
    expect(lines[0]).toContain(`${Math.round(3 * PREPARE_PER_POINT * 100)}% damage`)
    expect(lines[1]).toContain('20% to strike twice')
    expect(lines[1]).toContain('50% to end its round')
    expect(lines[2]).toContain('Ignite')
    expect(prepareLines(block(), null)[2]).toMatch(/No spell in reach/)
  })
})
