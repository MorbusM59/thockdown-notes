// Whether a modifier's effect REACHES the thing it claims to change.
//
// The class of defect these are here for is not a wrong number, it is a
// number that moves on the tab bar and moves nothing in the game. Every one
// of them shipped: an item saying "+10% crit" while combat resolved crit from
// the stat block alone and never saw a modifier; "+25 hit points" that raised
// a ceiling nobody was standing under; an unspecified placeholder offered as
// one of two choices, neither of which did anything.

import { describe, expect, it } from 'vitest'

import { catalogFor, THOCKQUEST } from '../content'
import { choose, currentScreen, enterEntryScreen, type DirectorDeps } from '../core/director'
import {
  activeGame, applyEffects, BASE_KEEP_ALLOWANCE, emptySave, heldModifiers, keepAllowance,
  keptModifierIds, profileOf, resolveRunProfile, withKeepMark, type GameSave,
} from '../model/gameState'
import { resolveProfile, type Modifier } from './modifiers'
import { resolveExchange, rollDodgeOffered } from './combat'
import { resolveChanceWith } from './chance'
import { buildMonster } from './monsters'
import { HIT_CHANCE } from './stats'
import { NO_ARMOR } from './armor'
import { addStats, createStatBlock } from './stats'
import { ROOT_STAGE_ID, STAGES } from '../stages'

const DEPS: DirectorDeps = {
  stages: STAGES,
  content: THOCKQUEST,
  rootStageId: ROOT_STAGE_ID,
}
const NOW = 1_700_000_000_000
const noHoldings = { items: 0, traits: 0 }
const BASE = addStats(createStatBlock(0), { might: 2, agility: 1 })

function modifier(id: string, effects: Modifier['effects']): Modifier {
  return { id, kind: 'item', name: id, icon: '', effects }
}

/** The maximum a save's active run currently has, read rather than written down. */
function maxOf(save: GameSave): number {
  const game = activeGame(save)
  if (!game) throw new Error('no game')
  return profileOf(save, game, THOCKQUEST).derived.maxHitPoints
}

/** How often a chance actually fires, over enough rolls to tell 20% from 30%. */
function frequency(roll: (rng: number) => { value: boolean; rng: number }, tries = 4000): number {
  let rng = 12345
  let hits = 0
  for (let index = 0; index < tries; index += 1) {
    const drawn = roll(rng)
    rng = drawn.rng
    if (drawn.value) hits += 1
  }
  return hits / tries
}

describe('a chance a modifier changes', () => {
  it('changes the ROLL, not only the readout', () => {
    // The bone: chances are contested at the moment they are rolled, so they
    // cannot be finished inside the profile -- combat took them from the stat
    // block and a "+30% crit" charm was decoration.
    const charm = modifier('charm', [{ kind: 'derivedPercent', derived: 'critChance', percent: 0.5 }])
    const plain = resolveProfile(BASE, [], noHoldings)
    const charmed = resolveProfile(BASE, [charm], noHoldings)
    // HALF THE ORDINARY HITS become crits: 20% base, so 20% + 80% x 50% = 60%.
    // A percentage of a probability is a percentage of the remainder
    // (model/chance.ts) -- adding fifty POINTS would have been 70%, and three
    // such items would have been a certainty.
    expect(charmed.derived.critChance).toBeCloseTo(0.6, 10)

    const crits = (chances: typeof plain.chances) => frequency((rng) => {
      const result = resolveExchange({
        attacker: 'player',
        attackerStats: BASE,
        attackerDamage: 10,
        defenderStats: createStatBlock(0),
        armor: NO_ARMOR,
        attackerChances: chances,
        defence: 'takeTheHit',
        dodgeOffered: false,
        rng,
      })
      return { value: result.blow.crit, rng: result.rng }
    })
    expect(crits(charmed.chances) - crits(plain.chances)).toBeGreaterThan(0.3)
  })

  it('reaches the dodge roll too, which is a different call entirely', () => {
    const boots = modifier('boots', [{ kind: 'derivedPercent', derived: 'dodgeChance', percent: 0.5 }])
    const plain = resolveProfile(BASE, [], noHoldings)
    const booted = resolveProfile(BASE, [boots], noHoldings)
    const offered = (adjustment: typeof plain.chances.dodgeChance) =>
      frequency((rng) => {
        const drawn = rollDodgeOffered({
          defenderStats: BASE, attackerStats: createStatBlock(0), adjustment, defender: 'player', rng,
        })
        return { value: drawn.offered, rng: drawn.rng }
      })
    expect(offered(booted.chances.dodgeChance) - offered(plain.chances.dodgeChance)).toBeGreaterThan(0.15)
  })

  it('is the SAME arithmetic on the bar and in the fight', () => {
    // Uncontested, the roll and the readout have to agree exactly, or one of
    // the two is lying to the player about what they just chose.
    const chalk = modifier('chalk', [{ kind: 'derivedPercent', derived: 'hitChance', percent: 0.2 }])
    const profile = resolveProfile(BASE, [chalk], noHoldings)
    const landed = frequency((rng) => {
      const result = resolveExchange({
        attacker: 'player',
        attackerStats: BASE,
        attackerDamage: 10,
        defenderStats: createStatBlock(0),
        armor: NO_ARMOR,
        attackerChances: profile.chances,
        defence: 'defend',
        dodgeOffered: false,
        rng,
      })
      return { value: result.blow.hit, rng: result.rng }
    })
    expect(landed).toBeCloseTo(profile.derived.hitChance, 1)
  })
})

