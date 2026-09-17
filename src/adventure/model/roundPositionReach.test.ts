// Whether "on the first action of a round" REACHES the fight.
//
// This is the same class of defect model/modifierReach.test.ts exists for, on
// the newest conditional: an effect that moves the tab bar and moves nothing
// in the game. It is the likeliest of the lot to fail silently, because the
// condition is resolved somewhere the effect's author never looks -- the
// profile a stage builds FOR ONE ACTION (stages/combat.ts's `actingProfile`),
// not the one the director builds once per tick.
//
// The property is two-sided and both halves matter: the effect has to FIRE at
// its position, and it has to be GATED everywhere else. An implementation that
// applied it always would pass a one-sided test and would be a different item.

import { describe, expect, it } from 'vitest'

import { buildContext, type DirectorDeps } from '../core/director'
import { applyEffects, emptySave, type GameSave } from './gameState'
import { beginRound, roundActionPosition, roundToJson, UNTOUCHED_FIGHT } from './combat'
import { resolveProfile } from './modifiers'
import { buildMonster } from './monsters'
import { NO_ARMOR } from './armor'
import { combatStage } from '../stages/combat'
import { ROOT_STAGE_ID, STAGES } from '../stages'
import { THOCKQUEST, type Content } from '../content'
import { addStats, createStatBlock } from './stats'
import type { JsonObject } from '../core/json'
import type { ModifierEffect } from './modifiers'

const NOW = 1_700_000_000_000
const OFFER = { speciesId: 'goblin', name: 'Goblin', classId: 'warrior', type: 'regular' }

/** Content whose only trait is the one under test, so nothing else can move. */
function contentWith(effects: readonly ModifierEffect[]): Content {
  return {
    ...THOCKQUEST,
    items: [],
    traits: [{ id: 'subject', kind: 'trait', name: 'Subject', icon: '', effects }],
  }
}

function holding(content: Content): GameSave {
  const started = applyEffects(emptySave(4242), [{ kind: 'startGame' }], content, NOW)
  // Sharp enough to land a blow at all: at Perception 0 against a goblin's
  // dodge, every seed in reach of this test is a miss, and a test that
  // measures nothing passes for the wrong reason.
  return applyEffects(started, [
    { kind: 'adjustBaseStat', stat: 'might', amount: 6 },
    { kind: 'adjustBaseStat', stat: 'perception', amount: 6 },
    { kind: 'adjustBaseStat', stat: 'luck', amount: 6 },
    { kind: 'acquireModifier', modifierKind: 'trait', modifierId: 'subject' },
  ], content, NOW)
}

/**
 * ONE PLAYER ATTACK, on a round built here rather than walked to -- so which
 * action of the round it is is the test's choice and not the dice's.
 *
 * `playerActionsSpent` positions the attack: nothing spent is the round's
 * first, one spent is the middle of it.
 *
 * The damage is read off the PILL rather than off the round, because a blow
 * big enough to be worth measuring kills the goblin and hands the fight to the
 * spoils screen -- which is the right behaviour and leaves no round to read.
 * The pill's arithmetic is the numbers the fight actually used
 * (stages/combatLog.ts), so it is the honest place to read one.
 */
function damageOfOneAttack(effects: readonly ModifierEffect[], playerActionsSpent: number): number {
  const content = contentWith(effects)
  const deps: DirectorDeps = { stages: STAGES, content, rootStageId: ROOT_STAGE_ID }
  const context = buildContext(holding(content), deps)
  const round = {
    ...beginRound({
      ...UNTOUCHED_FIGHT,
      playerHitPoints: context.profile?.derived.maxHitPoints ?? 100,
      playerArmor: NO_ARMOR,
      monsterDamageTaken: 0,
      monsterFleeing: false,
      playerFled: false,
    }),
    playerActionsSpent,
  }
  const state: JsonObject = {
    offer: OFFER,
    round: roundToJson(round),
    actor: 'player',
    dodgeOffered: false,
    dodgeRoll: null,
    log: [],
  }
  const transition = combatStage.resolve(state, 'combat:attack', context, SEED)
  const narration = 'narration' in transition ? transition.narration : undefined
  const entries = narration === undefined ? [] : (typeof narration === 'string' ? [narration] : [...narration])
  const blow = entries.find((entry) => entry.includes('Damage:'))
  const dealt = blow ? /Damage: (\d+)/.exec(blow) : null
  return dealt ? Number(dealt[1]) : 0
}

