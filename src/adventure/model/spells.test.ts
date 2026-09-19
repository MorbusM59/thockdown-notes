import { describe, expect, it } from 'vitest'

import {
  beginRound, roundFromJson, roundToJson, UNTOUCHED_FIGHT, type RoundState,
} from './combat'
import {
  castSpell, endOfRoundTicks, igniteTick, IGNITE_SHARE, LIGHTNING_MAX_STRIKES, magicalDamage,
  NO_SPELLS, PLAGUE_SHARE, rollSpellReach, spellAt, spellChance, SPELLS, spellsOffered,
  strongestOffered,
} from './spells'
import { type Monster, type MonsterType } from './monsters'
import { createStatBlock, deriveStats, type StatBlock } from './stats'
import { NO_ARMOR } from './armor'
import { testMonster } from '../testing/monster'

const block = (over: Partial<StatBlock> = {}): StatBlock => ({ ...createStatBlock(0), ...over })

const PLAYER = block({ might: 2, agility: 2, perception: 2, intellect: 4, luck: 1 })
const DERIVED = deriveStats(PLAYER)

function monsterOf(type: MonsterType = 'regular', armor = 0): Monster {
  const built = testMonster({ stats: block({ might: 2, agility: 1 }),
    type,
    level: 1,
    against: PLAYER,
  })
  return { ...built, armor: { natural: armor, pieces: [] } }
}

function freshRound(over: Partial<RoundState> = {}): RoundState {
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

function cast(id: string, state: RoundState, monster: Monster, rng: number) {
  const spell = SPELLS.find((candidate) => candidate.id === id)!
  return castSpell({ spell, state, monster, playerStats: PLAYER, playerDerived: DERIVED, rng })
}

/**
 * Reach is ONE NUMBER because the rule says so: a level in reach brings every
 * lower one with it, so a set could express a hand that cannot be dealt.
 */
describe('what a round reaches', () => {
  it('is nothing at all without Intellect', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      expect(rollSpellReach(0, seed).reach).toBe(NO_SPELLS)
    }
    expect(spellChance(0, 0)).toBe(0)
  })

  it('is likelier the lower the spell and the sharper the mind', () => {
    expect(spellChance(6, 0)).toBeGreaterThan(spellChance(6, 5))
    expect(spellChance(6, 0)).toBeGreaterThan(spellChance(3, 0))
    // (6 - 0) / 12 -- the base stat cap is half the table's floor.
    expect(spellChance(6, 0)).toBeCloseTo(0.5, 10)
  })

  it('reaches the top of the table sometimes, and the bottom far more often', () => {
    let top = 0
    let any = 0
    for (let seed = 1; seed <= 4000; seed += 1) {
      const reach = rollSpellReach(6, seed).reach
      if (reach >= 0) any += 1
      if (reach >= 5) top += 1
    }
    expect(any).toBeGreaterThan(top * 2)
    expect(top).toBeGreaterThan(0)
  })

  it('brings every lower spell with it', () => {
    for (const spell of SPELLS) {
      const offered = spellsOffered(spell.level)
      expect(offered).toHaveLength(spell.level + 1)
      // STRONGEST FIRST: the ring opens on its first cell, so the order is
      // the recommendation.
      expect(offered.map((candidate) => candidate.level)).toEqual(
        [...Array(spell.level + 1).keys()].reverse(),
      )
      expect(strongestOffered(spell.level)?.level).toBe(spell.level)
    }
    expect(spellsOffered(NO_SPELLS)).toEqual([])
  })

  it('keeps offering a lasting spell that is already lasting, because they stack', () => {
    // An earlier version withheld those, on the argument that a first cell
    // which is sometimes a mistake is a fight the player has to read. It is
    // not load-bearing here any more: a second cast is never a wasted one.
    const all = spellsOffered(5).map((spell) => spell.id)
    const inEffect = spellsOffered(5, freshRound({ plagued: 2, storming: 1, igniteStacks: 3 }))
      .map((spell) => spell.id)
    expect(inEffect).toEqual(all)
    expect(inEffect).toContain('plague')
    expect(inEffect).toContain('lightningStorm')
  })
})

/**
 * "Cannot miss, cannot be dodged, ignores armour" is one claim about three
 * different mechanisms, and each of them has its own way of going wrong.
 */
