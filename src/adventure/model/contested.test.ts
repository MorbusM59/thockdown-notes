import { describe, expect, it } from 'vitest'

import {
  actionsRemaining, BASE_DAMAGE, damageFrom, membersDown,
  monsterDefence, MONSTER_TYPES, } from './monsters'
import { clampProgression, PROGRESSION_MAX, PROGRESSION_MIN, PROGRESSION_STEP, powerMultiplier } from './difficulty'
import { chanceAtDelta, COUNTER_STATS, contestedStat, pressThumb, resolveChance } from './chance'
import { createStatBlock, deriveStats, DODGE_CHANCE, STAT_KEYS } from './stats'
import { testMonster } from '../testing/monster'
import { monsterTier, statsFromTier, type Species } from './vectors'
import { rollCount } from './encounterOffers'
import { totalArmor } from './armor'

const block = (over: Partial<Record<string, number>> = {}) => ({ ...createStatBlock(0), ...over }) as ReturnType<typeof createStatBlock>

describe('contested stats', () => {
  it('pairs every stat with a counter that counters it back', () => {
    // The property, not the table: "countered by" is a relation, so it has
    // to be an involution. A one-way entry would mean a stat that answers
    // something which does not answer it -- and the delta would then depend
    // on which side of the fight asked.
    for (const stat of STAT_KEYS) {
      expect(COUNTER_STATS[COUNTER_STATS[stat]]).toBe(stat)
    }
  })

  it('subtracts the opponent COUNTER, not the same stat', () => {
    // Perception is answered by Luck. Reading the opponent's Perception here
    // would look right in every same-stat case and be wrong for two thirds
    // of the table.
    const mine = block({ perception: 4 })
    const theirs = block({ perception: 9, luck: 1 })
    expect(contestedStat('perception', mine, theirs)).toBe(3)
  })

  it('reads the OWN stat with no opponent, not a cancelled-out zero', () => {
    // Two traps, and the code fell into both in turn.
    //
    // Defaulting the opponent to the actor's OWN BLOCK gives a zero delta
    // only where a stat counters itself -- for Perception (answered by Luck)
    // it silently computes `perception - luck`. Defaulting the opposing
    // VALUE to the actor's own gives a zero delta everywhere and cancels the
    // stat term with it, so an uncontested dodge came out flat at 50%
    // however nimble the character was.
    //
    // An absent opponent contributes NOTHING. That is what makes the design
    // plan's `50% + 5% x Agility` the same formula as the contested one.
    const mine = block({ might: 3, agility: 2, perception: 5, intellect: 1, charisma: 4, luck: 0 })
    for (const stat of STAT_KEYS) {
      expect(contestedStat(stat, mine)).toBe(mine[stat])
    }
  })

  it('makes the stat table the contest against nobody', () => {
    // An ABSENT opponent contributes zero, which is what makes the table and
    // the contest one formula rather than two.
    for (let agility = 0; agility <= 6; agility += 1) {
      const mine = block({ agility })
      expect(deriveStats(mine).dodgeChance)
        .toBeCloseTo(chanceAtDelta(DODGE_CHANCE, agility), 10)
      expect(deriveStats(mine, block()).dodgeChance)
        .toBeCloseTo(chanceAtDelta(DODGE_CHANCE, agility), 10)
    }
  })

  it('resolves a declared chance the same way the derived one does', () => {
    // One resolver, so an action declaring `{deltaForce, deltaShift, stat}`
    // and the derived stat block cannot drift apart.
    const mine = block({ agility: 4 })
    const theirs = block({ agility: 1 })
    expect(resolveChance(DODGE_CHANCE, mine, theirs))
      .toBeCloseTo(deriveStats(mine, theirs).dodgeChance, 10)
  })

  it('answers only the delta, wherever the two stats sit', () => {
    // The curve reads the DIFFERENCE and nothing else, so 3-against-5 and
    // 8-against-10 are the same fight. The design plan's own worked example
    // (Agility 3 against Agility 5) is this row, at its new value.
    const two = chanceAtDelta(DODGE_CHANCE, -2)
    expect(deriveStats(block({ agility: 3 }), block({ agility: 5 })).dodgeChance).toBeCloseTo(two, 10)
    expect(deriveStats(block({ agility: 8 }), block({ agility: 10 })).dodgeChance).toBeCloseTo(two, 10)
  })

  it('leaves the uncontested values alone whoever is on the other side', () => {
    const mine = block({ might: 4, agility: 3, perception: 2, luck: 5 })
    const alone = deriveStats(mine)
    const opposed = deriveStats(mine, block({ might: 6, agility: 6, perception: 6, luck: 6 }))
    for (const key of ['maxHitPoints', 'damageMultiplier', 'actionsPerRound', 'encounterChoices', 'offerChoices'] as const) {
      expect(opposed[key]).toBe(alone[key])
    }
    // ...and does move the ones that are contested.
    expect(opposed.dodgeChance).not.toBe(alone.dodgeChance)
  })
})