describe('the thumb on the scale', () => {
  const monster = () => buildMonster({
    classId: 'warrior',
    classBaseStats: addStats(createStatBlock(0), { might: 2, agility: 1 }),
    type: 'regular',
    level: 1,
    against: BASE,
  })

  /** A whole fight's worth of exchanges, both sides, at one thumb setting. */
  function trade(successAdjust: number) {
    const foe = monster()
    const profile = resolveProfile(BASE, [], noHoldings)
    let rng = 999
    let landed = 0
    let suffered = 0
    for (let index = 0; index < 2000; index += 1) {
      const mine = resolveExchange({
        attacker: 'player',
        attackerStats: BASE,
        attackerDamage: 10,
        defenderStats: foe.stats,
        armor: NO_ARMOR,
        attackerChances: profile.chances,
        successAdjust,
        defence: 'defend',
        dodgeOffered: false,
        rng,
      })
      rng = mine.rng
      if (mine.blow.hit) landed += 1
      const theirs = resolveExchange({
        attacker: 'monster',
        attackerStats: foe.stats,
        attackerDamage: 10,
        defenderStats: BASE,
        armor: NO_ARMOR,
        successAdjust,
        defence: 'defend',
        dodgeOffered: false,
        rng,
      })
      rng = theirs.rng
      if (theirs.blow.hit) suffered += 1
    }
    return { landed: landed / 2000, suffered: suffered / 2000 }
  }

  it('reaches the fight in both directions at once', () => {
    const even = trade(0)
    const weighted = trade(0.5)
    expect(weighted.landed).toBeGreaterThan(even.landed + 0.15)
    expect(weighted.suffered).toBeLessThan(even.suffered - 0.15)
  })

  it('is total at one, which is what makes it a scale rather than a bonus', () => {
    const decided = trade(1)
    expect(decided.landed).toBe(1)
    expect(decided.suffered).toBe(0)
  })

  it('reaches whether DODGE is offered, on the right side each time', () => {
    const foe = monster()
    const offered = (defender: 'player' | 'monster', successAdjust: number) => frequency((rng) => {
      const drawn = rollDodgeOffered({
        defenderStats: defender === 'player' ? BASE : foe.stats,
        attackerStats: defender === 'player' ? foe.stats : BASE,
        defender,
        successAdjust,
        rng,
      })
      return { value: drawn.offered, rng: drawn.rng }
    })
    // The player's own dodge is a player success, so the thumb raises it; the
    // monster's is a monster success, so the same setting lowers it.
    expect(offered('player', 0.5)).toBeGreaterThan(offered('player', 0) + 0.1)
    expect(offered('monster', 0.5)).toBeLessThan(offered('monster', 0) - 0.1)
  })

  it('does NOT touch what the character is worth', () => {
    // The thumb belongs to the run's tuning, not to the character, so nothing
    // on the tab bar and nothing a stat point promises moves with it. A
    // profile takes no thumb at all, which is how that is enforced.
    const profile = resolveProfile(BASE, [], noHoldings)
    expect(profile.derived.hitChance).toBeCloseTo(
      resolveChanceWith(HIT_CHANCE, BASE, null, {}),
      10,
    )
  })
})