describe('a magical strike', () => {
  it('lands every single time', () => {
    for (let seed = 1; seed <= 120; seed += 1) {
      const result = cast('singe', freshRound(), monsterOf(), seed)
      expect(result.blows).toHaveLength(1)
      expect(result.blows[0].hit).toBe(true)
      expect(result.blows[0].dodged).toBe(false)
      expect(result.blows[0].damage).toBeGreaterThan(0)
    }
  })

  it('is not reduced by armour, where an ordinary blow would be', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const bare = cast('singe', freshRound(), monsterOf('regular', 0), seed)
      const plated = cast('singe', freshRound(), monsterOf('regular', 5), seed)
      expect(plated.blows[0].damage).toBe(bare.blows[0].damage)
    }
  })

  it('spends one action, like everything else a round is made of', () => {
    for (const spell of SPELLS) {
      const result = cast(spell.id, freshRound(), monsterOf(), 7)
      expect(result.state.playerActionsSpent).toBe(1)
    }
  })

  it('rides along for free when something else already paid', () => {
    // What a prepared attack's rider is: a cast that costs no action of its
    // own, because the attack it accompanies spent one.
    const spell = spellAt(0)!
    const free = castSpell({
      spell, state: freshRound(), monster: monsterOf(), playerStats: PLAYER,
      playerDerived: DERIVED, rng: 3, spendsAction: false,
    })
    expect(free.state.playerActionsSpent).toBe(0)
    expect(free.blows[0].damage).toBeGreaterThan(0)
  })
})

describe('the table, spell by spell', () => {
  it('Meteor hits twice as hard and takes the rest of its round away', () => {
    const monster = monsterOf()
    for (let seed = 1; seed <= 20; seed += 1) {
      const singed = cast('singe', freshRound(), monster, seed)
      const struck = cast('meteor', freshRound(), monster, seed)
      // Twice as hard is a claim about what the blow is WORTH, not about what
      // it rolled -- damage is drawn from a band now (model/damageRoll.ts),
      // and two draws from two bands are not each other's double.
      expect(struck.blows[0].math.base).toBe(singed.blows[0].math.base * 2)
      expect(struck.blows[0].math.high).toBe(singed.blows[0].math.high * 2)
      // Every action it had, spent -- so `monsterActionsLeft` reads zero and
      // nothing else in the fight had to learn what a stun is.
      expect(struck.state.monsterActionsSpent).toBe(monster.maxActions)
    }
  })

  it('a Bolt leaps at least once and never forever', () => {
    // The repeat chance reaches certainty on a lucky enough character, so the
    // chain is bounded -- a terminator, not a rule.
    const lucky = { ...PLAYER, luck: 12 }
    const result = castSpell({
      spell: spellAt(3)!, state: freshRound(), monster: monsterOf(),
      playerStats: lucky, playerDerived: deriveStats(lucky), rng: 11,
    })
    expect(result.blows.length).toBe(LIGHTNING_MAX_STRIKES)

    let leapt = false
    for (let seed = 1; seed <= 60; seed += 1) {
      const rolled = cast('lightningBolt', freshRound(), monsterOf(), seed)
      expect(rolled.blows.length).toBeGreaterThanOrEqual(1)
      expect(rolled.blows.length).toBeLessThanOrEqual(LIGHTNING_MAX_STRIKES)
      if (rolled.blows.length > 1) leapt = true
    }
    expect(leapt).toBe(true)
  })

  it('Plague takes a share of what is LEFT, so it fades and cannot finish a fight', () => {
    const monster = monsterOf()
    let state = cast('plague', freshRound(), monster, 5).state
    expect(state.plagued).toBe(1)

    const bites: number[] = []
    for (let round = 0; round < 6; round += 1) {
      const ticked = endOfRoundTicks({ state, monster, playerStats: PLAYER, playerDerived: DERIVED, rng: 9 })
      bites.push(ticked.ticks[0].damage)
      state = ticked.state
    }
    expect(bites[0]).toBe(Math.round(monster.maxHitPoints * PLAGUE_SHARE))
    for (let index = 1; index < bites.length; index += 1) {
      expect(bites[index]).toBeLessThan(bites[index - 1])
    }
    expect(state.monsterDamageTaken).toBeLessThan(monster.maxHitPoints)
  })

  it('takes twice the share for a second Plague, which is what stacking means', () => {
    const monster = monsterOf()
    const once = cast('plague', freshRound(), monster, 5).state
    const twice = cast('plague', once, monster, 5).state
    expect(twice.plagued).toBe(2)
    const bite = (state: RoundState) => endOfRoundTicks({
      state, monster, playerStats: PLAYER, playerDerived: DERIVED, rng: 9,
    }).ticks[0].damage
    expect(bite(twice)).toBe(bite(once) * 2)
  })

  it('throws a second bolt for a second Storm, out of the same crit roll', () => {
    // Two storms are two bolts out of one sky, not two independently lucky
    // ones -- so the doubling is exact rather than a second gamble.
    const monster = monsterOf()
    const once = cast('lightningStorm', freshRound(), monster, 5).state
    const twice = cast('lightningStorm', once, monster, 5).state
    const bolt = (state: RoundState) => endOfRoundTicks({
      state, monster, playerStats: PLAYER, playerDerived: DERIVED, rng: 9,
    }).ticks[0].damage
    expect(bolt(twice)).toBe(bolt(once) * 2)
  })

  it('a Storm is flat, and therefore is the one that can finish it', () => {
    const monster = monsterOf()
    let state = cast('lightningStorm', freshRound(), monster, 5).state
    expect(state.storming).toBe(1)
    for (let round = 0; round < 40 && state.monsterDamageTaken < monster.maxHitPoints; round += 1) {
      state = endOfRoundTicks({ state, monster, playerStats: PLAYER, playerDerived: DERIVED, rng: 9 + round }).state
    }
    expect(state.monsterDamageTaken).toBeGreaterThanOrEqual(monster.maxHitPoints)
  })

  it('Ignite burns per stack, per action the monster takes', () => {
    const one = cast('ignite', freshRound(), monsterOf(), 5).state
    expect(one.igniteStacks).toBe(1)
    const two = cast('ignite', one, monsterOf(), 5).state
    expect(two.igniteStacks).toBe(2)

    const first = igniteTick(one, DERIVED)
    const second = igniteTick(two, DERIVED)
    expect(first.tick?.damage).toBe(Math.round(magicalDamage(DERIVED) * IGNITE_SHARE))
    expect(second.tick?.damage).toBe(first.tick!.damage * 2)
    expect(second.state.monsterDamageTaken).toBe(two.monsterDamageTaken + second.tick!.damage)
  })

  it('does not burn a monster that is not on fire', () => {
    const cold = igniteTick(freshRound(), DERIVED)
    expect(cold.tick).toBeNull()
    expect(cold.state.monsterDamageTaken).toBe(0)
  })

  it('pays the round out biggest-spell-last, so the log reads with it first', () => {
    const monster = monsterOf()
    let state = cast('plague', freshRound(), monster, 5).state
    state = cast('lightningStorm', state, monster, 5).state
    const ticked = endOfRoundTicks({ state, monster, playerStats: PLAYER, playerDerived: DERIVED, rng: 9 })
    expect(ticked.ticks.map((tick) => tick.spell.id)).toEqual(['plague', 'lightningStorm'])
  })
})