/** A seed whose first attack lands. Most do not, which is the game working. */
const SEED = 4

const OPENER: readonly ModifierEffect[] = [
  { kind: 'derivedPercentOnAction', derived: 'damageMultiplier', percent: 3, position: 'first' },
]
const ALWAYS: readonly ModifierEffect[] = [
  { kind: 'derivedPercent', derived: 'damageMultiplier', percent: 3 },
]
const NOTHING: readonly ModifierEffect[] = [
  { kind: 'derivedPercent', derived: 'offerChoices', percent: 1 },
]

describe('an effect that fires on the round\'s first action', () => {
  it('reaches the blow, and is worth what the same bonus is worth unconditionally', () => {
    const plain = damageOfOneAttack(NOTHING, 0)
    const opened = damageOfOneAttack(OPENER, 0)
    const always = damageOfOneAttack(ALWAYS, 0)
    expect(opened).toBeGreaterThan(plain)
    // On the first action the two are the same character, so the same blow.
    // Anything else means the condition is applied somewhere other than where
    // the unconditional one is.
    expect(opened).toBe(always)
  })

  it('does NOTHING at all in the middle of a round', () => {
    // The gate, which is the half a one-sided test would miss: an effect
    // applied always would pass the test above and be a different item.
    expect(damageOfOneAttack(OPENER, 1)).toBe(damageOfOneAttack(NOTHING, 1))
    expect(damageOfOneAttack(ALWAYS, 1)).toBeGreaterThan(damageOfOneAttack(NOTHING, 1))
  })
})

describe('where in the round an action falls', () => {
  const monster = buildMonster({
    classId: 'warrior',
    classBaseStats: addStats(createStatBlock(0), { might: 2, agility: 1 }),
    type: 'regular',
    level: 1,
    against: createStatBlock(0),
  })
  const fresh = beginRound({
    ...UNTOUCHED_FIGHT,
    playerHitPoints: 80,
    playerArmor: NO_ARMOR,
    monsterDamageTaken: 0,
    monsterFleeing: false,
    playerFled: false,
  })
  const twoActions = { actionsPerRound: 2 } as Parameters<typeof roundActionPosition>[1]

  it('reads the ROUND, not one side\'s pool', () => {
    // "The first action each round" is the first thing that happens in the
    // round, whoever does it. Read per side, an opener on Dodge -- which only
    // ever fires on a MONSTER's action -- would be permanently switched off.
    expect(roundActionPosition(fresh, twoActions, monster).first).toBe(true)
    expect(roundActionPosition({ ...fresh, monsterActionsSpent: 1 }, twoActions, monster).first).toBe(false)
  })

  it('calls an action the last one when nothing follows it, on either side', () => {
    // The monster is out of actions and the player has exactly one left, so
    // this action is the last thing in the round from either side's view.
    const spent = { ...fresh, playerActionsSpent: 1, monsterActionsSpent: 99 }
    expect(roundActionPosition(spent, twoActions, monster).last).toBe(true)
    expect(roundActionPosition(fresh, twoActions, monster).last).toBe(false)
  })

  /**
   * BOTH AT ONCE is why this is two flags and not one of three positions: a
   * round with a single action in it is genuinely its own first and its own
   * last, and a single position would have had to pick one -- switching off
   * every finisher in the game against the fastest monsters in it.
   */
  it('lets an opener and a finisher both fire on the same action', () => {
    const base = createStatBlock(0)
    const both = resolveProfile(base, [{
      id: 'both',
      kind: 'item',
      name: 'Both',
      icon: '',
      effects: [
        { kind: 'derivedPercentOnAction', derived: 'damageMultiplier', percent: 1, position: 'first' },
        { kind: 'derivedPercentOnAction', derived: 'damageMultiplier', percent: 1, position: 'last' },
      ],
    }], { items: 1, traits: 0 }, { actionPosition: { first: true, last: true } })
    const neither = resolveProfile(base, [], { items: 1, traits: 0 })
    // Additive, as every percentage of a quantity is (model/modifiers.ts):
    // +100% and +100% is triple, not quadruple.
    expect(both.derived.damageMultiplier).toBeCloseTo(neither.derived.damageMultiplier * 3, 10)
  })
})
