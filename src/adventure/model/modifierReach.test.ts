// Whether a modifier's effect REACHES the thing it claims to change.
//
// The class of defect these are here for is not a wrong number, it is a
// number that moves on the tab bar and moves nothing in the game. Every one
// of them shipped: an item saying "+10% crit" while combat resolved crit from
// the stat block alone and never saw a modifier; "+25 hit points" that raised
// a ceiling nobody was standing under; an unspecified placeholder offered as
// one of two choices, neither of which did anything.

import { describe, expect, it } from 'vitest'

import { buildCatalog, THOCKQUEST } from '../content'
import { choose, currentScreen, enterEntryScreen, type DirectorDeps } from '../core/director'
import { activeGame, applyEffects, emptySave, type GameSave } from '../model/gameState'
import { isOfferable, resolveProfile, UNSPECIFIED_TAG, type Modifier } from './modifiers'
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
  catalog: buildCatalog(THOCKQUEST),
  rootStageId: ROOT_STAGE_ID,
}
const NOW = 1_700_000_000_000
const noHoldings = { items: 0, traits: 0 }
const BASE = addStats(createStatBlock(0), { might: 2, agility: 1 })

function modifier(id: string, effects: Modifier['effects']): Modifier {
  return { id, kind: 'item', name: id, icon: '', effects }
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
    const charm = modifier('charm', [{ kind: 'derivedDelta', derived: 'critChance', amount: 0.3 }])
    const plain = resolveProfile(BASE, [], noHoldings)
    const charmed = resolveProfile(BASE, [charm], noHoldings)
    expect(charmed.derived.critChance - plain.derived.critChance).toBeCloseTo(0.3, 10)

    const crits = (chances: typeof plain.chances) => frequency((rng) => {
      const result = resolveExchange({
        attacker: 'player',
        attackerStats: BASE,
        attackerDamage: 10,
        defenderStats: createStatBlock(0),
        armor: NO_ARMOR,
        armorDecayFloor: 0,
        attackerChances: chances,
        defence: 'takeTheHit',
        dodgeOffered: false,
        rng,
      })
      return { value: result.blow.crit, rng: result.rng }
    })
    expect(crits(charmed.chances) - crits(plain.chances)).toBeGreaterThan(0.2)
  })

  it('reaches the dodge roll too, which is a different call entirely', () => {
    const boots = modifier('boots', [{ kind: 'derivedDelta', derived: 'dodgeChance', amount: 0.25 }])
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
    const chalk = modifier('chalk', [{ kind: 'derivedScale', derived: 'hitChance', factor: 1.2 }])
    const profile = resolveProfile(BASE, [chalk], noHoldings)
    const landed = frequency((rng) => {
      const result = resolveExchange({
        attacker: 'player',
        attackerStats: BASE,
        attackerDamage: 10,
        defenderStats: createStatBlock(0),
        armor: NO_ARMOR,
        armorDecayFloor: 0,
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
        armorDecayFloor: 0,
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
        armorDecayFloor: 0,
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
      { kind: 'derivedScaleWhileHurt', derived: 'damageMultiplier', factor: 2, belowFraction: 0.5 },
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

  it('GRANTS what a rise in the maximum is worth, rather than merely permitting it', () => {
    const save = started()
    const before = activeGame(save)
    if (!before) throw new Error('no game')
    const wounded = applyEffects(save, [{ kind: 'adjustHitPoints', amount: -30 }], DEPS.catalog, NOW)
    const hurt = activeGame(wounded)?.hitPoints ?? 0

    const tougher = applyEffects(
      wounded,
      [{ kind: 'acquireModifier', modifierKind: 'trait', modifierId: 'iron-constitution' }],
      DEPS.catalog,
      NOW,
    )
    // Iron Constitution is +25 maximum, and the character is 25 hit points
    // sturdier for it -- not 25 hit points further from full.
    expect(activeGame(tougher)?.hitPoints).toBe(hurt + 25)
  })

  it('CLAMPS when the ceiling falls, so nobody stands above their own maximum', () => {
    const save = applyEffects(
      started(),
      [{ kind: 'acquireModifier', modifierKind: 'trait', modifierId: 'iron-constitution' }],
      DEPS.catalog,
      NOW,
    )
    const raised = activeGame(save)?.hitPoints ?? 0
    const dropped = applyEffects(
      save,
      [{ kind: 'releaseModifier', modifierKind: 'trait', modifierId: 'iron-constitution' }],
      DEPS.catalog,
      NOW,
    )
    expect(activeGame(dropped)?.hitPoints).toBe(raised - 25)
  })
})

describe('what is offered', () => {
  it('never offers something whose effect has not been decided', () => {
    const unspecified = THOCKQUEST.items
      .concat(THOCKQUEST.traits)
      .filter((entry) => entry.effects.every((effect) => effect.kind === 'tag' && effect.tag === UNSPECIFIED_TAG))
    // The placeholders are still IN content -- they are the design's own
    // names, not ours to delete -- and out of every pool that offers.
    expect(unspecified.length).toBeGreaterThan(0)
    for (const entry of unspecified) expect(isOfferable(entry)).toBe(false)

    let save = choose(enterEntryScreen(emptySave(7), DEPS, NOW), 'welcome:start', DEPS, NOW).save
    save = choose(save, 'origin:warrior', DEPS, NOW).save
    for (let step = 0; step < 40; step += 1) {
      const screen = currentScreen(save, DEPS)
      if (!screen) break
      for (const choice of screen.choices) {
        for (const entry of unspecified) expect(choice.id.endsWith(`:${entry.id}`)).toBe(false)
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
    const wounded = applyEffects(startedRun(), [{ kind: 'adjustHitPoints', amount: -40 }], DEPS.catalog, NOW)
    const before = activeGame(wounded)
    expect(before?.hitPoints).toBeLessThan(50 + 15 * (before?.baseStats.might ?? 0))

    const onward = applyEffects(wounded, [{ kind: 'advanceLevel' }], DEPS.catalog, NOW)
    const after = activeGame(onward)
    expect(after?.level).toBe((before?.level ?? 1) + 1)
    expect(after?.hitPoints).toBe(50 + 15 * (after?.baseStats.might ?? 0))
  })
})