/**
 * The round's serializer is hand-written on the way IN, which is a list that
 * can fall behind the type. This is the guard: every field, populated with
 * something that is not its default, through JSON and back.
 */
describe('a round survives the disk', () => {
  it('round-trips every field it has', () => {
    const round: RoundState = {
      roundNumber: 3,
      playerActionsSpent: 2,
      monsterActionsSpent: 3,
      playerHitPoints: 41,
      playerArmor: { natural: 5, pieces: [{ itemId: 'plate', points: 2, max: 2 }] },
      monsterDamageTaken: 17,
      monsterFleeing: true,
      playerFled: true,
      spellReach: 4,
      charms: [4, 2, 0],
      plagued: 2,
      storming: 3,
      igniteStacks: 3,
      prepared: 1,
    }
    expect(roundFromJson(JSON.parse(JSON.stringify(roundToJson(round))))).toEqual(round)
  })

  it('reads a save that predates the whole idea as a fight with no magic in it', () => {
    const old = roundFromJson({ playerHitPoints: 30, monsterDamageTaken: 4 })
    // NO_SPELLS, not zero -- zero is "Singe is in reach", a hand nobody dealt.
    expect(old.spellReach).toBe(NO_SPELLS)
    // ROUND ONE, not zero, and that is the one field whose unwritten reading
    // is not `UNTOUCHED_FIGHT`'s. Zero is what an unopened fight holds, and
    // `beginRound` turns it into one; a save being READ has already had its
    // first round opened, so one is the only honest floor. It costs a resumed
    // fight one extra opening move, which is the generous direction and the
    // only one available -- the true number is not recoverable from anything
    // else in the round.
    expect(old.roundNumber).toBe(1)
    expect(old).toMatchObject({ ...UNTOUCHED_FIGHT, roundNumber: 1, playerHitPoints: 30, monsterDamageTaken: 4 })
  })
})
