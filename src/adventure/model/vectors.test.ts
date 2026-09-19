import { describe, expect, it } from 'vitest'

import { THOCKQUEST } from '../content'
import { validateContent } from '../content'
import {
  BASE_PLAYER_TIER, MAX_FAME_TIER, MAX_TIER_PURCHASES, MONSTER_BUDDY_CHANCES, MONSTER_TYPES, MONSTER_TYPE_TIER,
  TIER_PER_FAME_POINT, buildModifier, buildWeightInitials, describeBuild, monsterTier, statsFromTier,
} from './vectors'
import { STAT_KEYS, STAT_LABELS } from './stats'
import { armMove, describeMove, strikesOf } from './moves'
import type { CombatClass } from './vectors'

describe('the tier, split by the weights', () => {
  it('hands out exactly the tier, for every shape and every tier', () => {
    // THE PROPERTY, not a reading of it. "Five points distributed" has to
    // hand out five; per-share rounding leaks, and the leak favours the
    // flattest build, which is the one shape nobody would think to check.
    for (const build of THOCKQUEST.builds) {
      for (let tier = 0; tier <= MAX_FAME_TIER + 20; tier += 1) {
        const stats = statsFromTier(build, tier)
        expect(STAT_KEYS.reduce((sum, key) => sum + stats[key], 0)).toBe(tier)
        for (const key of STAT_KEYS) expect(stats[key]).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('gives nothing to a stat the build does not want, at any tier', () => {
    // A build is a SHAPE, so a stat with no weight has none of the budget
    // however large the budget gets. Apportionment is the only rounding that
    // keeps that true -- a "round up from a tiny share" rule would hand a
    // Hulking character Charisma at tier 30.
    for (const build of THOCKQUEST.builds) {
      const unwanted = STAT_KEYS.filter((key) => (build.weights[key] ?? 0) === 0)
      for (const tier of [1, 5, 12, 30, 60]) {
        const stats = statsFromTier(build, tier)
        for (const key of unwanted) expect(stats[key]).toBe(0)
      }
    }
  })

  it('is monotonic: more tier is never less of a stat', () => {
    // Largest-remainder apportionment can move a seat between two stats as
    // the total grows (the Alabama paradox), which for a game would read as
    // "I bought a tier and lost a point of Might". Asserted rather than
    // assumed, because whether it can happen here depends on the weights.
    for (const build of THOCKQUEST.builds) {
      let previous = statsFromTier(build, 0)
      for (let tier = 1; tier <= 60; tier += 1) {
        const stats = statsFromTier(build, tier)
        for (const key of STAT_KEYS) expect(stats[key]).toBeGreaterThanOrEqual(previous[key])
        previous = stats
      }
    }
  })

  it('reproduces the design\'s worked example', () => {
    const stats = statsFromTier({ weights: { agility: 1, might: 2 } }, 5)
    expect(stats.agility).toBe(2)
    expect(stats.might).toBe(3)
  })

  it('is nothing at all with no tier or no weights', () => {
    for (const key of STAT_KEYS) {
      expect(statsFromTier({ weights: { might: 3 } }, 0)[key]).toBe(0)
      expect(statsFromTier({ weights: {} }, 20)[key]).toBe(0)
    }
  })

  it('arrives as a modifier, so it lands ABOVE the base-stat clamp', () => {
    // The whole reason it is a modifier: base stats are what a run SPENT and
    // are capped at six. A build that wrote into them would spend the
    // player's allowance for them, and a tier-30 character could not exist.
    const modifier = buildModifier(THOCKQUEST.builds[0], 30)
    expect(modifier).not.toBeNull()
    const total = (modifier?.effects ?? []).reduce(
      (sum, effect) => sum + (effect.kind === 'statDelta' ? effect.amount : 0),
      0,
    )
    expect(total).toBe(30)
    expect((modifier?.effects ?? []).every((effect) => effect.kind === 'statDelta')).toBe(true)
  })

  it('has no modifier at all without a build', () => {
    expect(buildModifier(null, 20)).toBeNull()
  })
})

describe('the rank ladder', () => {
  it('is the design\'s own table, and rises by one per level', () => {
    expect(MONSTER_TYPE_TIER).toEqual({ runt: 0, regular: 5, elite: 10, miniBoss: 15, boss: 20 })
    for (const type of MONSTER_TYPES) {
      expect(monsterTier(type, 1)).toBe(MONSTER_TYPE_TIER[type])
      expect(monsterTier(type, 7)).toBe(MONSTER_TYPE_TIER[type] + 6)
      // A level below the first is not a thing, and reads as the first.
      expect(monsterTier(type, 0)).toBe(MONSTER_TYPE_TIER[type])
    }
  })

  it('keeps the rungs apart for a whole run', () => {
    // ONE per level rather than five, so a level-12 regular is still plainly
    // weaker than a level-12 elite. The property that buys: a rank is never
    // overtaken by the rank below it, at any level either side reaches.
    for (let level = 1; level <= 12; level += 1) {
      for (let index = 1; index < MONSTER_TYPES.length; index += 1) {
        expect(monsterTier(MONSTER_TYPES[index], level))
          .toBeGreaterThan(monsterTier(MONSTER_TYPES[index - 1], level))
      }
    }
  })

  it('puts the player\'s ceiling where the fame purchases put it', () => {
    expect(MAX_FAME_TIER).toBe(BASE_PLAYER_TIER + TIER_PER_FAME_POINT * MAX_TIER_PURCHASES)
    // ...and a fully ascended player is worth more than a first-level boss
    // and less than a late one, which is the shape the ladder is meant to
    // have: the top of a run meets the bosses somewhere in the middle of it.
    expect(MAX_FAME_TIER).toBeGreaterThan(monsterTier('boss', 1))
    expect(MAX_FAME_TIER).toBeLessThan(monsterTier('boss', 12))
  })

  it('lets only the weak ranks travel', () => {
    expect(MONSTER_BUDDY_CHANCES.runt).toEqual([1, 0.5])
    expect(MONSTER_BUDDY_CHANCES.regular).toEqual([0.5])
    for (const type of ['elite', 'miniBoss', 'boss'] as const) {
      expect(MONSTER_BUDDY_CHANCES[type]).toEqual([])
    }
  })
})

describe('a class move', () => {
  const chancy: CombatClass = {
    id: 'chancy',
    name: 'Chancy',
    icon: 'fa-solid fa-dice',
    moves: [
      { id: 'chancy:rare', name: 'Rare', icon: 'fa-solid fa-star', replaces: 'attack', when: { kind: 'chance', chance: 0.5 } },
      { id: 'chancy:always', name: 'Always', icon: 'fa-solid fa-circle', replaces: 'attack', when: { kind: 'always' } },
    ],
  }
  const fresh = { actionsTakenThisEncounter: 0, actionsSpentThisRound: 0, actionsLeftThisRound: 3, healthFraction: 1 }

  it('takes the FIRST declared that qualifies', () => {
    // Declaration order is the author's priority, and it is the only ordering
    // that does not need a second field nobody would keep in step. Over many
    // seeds both are reachable, and the rarer one is never crowded out.
    const armed = Array.from({ length: 200 }, (_unused, seed) => armMove(chancy, 'attack', fresh, seed + 1).move?.id)
    expect(new Set(armed)).toEqual(new Set(['chancy:rare', 'chancy:always']))
  })

  it('costs a draw only where a chance was actually asked', () => {
    // A draw taken for a move that could not have fired would move the seeded
    // stream, and two runs with the same seed would diverge on a class
    // nobody picked.
    const noChance: CombatClass = { ...chancy, moves: [chancy.moves[1]] }
    expect(armMove(noChance, 'attack', fresh, 12345).rng).toBe(12345)
    expect(armMove(null, 'attack', fresh, 12345).rng).toBe(12345)
    // ...and a move for a DIFFERENT cell is not asked either.
    expect(armMove(chancy, 'defend', fresh, 12345).rng).toBe(12345)
  })

  it('reads the triggers off the situation and nothing else', () => {
    const opener: CombatClass = {
      ...chancy,
      moves: [{ id: 'o', name: 'O', icon: 'i', replaces: 'attack', when: { kind: 'firstActionOfEncounter' } }],
    }
    expect(armMove(opener, 'attack', fresh, 1).move).not.toBeNull()
    expect(armMove(opener, 'attack', { ...fresh, actionsTakenThisEncounter: 1 }, 1).move).toBeNull()

    const closer: CombatClass = {
      ...chancy,
      moves: [{ id: 'c', name: 'C', icon: 'i', replaces: 'attack', when: { kind: 'lastActionOfRound' } }],
    }
    expect(armMove(closer, 'attack', fresh, 1).move).toBeNull()
    expect(armMove(closer, 'attack', { ...fresh, actionsLeftThisRound: 1 }, 1).move).not.toBeNull()

    const desperate: CombatClass = {
      ...chancy,
      moves: [{ id: 'd', name: 'D', icon: 'i', replaces: 'attack', when: { kind: 'health', band: 'injured' } }],
    }
    expect(armMove(desperate, 'attack', fresh, 1).move).toBeNull()
    expect(armMove(desperate, 'attack', { ...fresh, healthFraction: 0.2 }, 1).move).not.toBeNull()
  })

  it('always strikes at least once', () => {
    expect(strikesOf(null)).toBe(1)
    for (const combatClass of THOCKQUEST.combatClasses) {
      for (const move of combatClass.moves) expect(strikesOf(move)).toBeGreaterThanOrEqual(1)
    }
  })

  it('says what it does, in lines, for every move the game ships', () => {
    // A move whose numbers were tuned and whose description was not is a move
    // that lies, so the description is WRITTEN FROM THE FIELDS -- and the one
    // thing that can still go wrong is a move with nothing to say at all.
    for (const combatClass of THOCKQUEST.combatClasses) {
      for (const move of combatClass.moves) {
        const lines = describeMove(move, 'verbose')
        expect(lines.length).toBeGreaterThan(0)
        expect(lines.every((line) => line.trim().length > 0)).toBe(true)
      }
    }
  })
})

describe('what the content says about itself', () => {
  it('is internally consistent', () => {
    expect(validateContent(THOCKQUEST)).toEqual([])
  })

  it('describes a build in the same words the stat table uses', () => {
    // `describeBuild` keeps a local copy of the stat labels to keep this
    // module's imports to the three it needs. This is the check that stops
    // the copy drifting.
    for (const build of THOCKQUEST.builds) {
      const lines = describeBuild(build)
      const named = STAT_KEYS.filter((key) => (build.weights[key] ?? 0) > 0)
      expect(lines).toHaveLength(named.length)
      for (const key of named) {
        expect(lines.some((line) => line.startsWith(`${STAT_LABELS[key]} x`))).toBe(true)
      }
    }
  })

  it('describes a build as its WEIGHTS and says nothing about tier', () => {
    // A build is a blueprint for growth and a tier is how far the run has
    // come. The origins screen used to show what a build came to AT THE
    // CURRENT TIER, which made the ratio look like a consequence of the tier
    // rather than the thing being chosen.
    const brutish = { id: 'x', name: 'Brutish', icon: 'fa-solid fa-hammer', weights: { might: 3, agility: 1 } }
    expect(describeBuild(brutish)).toEqual(['Might x 3', 'Agility x 1'])
    for (const build of THOCKQUEST.builds) {
      for (const line of describeBuild(build)) expect(line.toLowerCase()).not.toContain('tier')
    }
  })

  /**
   * The nameplate on the bar has room for a glyph and a tooltip, so the
   * weights are written as repeated initials. That is only readable while
   * the six stats have six DISTINCT initials -- a seventh stat starting with
   * an M would silently print two builds the same.
   */
  it('writes a build\'s weights as repeated initials, on six distinct letters', () => {
    const initials = new Set(STAT_KEYS.map((key) => STAT_LABELS[key][0]))
    expect(initials.size).toBe(STAT_KEYS.length)
    expect(buildWeightInitials({ id: 'x', name: 'Brutish', icon: 'i', weights: { might: 3, agility: 1 } })).toBe('MMMA')
    // Every real build prints as many letters as it has parts.
    for (const build of THOCKQUEST.builds) {
      const parts = STAT_KEYS.reduce((sum, key) => sum + Math.max(0, build.weights[key] ?? 0), 0)
      expect(buildWeightInitials(build)).toHaveLength(parts)
    }
  })

  it('gives every vector enough to choose from to fill a screen', () => {
    // Character creation deals six of each. A list shorter than that is not
    // broken, but it is a screen with no decision on it, which is worth
    // knowing before a player finds out.
    expect(THOCKQUEST.builds.length).toBeGreaterThanOrEqual(6)
    expect(THOCKQUEST.species.filter((species) => species.playable).length).toBeGreaterThanOrEqual(6)
    expect(THOCKQUEST.combatClasses.filter((entry) => entry.playable !== false).length).toBeGreaterThanOrEqual(6)
    // ...and enough MONSTER species that a level's offers are not the same
    // three creatures over and over.
    expect(THOCKQUEST.species.filter((species) => !species.playable).length).toBeGreaterThanOrEqual(10)
  })
})
