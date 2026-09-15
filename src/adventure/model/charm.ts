// What Charisma buys: three ways a monster's own action goes wrong for it.
//
// THE PLAYER NEVER CHOOSES ANY OF THIS, and that is the whole design. A fight
// runs to twenty actions, a level to ten fights and a run to a dozen levels;
// an ability the player has to remember to use, at a moment they have to
// notice, is an ability that makes every round slower. Charisma is the stat
// that plays itself: it is rolled when the round opens, it fires when the
// monster moves, and the reader learns what it did from the bar.
//
// TWO ROLLS, and they are different questions:
//
//   1. IS IT UP THIS ROUND? `(charisma - level) / 12`, once per effect, when
//      the round opens -- the same shape and the same divisor as a spell's
//      reach (model/spells.ts), because it is the same question about a
//      different mind. Uncontested, deliberately: what a monster's own wits
//      are worth is settled by the second roll, and contesting both would
//      charge the player for its Intellect twice.
//
//   2. DOES IT FIRE? A charm check on every action the monster takes -- base
//      zero, ten points per point of Charisma, CONTESTED against Intellect
//      like every other chance in the game (model/chance.ts). Zero base is
//      the spec's, and it is what keeps a charisma of nothing worth nothing.
//
// The effects are tried STRONGEST FIRST and the first success wins, which is
// also the order the round's pill lists them in. Two of them firing on one
// action is not a thing that can happen: the monster only has the one action
// to lose.

import { nextChance, type RngState } from '../core/rng'
import { resolveChanceWith, type StatChance } from './chance'
import type { StatBlock } from './stats'
import { REACH_DIVISOR } from './spells'
import type { Monster } from './monsters'
import type { RoundState } from './combat'

/** What one charm effect does when it fires. */
export type CharmOutcome = 'lostAction' | 'turnedOnItself' | 'died'

export interface CharmEffect {
  /** Its place in the table, and the number its availability is rolled against. */
  level: number
  name: string
  outcome: CharmOutcome
  /** What being under it means, in the words the round's pill carries. */
  line: string
}

/**
 * The table, WEAKEST FIRST as it is written and STRONGEST FIRST everywhere it
 * is used -- `rollCharms` hands back the order that matters.
 *
 * The levels are 0, 2 and 4 rather than 0, 1 and 2: the gap is the point. A
 * charisma of two has the first of them half the time and the second almost
 * never, so the stat reads as a ladder being climbed rather than as three
 * things that arrive together.
 */
export const CHARM_EFFECTS: readonly CharmEffect[] = [
  {
    level: 0,
    name: 'Distraction',
    outcome: 'lostAction',
    line: 'It may forget what it was doing',
  },
  {
    level: 2,
    name: 'Confusion',
    outcome: 'turnedOnItself',
    line: 'It may turn on itself, and never misses when it does',
  },
  {
    level: 4,
    name: 'Doom',
    outcome: 'died',
    line: 'It may simply give up and die',
  },
]

/** The glyph for all three. One mark, so the reader learns it once. */
export const CHARM_ICON = 'fa-solid fa-masks-theater'

/** `(charisma - level) / 12`, clamped -- the same divisor a spell's reach uses. */
export function charmChance(charisma: number, level: number): number {
  return Math.max(0, Math.min(1, (charisma - level) / REACH_DIVISOR))
}

/**
 * THE CHECK ITSELF, on every action the monster takes. Base zero, ten points
 * a point, contested against Intellect -- so a clever monster is a hard one
 * to talk at, which is the relation `COUNTER_STATS` already declares.
 */
export const CHARM_CHECK: StatChance = { base: 0, perPoint: 0.1, stat: 'charisma' }

/** Which effects are up this round, STRONGEST FIRST. */
export function rollCharms(charisma: number, rng: RngState): { charms: number[]; rng: RngState } {
  const charms: number[] = []
  let next = rng
  for (const effect of CHARM_EFFECTS) {
    const draw = nextChance(next, charmChance(charisma, effect.level))
    next = draw.rng
    if (draw.value) charms.push(effect.level)
  }
  return { charms: charms.sort((left, right) => right - left), rng: next }
}

export function charmAt(level: number): CharmEffect | null {
  return CHARM_EFFECTS.find((effect) => effect.level === level) ?? null
}

/** The effects a round is under, strongest first, as the things rather than the numbers. */
export function charmsOf(state: RoundState): CharmEffect[] {
  return state.charms
    .map((level) => charmAt(level))
    .filter((effect): effect is CharmEffect => effect !== null)
    .sort((left, right) => right.level - left.level)
}

export interface CharmInterception {
  effect: CharmEffect
  /** What it cost the monster, where that is a number. Zero for a lost action. */
  damage: number
  state: RoundState
}

/**
 * THE MONSTER IS ABOUT TO MOVE. Does something stop it?
 *
 * Null means no: the action goes ahead and the player is asked how they
 * answer it. Anything else means the action is ALREADY SPENT and there is
 * nothing to ask -- which is why this is rolled when the action is armed
 * rather than when a defence is chosen. Asking the player to pick a defence
 * and then telling them the blow never came would cost a press to learn that
 * nothing happened, and a press is the one thing this fight is short of.
 *
 * Strongest first, first success wins.
 */
export function interceptMonsterAction(options: {
  state: RoundState
  monster: Monster
  playerStats: StatBlock
  successAdjust?: number
  rng: RngState
}): { interception: CharmInterception | null; rng: RngState } {
  let rng = options.rng
  for (const effect of charmsOf(options.state)) {
    const draw = nextChance(rng, resolveChanceWith(CHARM_CHECK, options.playerStats, options.monster.stats, {
      side: 'player',
      successAdjust: options.successAdjust,
    }))
    rng = draw.rng
    if (!draw.value) continue

    // The action is gone either way -- that is what every one of these does
    // first, and the difference is only what it costs the monster on top.
    const spent = { ...options.state, monsterActionsSpent: options.state.monsterActionsSpent + 1 }

    if (effect.outcome === 'lostAction') {
      return { interception: { effect, damage: 0, state: spent }, rng }
    }

    if (effect.outcome === 'turnedOnItself') {
      // ALWAYS HITS, and its own plate is not between it and its own fist:
      // armour is what a defender raises against an attacker, and there is
      // only one of it here.
      const damage = Math.round(options.monster.damage)
      return {
        interception: { effect, damage, state: { ...spent, monsterDamageTaken: spent.monsterDamageTaken + damage } },
        rng,
      }
    }

    // It gives up. Whatever it had left is what the charm was worth, which is
    // also the figure the spoils screen's kill line reads.
    const left = Math.max(0, options.monster.maxHitPoints - spent.monsterDamageTaken)
    return {
      interception: { effect, damage: left, state: { ...spent, monsterDamageTaken: spent.monsterDamageTaken + left } },
      rng,
    }
  }
  return { interception: null, rng }
}