describe('the power multiplier', () => {
  it('scales hit points and damage and NOTHING else', () => {
    // The rule this holds: `factor^level` on a 0..1 chance saturates rather
    // than scales, and a monster pinned at 100% dodge by level 15 has
    // stopped being stronger and started being unhittable.
    const against = block({ agility: 2, perception: 2, luck: 2 })
    const at = (level: number) => testMonster({ stats: block({ might: 2, agility: 1 }), type: 'regular', level, against,
    })
    const first = at(1)
    const twentieth = at(20)
    // Grown by exactly the curve, rather than by "more than double" -- that
    // was a fact about one growth factor, and it broke the day the presets
    // gained a second number.
    const ratio = powerMultiplier(20) / powerMultiplier(1)
    expect(twentieth.maxHitPoints).toBeGreaterThan(first.maxHitPoints)
    expect(twentieth.damage / first.damage).toBeCloseTo(ratio, 10)
    for (const key of ['dodgeChance', 'hitChance', 'critChance', 'actionsPerRound'] as const) {
      expect(twentieth.derived[key]).toBe(first.derived[key])
    }
  })

  it('is one factor per level, at every progression the slider offers', () => {
    // THE PROPERTY, across the whole range rather than at four named points:
    // the presets were a list and progression is an interval, so the test
    // walks the interval the slider actually walks.
    for (let value = PROGRESSION_MIN; value <= PROGRESSION_MAX + 1e-9; value += PROGRESSION_STEP) {
      const progression = clampProgression(value)
      // PAR at level zero, always. The preset's second number -- what a
      // monster was worth before the curve -- is gone, and the flat axis is
      // the thumb now (model/difficulty.ts).
      expect(powerMultiplier(0, progression)).toBe(1)
      expect(powerMultiplier(1, progression)).toBeCloseTo(progression, 10)
      expect(powerMultiplier(3, progression)).toBeCloseTo(progression ** 3, 10)
    }
  })

  it('reads nonsense as the gentlest curve rather than as a monster worth nothing', () => {
    // A save from another build, or a slider that arrived with a string.
    // Zero would make every monster worth nothing at every level, which is
    // the one wrong answer that looks like the game working.
    for (const bad of [undefined, null, 'plenty', Number.NaN, 0, -3, 99]) {
      expect(powerMultiplier(5, bad as never)).toBeGreaterThan(0)
    }
    expect(clampProgression(0)).toBe(PROGRESSION_MIN)
    expect(clampProgression(99)).toBe(PROGRESSION_MAX)
  })
})