describe('a conditional effect', () => {
  it('fires only while the character is actually hurt', () => {
    const cornered = modifier('cornered', [
      { kind: 'derivedPercentWhileHurt', derived: 'damageMultiplier', percent: 1, belowFraction: 0.5 },
    ])
    const whole = resolveProfile(BASE, [cornered], noHoldings, { hitPoints: 80 })
    const bleeding = resolveProfile(BASE, [cornered], noHoldings, { hitPoints: 10 })
    expect(bleeding.derived.damageMultiplier).toBeCloseTo(whole.derived.damageMultiplier * 2, 10)
    // And with no situation at all it is simply not in force, rather than
    // being half applied: a caller asking "what is this character worth"
    // gets the unconditional answer.
    expect(resolveProfile(BASE, [cornered], noHoldings).derived.damageMultiplier)
      .toBeCloseTo(whole.derived.damageMultiplier, 10)
  })
})

describe('hit points following their ceiling', () => {
  function started(): GameSave {
    const save = enterEntryScreen(emptySave(4242), DEPS, NOW)
    let playing = choose(save, 'welcome:start', DEPS, NOW).save
    playing = choose(playing, 'origin:warrior', DEPS, NOW).save
    // Through the trait and the item, which is where creation fills them.
    for (let step = 0; step < 2; step += 1) {
      const screen = currentScreen(playing, DEPS)
      if (!screen) throw new Error('no screen')
      playing = choose(playing, screen.choices[0].id, DEPS, NOW).save
    }
    return playing
  }

  /**
   * A TRAIT THIS RUN ROLLED A HIT-POINT BONUS ONTO. Named by the roll rather
   * than by the test: every modifier is a template now
   * (model/modifierSlots.ts), so "Iron Constitution raises the maximum" is
   * true of most runs and not of all of them, and a test that assumed it would
   * fail on the seeds where it rolled its other line instead.
   */
  function sturdyTrait(save: GameSave): string {
    const game = activeGame(save)
    if (!game) throw new Error('no game')
    const catalog = catalogFor(THOCKQUEST, game.seed)
    const found = THOCKQUEST.traits
      .map((template) => catalog.get(template.id))
      .find((trait) => trait?.effects.some(
        (effect) => effect.kind === 'derivedPercent' && effect.derived === 'maxHitPoints',
      ))
    if (!found) throw new Error('no trait in this run raises the maximum')
    return found.id
  }

  it('GRANTS what a rise in the maximum is worth, rather than merely permitting it', () => {
    const save = started()
    const before = activeGame(save)
    if (!before) throw new Error('no game')
    const wounded = applyEffects(save, [{ kind: 'adjustHitPoints', amount: -30 }], DEPS.content, NOW)
    const hurt = activeGame(wounded)?.hitPoints ?? 0

    const tougher = applyEffects(
      wounded,
      [{ kind: 'acquireModifier', modifierKind: 'trait', modifierId: sturdyTrait(wounded) }],
      DEPS.content,
      NOW,
    )
    // Iron Constitution is a PERCENTAGE of the maximum now, so the expected
    // rise is read from the profile rather than written down -- the property
    // under test is that the character is exactly that much sturdier, not
    // that much further from full.
    const gained = maxOf(tougher) - maxOf(wounded)
    expect(gained).toBeGreaterThan(0)
    expect(activeGame(tougher)?.hitPoints).toBe(hurt + gained)
  })

  it('CLAMPS when the ceiling falls, so nobody stands above their own maximum', () => {
    const fresh = started()
    const sturdy = sturdyTrait(fresh)
    const save = applyEffects(
      fresh,
      [{ kind: 'acquireModifier', modifierKind: 'trait', modifierId: sturdy }],
      DEPS.content,
      NOW,
    )
    const raised = activeGame(save)?.hitPoints ?? 0
    const dropped = applyEffects(
      save,
      [{ kind: 'releaseModifier', modifierKind: 'trait', modifierId: sturdy }],
      DEPS.content,
      NOW,
    )
    expect(activeGame(dropped)?.hitPoints).toBe(raised - (maxOf(save) - maxOf(dropped)))
  })
})

