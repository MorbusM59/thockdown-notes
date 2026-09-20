import { describe, expect, it } from 'vitest'

import { THOCKQUEST } from '../content'
import { choose, currentScreen, enterEntryScreen, type DirectorDeps } from '../core/director'
import { activeGame, applyEffects, emptySave, playerTierOf, profileOf, type GameSave } from './gameState'
import { BASE_STAT_CAP, STAT_KEYS } from './stats'
import { BASE_PLAYER_TIER, statsFromTier } from './vectors'
import { sanitizeGameSave } from '../save'
import { ROOT_STAGE_ID, STAGES } from '../stages'
import { createdRun, withVectors } from '../testing/run'
import { permanentUnlockById } from './permanentUnlocks'

const DEPS: DirectorDeps = { stages: STAGES, content: THOCKQUEST, rootStageId: ROOT_STAGE_ID }
const NOW = 1_700_000_000_000
const MIGHTY_BUILD = 'might-agility-perception'

/** A run with its three content vectors set, and nothing else played. */
function runAs(vectors: { build?: string; species?: string; combatClass?: string }, seed = 4242): GameSave {
  const started = choose(enterEntryScreen(emptySave(seed), DEPS, NOW), 'welcome:start', DEPS, NOW).save
  return withVectors(started, vectors)
}

function spendMight(save: GameSave, points: number): GameSave {
  return applyEffects(
    save,
    Array.from({ length: points }, () => ({ kind: 'adjustBaseStat' as const, stat: 'might' as const, amount: 1 })),
    DEPS.content,
    NOW,
  )
}

describe('a build stacks with what the player spends', () => {
  it('leaves every one of the six points to spend, whatever the build gave', () => {
    // THE PROPERTY, across every build rather than one: a vector that wrote
    // into the base block would spend the player's allowance for them, and
    // the failure that invites is the one where it holds for the build
    // somebody tested. A Warrior origin used to begin at Might 2 and could
    // put only four more in; every build now begins at nothing spent.
    for (const build of THOCKQUEST.builds) {
      const game = activeGame(runAs({ build: build.id }))!
      for (const key of STAT_KEYS) expect(game.baseStats[key]).toBe(0)
    }
  })

  it('spends the whole tier through the weights, and no more', () => {
    // A run STARTS at tier five and every build splits exactly five points --
    // so what a build changes is the SHAPE of an opening character and never
    // how much of one there is. That is the whole reason the two vectors were
    // separated, and it is the one property that makes them comparable.
    for (const build of THOCKQUEST.builds) {
      const save = runAs({ build: build.id })
      const game = activeGame(save)!
      expect(playerTierOf(game)).toBe(BASE_PLAYER_TIER)
      const stats = profileOf(save, game, THOCKQUEST).stats
      expect(STAT_KEYS.reduce((sum, key) => sum + stats[key], 0)).toBe(BASE_PLAYER_TIER)
    }
  })

  it('reaches past the base cap, which is what gear does and what a build is', () => {
    // Six points of Might is the top of the player's own progression; the
    // build's share of the tier lands on TOP of it. Read from the build's own
    // apportionment rather than written out, so a content edit moves this
    // test's expectation with it.
    const spent = spendMight(runAs({ build: MIGHTY_BUILD }), BASE_STAT_CAP)
    const game = activeGame(spent)!
    const fromTier = statsFromTier(THOCKQUEST.builds.find((build) => build.id === MIGHTY_BUILD)!, BASE_PLAYER_TIER)
    expect(game.baseStats.might).toBe(BASE_STAT_CAP)
    expect(profileOf(spent, game, THOCKQUEST).stats.might).toBe(BASE_STAT_CAP + fromTier.might)
  })
})