describe('monster ranks', () => {
  it('orders the ranks by TIER, and adds one for every level past the first', () => {
    // The rank ladder used to be a flat stat shift applied to a class's base
    // block. It is a TIER now (model/vectors.ts) -- a budget the build's
    // weights split -- so what a rank is worth is one number and the ordering
    // is a property of that number rather than of six stats moving together.
    for (let index = 1; index < MONSTER_TYPES.length; index += 1) {
      expect(monsterTier(MONSTER_TYPES[index], 1)).toBeGreaterThan(monsterTier(MONSTER_TYPES[index - 1], 1))
    }
    // ONE per level, not five: the rank gap has to stay legible for the whole
    // run, so a level-12 regular is still plainly weaker than a level-12
    // elite. THE PROPERTY, across the whole ladder, rather than one reading.
    for (const type of MONSTER_TYPES) {
      for (let level = 1; level <= 12; level += 1) {
        expect(monsterTier(type, level)).toBe(monsterTier(type, 1) + level - 1)
      }
      expect(monsterTier(type, 12)).toBeLessThan(monsterTier('boss', 1) + 12)
    }
  })

  it('spends the whole tier and no more, whatever the build', () => {
    // THE PROPERTY apportionment exists for: "five points distributed" has to
    // hand out five. Per-share rounding leaks -- six equal weights at tier 5
    // round to one each and pay out six -- which would make the flattest
    // build quietly the strongest at every tier.
    const shapes = [
      { might: 2, agility: 1 },
      { might: 1, agility: 1, perception: 1, intellect: 1, charisma: 1, luck: 1 },
      { intellect: 5, luck: 1 },
      { might: 4, perception: 1 },
    ]
    for (const weights of shapes) {
      for (let tier = 0; tier <= 30; tier += 1) {
        const stats = statsFromTier({ weights }, tier)
        expect(STAT_KEYS.reduce((sum, key) => sum + stats[key], 0)).toBe(tier)
      }
    }
  })

  it('reproduces the design\'s own worked example', () => {
    // Tier 5 over 1 part Agility and 2 parts Might: 2 and 3.
    const stats = statsFromTier({ weights: { agility: 1, might: 2 } }, 5)
    expect(stats.agility).toBe(2)
    expect(stats.might).toBe(3)
  })

  it('takes its armour from its SPECIES, not from its rank', () => {
    // Armour used to be a per-rank table beside the stat shift. It is the
    // species' now -- the vector whose whole job is what a creature is when
    // it is not being a stat block -- so an elite goblin is no better
    // armoured than an ordinary one, and any golem is.
    const base = block({ might: 2, agility: 1 })
    const hide: Species = {
      id: 'hide', name: 'Hide', icon: 'fa-solid fa-shield',
      effects: [{ kind: 'naturalArmor', amount: 4 }],
    }
    for (const type of MONSTER_TYPES) {
      expect(totalArmor(testMonster({ stats: base, type, level: 1, against: base }).armor)).toBe(0)
      expect(totalArmor(testMonster({ stats: base, type, level: 1, against: base, species: hide }).armor)).toBe(4)
    }
  })

  it('travels in numbers only at the ranks that are supposed to', () => {
    // A runt always has a friend and usually two; an ordinary monster has one
    // half the time; nothing elite or above travels at all. Asserted as a
    // RANGE over many seeds rather than as one roll, because one roll of a
    // coin says nothing about the coin.
    const counts = (type: (typeof MONSTER_TYPES)[number]) => {
      const seen = new Set<number>()
      for (let seed = 1; seed <= 200; seed += 1) seen.add(rollCount(type, seed).count)
      return seen
    }
    expect([...counts('runt')].sort()).toEqual([2, 3])
    expect([...counts('regular')].sort()).toEqual([1, 2])
    for (const type of ['elite', 'miniBoss', 'boss'] as const) {
      expect([...counts(type)]).toEqual([1])
    }
  })

  it('multiplies one universal base damage, both sides', () => {
    expect(damageFrom(1)).toBe(BASE_DAMAGE)
    // Might 0 is the 50% floor of the multiplier, so half of base.
    expect(damageFrom(deriveStats(block()).damageMultiplier)).toBeCloseTo(BASE_DAMAGE * 0.5, 10)
  })
})