describe('what is offered', () => {
  /**
   * THE "UNSPECIFIED" STATE IS GONE, and the test that guarded it with it.
   *
   * Five entries used to exist by name and carry a tag saying their effect had
   * not been decided, kept out of every pool that offers so that a choice
   * between two of them could not happen. Every modifier is rolled from a
   * template now (`model/modifierSlots.ts`) and a template always rolls into
   * something, so the state cannot arise -- and a guard over a case that
   * cannot arise is a guard nobody can ever delete.
   *
   * What is still worth asserting is the half of that rule which never
   * depended on the tag: a cell in the ring is a thing that DOES something.
   */
  it('never offers a modifier with no effects at all', () => {
    let save = choose(enterEntryScreen(emptySave(7), DEPS, NOW), 'welcome:start', DEPS, NOW).save
    save = choose(save, 'origin:warrior', DEPS, NOW).save
    for (let step = 0; step < 40; step += 1) {
      const screen = currentScreen(save, DEPS)
      if (!screen) break
      const game = activeGame(save)
      const catalog = game ? catalogFor(THOCKQUEST, game.seed) : null
      for (const choice of screen.choices) {
        const named = [...(catalog?.values() ?? [])].find((modifier) => choice.id.endsWith(`:${modifier.id}`))
        if (named) expect(named.effects.length).toBeGreaterThan(0)
      }
      save = choose(save, screen.choices[0].id, DEPS, NOW).save
    }
  })
})

describe('the level boundary', () => {
  function startedRun(): GameSave {
    const save = enterEntryScreen(emptySave(4242), DEPS, NOW)
    let playing = choose(save, 'welcome:start', DEPS, NOW).save
    playing = choose(playing, 'origin:warrior', DEPS, NOW).save
    for (let step = 0; step < 2; step += 1) {
      const screen = currentScreen(playing, DEPS)
      if (!screen) throw new Error('no screen')
      playing = choose(playing, screen.choices[0].id, DEPS, NOW).save
    }
    return playing
  }

  it('RESETS the hit-point budget, because a level is its own journey', () => {
    // Hit points are the budget for ONE level: they wear down encounter by
    // encounter with nothing to restore them, and the rest between levels is
    // what refills them. Not healing -- a level boundary, in the same place
    // armor is rebuilt.
    const wounded = applyEffects(startedRun(), [{ kind: 'adjustHitPoints', amount: -40 }], DEPS.content, NOW)
    const before = activeGame(wounded)
    // Against the maximum as the run actually stands, not against the bare
    // stat formula: what creation handed out can carry a percentage of the
    // pool with it now, so `50 + 15 x Might` is no longer the ceiling.
    expect(before?.hitPoints).toBeLessThan(maxOf(wounded))

    const onward = applyEffects(wounded, [{ kind: 'advanceLevel' }], DEPS.content, NOW)
    const after = activeGame(onward)
    expect(after?.level).toBe((before?.level ?? 1) + 1)
    expect(after?.hitPoints).toBe(maxOf(onward))
  })
})