describe('a species carries what is not a stat', () => {
  it('reaches the derived numbers through the modifier vocabulary', () => {
    // A Mertok is +25% hit points and -20% actions, declared in the same
    // vocabulary an item uses -- so it resolves in the same pass and needs no
    // code of its own. Compared against the SAME build, so the only
    // difference between the two characters is the species.
    const plain = runAs({ build: MIGHTY_BUILD, species: 'davalian' })
    const tough = runAs({ build: MIGHTY_BUILD, species: 'mertok' })
    const before = profileOf(plain, activeGame(plain)!, THOCKQUEST)
    const after = profileOf(tough, activeGame(tough)!, THOCKQUEST)
    expect(after.derived.maxHitPoints).toBeGreaterThan(before.derived.maxHitPoints)
    expect(after.derived.actionsPerRound).toBeLessThanOrEqual(before.derived.actionsPerRound)
  })

  it('takes worn armour away where it says so, and leaves natural armour alone', () => {
    // The trade a Mertok is FOR: no decaying pool from items, but natural
    // armour still counts, so they can be tough without ever being armoured.
    const mertok = runAs({ build: MIGHTY_BUILD, species: 'mertok' })
    const other = runAs({ build: MIGHTY_BUILD, species: 'davalian' })
    expect(profileOf(mertok, activeGame(mertok)!, THOCKQUEST).noDecayingArmor).toBe(true)
    expect(profileOf(mertok, activeGame(mertok)!, THOCKQUEST).naturalArmor).toBeGreaterThan(0)
    // And the ordinary case is untouched: nothing about worn armour changed
    // for anybody else.
    expect(profileOf(other, activeGame(other)!, THOCKQUEST).noDecayingArmor).toBe(false)
  })

  it('never carries a stat, which is the build\'s alone', () => {
    // The vector rule, asserted on the content rather than trusted. A species
    // that could hand out Might would be a second, hidden build --
    // `validateContent` says so too, and this says it where a reader of the
    // species list will see it.
    for (const species of THOCKQUEST.species) {
      expect(species.effects.some((effect) => effect.kind === 'statDelta')).toBe(false)
    }
  })
})

describe('a class carries nothing but combat choices', () => {
  it('changes no number a stat block implies', () => {
    // THE PROPERTY that keeps the fourth vector from becoming the third: two
    // runs identical but for their class must resolve to the same profile.
    // Across every class, because "it held for the one I tried" is exactly
    // how the vectors overlapped last time.
    const baseline = runAs({ build: MIGHTY_BUILD, species: 'mertok', combatClass: 'bruiser' })
    const reference = profileOf(baseline, activeGame(baseline)!, THOCKQUEST)
    for (const combatClass of THOCKQUEST.combatClasses) {
      const save = runAs({ build: MIGHTY_BUILD, species: 'mertok', combatClass: combatClass.id })
      const profile = profileOf(save, activeGame(save)!, THOCKQUEST)
      expect(profile.stats).toEqual(reference.stats)
      expect(profile.derived).toEqual(reference.derived)
      expect(profile.naturalArmor).toBe(reference.naturalArmor)
      expect(profile.noDecayingArmor).toBe(reference.noDecayingArmor)
    }
  })
})

describe('archetype builds', () => {
  it('adds the fifteen 1:1 pair archetypes, each with its own unlock', () => {
    const pairBuilds = THOCKQUEST.builds.filter((build) => Object.values(build.weights).filter((weight) => weight !== 0).length === 2)
    expect(pairBuilds).toHaveLength(15)
    expect(pairBuilds.every((build) => build.requiresUnlock === build.id)).toBe(true)
    expect(pairBuilds.every((build) => build.weights.might === 1 || build.weights.agility === 1 || build.weights.perception === 1 || build.weights.intellect === 1 || build.weights.charisma === 1 || build.weights.luck === 1)).toBe(true)
    expect(THOCKQUEST.builds.find((build) => build.id === 'might-agility')).toMatchObject({
      id: 'might-agility',
      requiresUnlock: 'might-agility',
      weights: { might: 1, agility: 1 },
    })
    expect(permanentUnlockById('might-agility')).toBeDefined()
  })

  it('is earned by maxing both stats in the pair in one run', () => {
    const unlock = permanentUnlockById('might-agility')!
    expect(unlock.isEarnedBy({ baseStats: { might: 6, agility: 6, perception: 0, intellect: 0, charisma: 0, luck: 0 } } as any)).toBe(true)
    expect(unlock.isEarnedBy({ baseStats: { might: 6, agility: 5, perception: 0, intellect: 0, charisma: 0, luck: 0 } } as any)).toBe(false)
    expect(unlock.isEarnedBy({ baseStats: { might: 5, agility: 5, perception: 1, intellect: 0, charisma: 0, luck: 0 } } as any)).toBe(false)
  })
})

