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
        const drawn = rollDodgeOffered(BASE, createStatBlock(0), rng, adjustment)
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