describe('what survives a level', () => {
  /** A run holding two items and two traits, in acquisition order. */
  function carrying(): GameSave {
    const save = enterEntryScreen(emptySave(4242), DEPS, NOW)
    let playing = choose(save, 'welcome:start', DEPS, NOW).save
    playing = choose(playing, 'origin:warrior', DEPS, NOW).save
    for (let step = 0; step < 2; step += 1) {
      const screen = currentScreen(playing, DEPS)
      if (!screen) throw new Error('no screen')
      playing = choose(playing, screen.choices[0].id, DEPS, NOW).save
    }
    return applyEffects(playing, [
      { kind: 'acquireModifier', modifierKind: 'item', modifierId: 'whetstone' },
      { kind: 'acquireModifier', modifierKind: 'trait', modifierId: 'second-skin' },
    ], DEPS.content, NOW)
  }

  const heldIds = (save: GameSave) => save.holdings.map((row) => row.modifierId)

  it('keeps the LAST acquired of each kind when nothing is marked', () => {
    // Not a fallback for an error case: it is the rule for a player who never
    // touched the marks, and it is the newest find because that is the one
    // they have had least use out of.
    const save = carrying()
    expect(heldIds(save)).toHaveLength(4)
    const onward = applyEffects(save, [{ kind: 'advanceLevel' }], DEPS.content, NOW)
    expect(heldIds(onward).sort()).toEqual(['second-skin', 'whetstone'])
  })

  it('keeps what was MARKED instead, one of each kind', () => {
    const save = carrying()
    const firstItem = save.holdings.find((row) => row.kind === 'item')
    const firstTrait = save.holdings.find((row) => row.kind === 'trait')
    if (!firstItem || !firstTrait) throw new Error('nothing held')

    let marked = withKeepMark(save, 'item', firstItem.modifierId)
    marked = withKeepMark(marked, 'trait', firstTrait.modifierId)
    const onward = applyEffects(marked, [{ kind: 'advanceLevel' }], DEPS.content, NOW)
    expect(heldIds(onward).sort()).toEqual([firstTrait.modifierId, firstItem.modifierId].sort())
  })

  it('is a TOGGLE: pressing the marked one again gives the default back', () => {
    const save = carrying()
    const firstItem = save.holdings.find((row) => row.kind === 'item')
    if (!firstItem) throw new Error('nothing held')
    const marked = withKeepMark(save, 'item', firstItem.modifierId)
    expect(activeGame(marked)?.keepItemIds).toEqual([firstItem.modifierId])
    const cleared = withKeepMark(marked, 'item', firstItem.modifierId)
    expect(activeGame(cleared)?.keepItemIds).toEqual([])
    expect(heldIds(applyEffects(cleared, [{ kind: 'advanceLevel' }], DEPS.content, NOW))).toContain('whetstone')
  })

  it('sets out FULL, at the maximum the survivors allow', () => {
    // The order is the rule: restore against the maximum as it stands with
    // everything held, THEN release, and let the ceiling rule bring the pool
    // down to the new maximum. A run must never start a level part-empty.
    const save = applyEffects(carrying(), [{ kind: 'adjustHitPoints', amount: -40 }], DEPS.content, NOW)
    const onward = applyEffects(save, [{ kind: 'advanceLevel' }], DEPS.content, NOW)
    const game = activeGame(onward)
    if (!game) throw new Error('no game')
    // Through the RUN's resolver, not a hand-assembled one: a run's profile
    // includes its class, and an expectation built without it is measuring a
    // character nobody is playing.
    const max = resolveRunProfile(
      game,
      THOCKQUEST,
      heldModifiers(onward, game.id, catalogFor(THOCKQUEST, game.seed)),
    ).derived.maxHitPoints
    expect(game.hitPoints).toBe(max)
  })

  it('spends the marks, so the next level decides for itself', () => {
    const save = carrying()
    const firstItem = save.holdings.find((row) => row.kind === 'item')
    if (!firstItem) throw new Error('nothing held')
    const onward = applyEffects(withKeepMark(save, 'item', firstItem.modifierId), [{ kind: 'advanceLevel' }], DEPS.content, NOW)
    expect(activeGame(onward)?.keepItemIds).toEqual([])
  })
})