describe('a group is one hydra', () => {
  const base = block({ might: 2, agility: 2 })
  const groupOf = (count: number) =>
    testMonster({ stats: base, type: 'runt', level: 1, against: base, count })

  it('pools hit points and actions across its members', () => {
    const one = groupOf(1)
    const four = groupOf(4)
    expect(four.maxHitPoints).toBe(one.maxHitPoints * 4)
    expect(four.maxActions).toBe(one.maxActions * 4)
    // One blow is still one member's blow -- a group hits more OFTEN, not harder.
    expect(four.damage).toBeCloseTo(one.damage, 10)
  })

  it('loses a member each time damage crosses a band of the pool', () => {
    const group = groupOf(4)
    const band = group.maxHitPoints / 4
    expect(membersDown(group, 0)).toBe(0)
    expect(membersDown(group, band - 1)).toBe(0)
    expect(membersDown(group, band)).toBe(1)
    expect(membersDown(group, band * 3 + 1)).toBe(3)
    // Never more members than it has, however far past the pool the damage goes.
    expect(membersDown(group, group.maxHitPoints * 10)).toBe(4)
  })

  it('takes a dead member\'s actions off what is LEFT, biased to the player', () => {
    const group = groupOf(4)
    const band = group.maxHitPoints / 4
    const perMember = group.maxActions / 4
    // Untouched: the whole pool.
    expect(actionsRemaining(group, 0, 0)).toBe(group.maxActions)
    // One member down costs a member's worth even though the group had spent
    // none -- the casualty is assumed to be the one that would have gone last.
    expect(actionsRemaining(group, band, 0)).toBe(group.maxActions - perMember)
    // Spending and dying both apply; a death does not refund what was spent.
    expect(actionsRemaining(group, band, 2)).toBe(group.maxActions - perMember - 2)
  })

  it('floors at zero rather than going negative', () => {
    const group = groupOf(2)
    expect(actionsRemaining(group, group.maxHitPoints, group.maxActions)).toBe(0)
    expect(actionsRemaining(group, group.maxHitPoints * 5, 999)).toBe(0)
  })

  it('takes the head count it is given, whatever the rank', () => {
    // WHERE THE RULE LIVES MOVED, and this asserts the move rather than the
    // old placement. `buildMonster` used to force a count of one for every
    // rank but "group", which meant the rank rule was stated twice: once in
    // the type table and once in the builder. It is `rollCount`'s alone now
    // (asserted above), and the builder simply pools what it is handed --
    // which is what lets an offer's stored count survive a reload without the
    // builder second-guessing it.
    for (const type of MONSTER_TYPES) {
      expect(testMonster({ stats: base, type, level: 1, against: base, count: 5 }).count).toBe(5)
    }
  })
})

describe('what a monster does when attacked', () => {
  it('dodges when it can and defends when it cannot', () => {
    expect(monsterDefence(true)).toBe('dodge')
    expect(monsterDefence(false)).toBe('defend')
  })
})

describe('the thumb on the scale', () => {
  it('does nothing at all at zero, for either side', () => {
    for (const chance of [0, 0.2, 0.5, 0.8, 1]) {
      expect(pressThumb(chance, 'player', 0)).toBe(chance)
      expect(pressThumb(chance, 'monster', 0)).toBe(chance)
    }
  })

  it('halves a PLAYER failure and a MONSTER success at fifty percent', () => {
    // The specified example: 80% to succeed is 20% to fail, halved to 10%.
    expect(pressThumb(0.8, 'player', 0.5)).toBeCloseTo(0.9, 10)
    expect(pressThumb(0.6, 'monster', 0.5)).toBeCloseTo(0.3, 10)
  })

  it('is total at one: the player cannot fail and the monster cannot succeed', () => {
    for (const chance of [0, 0.35, 0.99]) {
      expect(pressThumb(chance, 'player', 1)).toBe(1)
      expect(pressThumb(chance, 'monster', 1)).toBe(0)
    }
  })

  it('never leaves 0..1, and never needs a clamp to stay there', () => {
    // The property that makes this shape the right one: it scales a
    // probability rather than adding to it, so no setting can overshoot and
    // no clamp is hiding an error.
    for (let thumb = 0; thumb <= 1.0001; thumb += 0.05) {
      for (let chance = 0; chance <= 1.0001; chance += 0.05) {
        for (const side of ['player', 'monster'] as const) {
          const pressed = pressThumb(Math.min(1, chance), side, Math.min(1, thumb))
          expect(pressed).toBeGreaterThanOrEqual(0)
          expect(pressed).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('moves each side in one direction only, however hard it presses', () => {
    for (let thumb = 0; thumb <= 1.0001; thumb += 0.1) {
      expect(pressThumb(0.4, 'player', Math.min(1, thumb))).toBeGreaterThanOrEqual(0.4)
      expect(pressThumb(0.4, 'monster', Math.min(1, thumb))).toBeLessThanOrEqual(0.4)
    }
  })

  it('leaves the stats doing all the work: two characters keep their order', () => {
    // The whole reason for this shape rather than a flat bonus. A point of
    // Agility is worth what it was worth; the thumb cannot reorder two
    // characters, only move them both.
    const slow = resolveChance(DODGE_CHANCE, block({ agility: 1 }), block({ agility: 2 }))
    const quick = resolveChance(DODGE_CHANCE, block({ agility: 4 }), block({ agility: 2 }))
    expect(quick).toBeGreaterThan(slow)
    for (const thumb of [0.2, 0.5, 0.9]) {
      expect(pressThumb(quick, 'player', thumb)).toBeGreaterThan(pressThumb(slow, 'player', thumb))
    }
  })
})
