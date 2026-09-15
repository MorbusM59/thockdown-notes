// PREPARE: the one action that does nothing now.
//
// The fight's whole shape is that a player should not have to weigh two
// damage numbers twenty times a round -- so the ring is sorted strongest
// first and pressing it is playing well. Prepare is the exception that proves
// it, and it earns the exception by being a single decision with a single
// consequence: skip this action, and the next ATTACK is worth every stat you
// have at once.
//
// What it turns each stat into, per point, all at the same ten percent:
//
//   might       more damage
//   perception  more chance to land
//   luck        more chance to crit
//   agility     a chance to swing TWICE
//   charisma    a chance to take the rest of its round away
//
// ...and the strongest spell in reach rides along for free, on top of the
// attack rather than instead of it. Intellect is therefore in the list too,
// through the hand the round was dealt (model/spells.ts).
//
// The four stats that were already worth something in a fight are worth the
// same thing again here, and the two that were not -- Charisma and Intellect
// -- arrive as the two that turn a prepared attack into an event. That is the
// point of the action: it is the one place the whole stat block is spent at
// once, so a character built any way at all has something to do with it.
//
// SPENT BY AN ATTACK AND NOTHING ELSE. A spell cast while prepared leaves the
// preparation banked -- "the next attack" is the spec's wording and a spell
// is its own thing, with its own rider waiting. And it is a FLAG, not a
// count: two banked preparations would be a resource to hoard, which is the
// opposite of a fight with no time to think in.

import { nextChance, type RngState } from '../core/rng'
import type { ChanceAdjustment } from './chance'
import type { Blow, RoundState } from './combat'
import { monsterActionsLeft, resolvePlayerAttack } from './combat'
import type { Monster } from './monsters'
import { castSpell, strongestOffered, type Spell } from './spells'
import type { DerivedStats, StatBlock } from './stats'

/** What one point of any stat is worth to a prepared attack. One number, five uses. */
export const PREPARE_PER_POINT = 0.1

export const PREPARE_ICON = 'fa-solid fa-crosshairs'

/** What a prepared attack would do, in the words the ring's detail pill shows. */
export function prepareLines(stats: StatBlock, rider: Spell | null): string[] {
  const percent = (points: number) => Math.round(points * PREPARE_PER_POINT * 100)
  return [
    `+${percent(stats.might)}% damage, +${percent(stats.perception)}% to land, +${percent(stats.luck)}% to crit`,
    `${percent(stats.agility)}% to strike twice, ${percent(stats.charisma)}% to end its round`,
    rider ? `${rider.name} rides along with it` : 'No spell in reach to ride along',
  ]
}

interface PreparedInput {
  state: RoundState
  monster: Monster
  playerStats: StatBlock
  playerDerived: DerivedStats
  playerChances?: Readonly<Record<'hitChance' | 'critChance', ChanceAdjustment>>
  successAdjust?: number
  rng: RngState
}

export interface PreparedAttack {
  state: RoundState
  /** One per swing: two of them when Agility came up. */
  blows: Blow[]
  /** Whether Charisma came up and took the rest of its round away. */
  stunned: boolean
  /** The spell that rode along, and what it did. Null when nothing was in reach. */
  rider: { spell: Spell; blows: Blow[] } | null
  rng: RngState
}

/**
 * A banked preparation, spent.
 *
 * ORDER MATTERS in exactly one place: the swings land before the stun, so a
 * monster whose round is taken away has already been hit for it. Everything
 * else here is independent.
 *
 * The rider fires ONCE however many times the attack swung. "On top of its
 * regular attack" is one spell on one action, and a doubled Meteor would be
 * a round the fight never recovers from -- which is not what a ten-percent
 * chance should be able to buy.
 */
export function resolvePreparedAttack(input: PreparedInput): PreparedAttack {
  const stats = input.playerStats
  const bump = (adjustment: ChanceAdjustment | undefined, points: number): ChanceAdjustment => ({
    scale: adjustment?.scale ?? 1,
    // A DELTA, not a scale: the spec says "+10% hit chance per point", which
    // is points added to the chance, and it composes with whatever an item
    // already did to the same roll (model/chance.ts).
    delta: (adjustment?.delta ?? 0) + points * PREPARE_PER_POINT,
  })

  const sharpened: DerivedStats = {
    ...input.playerDerived,
    damageMultiplier: input.playerDerived.damageMultiplier * (1 + stats.might * PREPARE_PER_POINT),
  }
  const chances = {
    hitChance: bump(input.playerChances?.hitChance, stats.perception),
    critChance: bump(input.playerChances?.critChance, stats.luck),
  }

  // TWICE is decided before either swing, so the two are one decision rather
  // than a second roll the first swing's outcome could colour.
  const twice = nextChance(input.rng, Math.min(1, stats.agility * PREPARE_PER_POINT))
  let rng = twice.rng
  // The preparation is spent HERE, whatever else follows -- there is no path
  // out of this function that leaves it banked.
  let state: RoundState = { ...input.state, prepared: false }
  const blows: Blow[] = []

  for (let swing = 0; swing < (twice.value ? 2 : 1); swing += 1) {
    const struck = resolvePlayerAttack({
      state,
      monster: input.monster,
      playerStats: stats,
      playerDerived: sharpened,
      playerChances: chances,
      successAdjust: input.successAdjust,
      rng,
    })
    // The SECOND swing is free: one action was spent, however many times it
    // landed. `resolvePlayerAttack` spends one each time, so the extra is
    // given back rather than the attack being resolved some other way --
    // which would be a second copy of the exchange to keep in step.
    state = swing === 0
      ? struck.state
      : { ...struck.state, playerActionsSpent: struck.state.playerActionsSpent - 1 }
    blows.push(struck.blow)
    rng = struck.rng
  }

  const stun = nextChance(rng, Math.min(1, stats.charisma * PREPARE_PER_POINT))
  rng = stun.rng
  if (stun.value) {
    state = { ...state, monsterActionsSpent: state.monsterActionsSpent + monsterActionsLeft(state, input.monster) }
  }

  const spell = strongestOffered(state.spellReach, state)
  let rider: PreparedAttack['rider'] = null
  if (spell) {
    const cast = castSpell({
      spell,
      state,
      monster: input.monster,
      playerStats: stats,
      playerDerived: sharpened,
      playerChances: chances,
      successAdjust: input.successAdjust,
      rng,
      // It rides on the attack's action. Nothing extra is spent.
      spendsAction: false,
    })
    state = cast.state
    rng = cast.rng
    rider = { spell, blows: cast.blows }
  }

  return { state, blows, stunned: stun.value, rider, rng }
}