describe('what a run leaves behind', () => {
  it('is not offered before it is earned', () => {
    // The Berserker is a CLASS now rather than an origin -- what was
    // distinctive about it was always how it fights, and it was trying to be
    // a stat gift and a damage percentage and an armour rule at the same
    // time. The gate is unchanged: content says what a thing requires, and
    // the screen decides whether to offer it.
    const save = choose(enterEntryScreen(emptySave(7), DEPS, NOW), 'welcome:start', DEPS, NOW).save
    // Walk to the class screen: build, then species, then class.
    let walked = save
    for (let step = 0; step < 2; step += 1) {
      walked = choose(walked, currentScreen(walked, DEPS)!.choices[0].id, DEPS, NOW).save
    }
    const offered = currentScreen(walked, DEPS)!.choices.map((choice) => choice.id)
    expect(offered).not.toContain('class:berserker')
    expect(offered.length).toBeGreaterThan(0)
  })

  it('is earned by reaching the cap in Might, and derived rather than granted', () => {
    // No effect hands this out. It falls out of the run's own state after
    // whatever effect made it true, which is why spending the sixth point is
    // all it takes and no screen has to remember to award anything.
    const five = spendMight(runAs({ build: MIGHTY_BUILD }), BASE_STAT_CAP - 1)
    expect(five.profile.unlocked).toEqual([])

    const six = spendMight(five, 1)
    expect(six.profile.unlocked).toEqual(['berserker'])
  })

  it('is not lost when the condition stops being true', () => {
    // The set only grows. Nothing takes base stats back today, but an unlock
    // that could be un-earned by a later effect is a promise the save cannot
    // keep -- and "you had it yesterday" is the one thing a permanent unlock
    // must never say.
    const earned = spendMight(runAs({ build: MIGHTY_BUILD }), BASE_STAT_CAP)
    const spentDown = applyEffects(earned, [{ kind: 'adjustBaseStat', stat: 'might', amount: -6 }], DEPS.content, NOW)
    expect(activeGame(spentDown)!.baseStats.might).toBe(0)
    expect(spentDown.profile.unlocked).toEqual(['berserker'])
  })

  it('outlives the run, and the save', () => {
    const earned = spendMight(runAs({ build: MIGHTY_BUILD }), BASE_STAT_CAP)
    const reloaded = sanitizeGameSave(JSON.parse(JSON.stringify(earned)))!
    expect(reloaded.profile.unlocked).toEqual(['berserker'])

    // A NEW run on that save can be dealt the class, which is the whole
    // point. Creation SAMPLES its vectors, so the assertion is over enough
    // seeds to be a statement about the pool rather than about one deal.
    const dealtBerserker = (seed: number) => {
      const fresh = enterEntryScreen(
        { ...reloaded, activeGameId: null, director: { stack: [], narration: [], rng: seed } },
        DEPS,
        NOW,
      )
      let walked = choose(fresh, 'welcome:start', DEPS, NOW).save
      for (let step = 0; step < 2; step += 1) {
        walked = choose(walked, currentScreen(walked, DEPS)!.choices[0].id, DEPS, NOW).save
      }
      return currentScreen(walked, DEPS)!.choices.map((choice) => choice.id).includes('class:berserker')
    }
    const seeds = Array.from({ length: 40 }, (_unused, index) => index + 1)
    expect(seeds.some(dealtBerserker)).toBe(true)

    // ...and a save that has NOT earned it is never dealt it, on any of them.
    const unearned = { ...reloaded, profile: { ...reloaded.profile, unlocked: [] } }
    const dealtWithout = seeds.some((seed) => {
      const fresh = enterEntryScreen(
        { ...unearned, activeGameId: null, director: { stack: [], narration: [], rng: seed } },
        DEPS,
        NOW,
      )
      let walked = choose(fresh, 'welcome:start', DEPS, NOW).save
      for (let step = 0; step < 2; step += 1) {
        walked = choose(walked, currentScreen(walked, DEPS)!.choices[0].id, DEPS, NOW).save
      }
      return currentScreen(walked, DEPS)!.choices.map((choice) => choice.id).includes('class:berserker')
    })
    expect(dealtWithout).toBe(false)
  })
})

describe('a run walked through creation', () => {
  it('ends up with all three content vectors set', () => {
    const game = activeGame(createdRun())!
    expect(game.buildId).not.toBeNull()
    expect(game.speciesId).not.toBeNull()
    expect(game.classId).not.toBeNull()
  })
})