describe('one of each thing, ever', () => {
  function started(): GameSave {
    const save = enterEntryScreen(emptySave(4242), DEPS, NOW)
    let playing = choose(save, 'welcome:start', DEPS, NOW).save
    playing = choose(playing, 'origin:warrior', DEPS, NOW).save
    for (let step = 0; step < 2; step += 1) {
      const screen = currentScreen(playing, DEPS)
      if (!screen) throw new Error('no screen')
      playing = choose(playing, screen.choices[0].id, DEPS, NOW).save
    }
    return playing
  }

  it('declines a second copy, wherever it is asked for', () => {
    // Two copies of an item are not two items: every effect it carries is
    // declarative and would simply apply twice. The guard is at the
    // ACQUISITION, not only in the pools that offer -- an offer filter is a
    // rule stated at one caller, and this is its sibling.
    const once = applyEffects(started(), [
      { kind: 'acquireModifier', modifierKind: 'item', modifierId: 'whetstone' },
    ], DEPS.content, NOW)
    const twice = applyEffects(once, [
      { kind: 'acquireModifier', modifierKind: 'item', modifierId: 'whetstone' },
    ], DEPS.content, NOW)
    expect(twice.holdings.filter((row) => row.modifierId === 'whetstone')).toHaveLength(1)
    expect(twice.holdings).toEqual(once.holdings)
  })

  it('never OFFERS what is already held, so the choice is never a non-choice', () => {
    let save = started()
    for (let step = 0; step < 60; step += 1) {
      const screen = currentScreen(save, DEPS)
      if (!screen) break
      const held = new Set(save.holdings.map((row) => row.modifierId))
      for (const choice of screen.choices) {
        for (const id of held) expect(choice.id.endsWith(`:${id}`)).toBe(false)
      }
      save = choose(save, screen.choices[0].id, DEPS, NOW).save
    }
  })
})

describe('how many survive', () => {
  function carryingThree(): GameSave {
    const save = enterEntryScreen(emptySave(99), DEPS, NOW)
    let playing = choose(save, 'welcome:start', DEPS, NOW).save
    playing = choose(playing, 'origin:warrior', DEPS, NOW).save
    for (let step = 0; step < 2; step += 1) {
      const screen = currentScreen(playing, DEPS)
      if (!screen) throw new Error('no screen')
      playing = choose(playing, screen.choices[0].id, DEPS, NOW).save
    }
    return applyEffects(playing, [
      { kind: 'acquireModifier', modifierKind: 'item', modifierId: 'whetstone' },
      { kind: 'acquireModifier', modifierKind: 'item', modifierId: 'iron-buckler' },
    ], DEPS.content, NOW)
  }

  it('lights exactly the allowance, marked first and newest after', () => {
    const save = carryingThree()
    const game = activeGame(save)
    if (!game) throw new Error('no game')
    expect(keepAllowance(game, 'item')).toBe(BASE_KEEP_ALLOWANCE)
    // Nothing marked: the newest find.
    expect(keptModifierIds(save, game, 'item')).toEqual(['iron-buckler'])

    const marked = withKeepMark(save, 'item', 'whetstone')
    const markedGame = activeGame(marked)
    if (!markedGame) throw new Error('no game')
    expect(keptModifierIds(marked, markedGame, 'item')).toEqual(['whetstone'])
  })

  it('drops the OLDEST mark when the allowance is full, rather than refusing', () => {
    // With an allowance of one this is what makes a press move the choice
    // instead of doing nothing; with a larger one it is what lets a set be
    // rearranged without emptying it first.
    let save = withKeepMark(carryingThree(), 'item', 'whetstone')
    save = withKeepMark(save, 'item', 'iron-buckler')
    expect(activeGame(save)?.keepItemIds).toEqual(['iron-buckler'])
  })

  it('keeps as many as the allowance says, not as many as it was written for', () => {
    // The property the number is a function for: raise it (a fame unlock is
    // expected to) and the level's end keeps more, with no other change.
    const save = carryingThree()
    const game = activeGame(save)
    if (!game) throw new Error('no game')
    const held = save.holdings.filter((row) => row.kind === 'item').length
    expect(held).toBeGreaterThanOrEqual(2)
    expect(keptModifierIds(save, game, 'item')).toHaveLength(Math.min(keepAllowance(game, 'item'), held))
  })

  it('ignores a mark for something no longer held', () => {
    const save = withKeepMark(carryingThree(), 'item', 'a-thing-that-was-never-held')
    const game = activeGame(save)
    if (!game) throw new Error('no game')
    expect(keptModifierIds(save, game, 'item')).toEqual(['iron-buckler'])
  })
})
