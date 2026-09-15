// What Intellect buys: six magical attacks, and the rule that decides which
// of them you have this round.
//
// AVAILABILITY IS ROLLED, NOT EARNED. Each level has a chance of
// `(intellect - level) / 12` to come within reach, and reaching a level
// brings every lower one with it -- so the whole table collapses to ONE
// NUMBER per round, the highest level that came up (`spellReach`), with -1
// meaning none. That is why nothing stores a set: a set could express
// "Meteor but not Singe", which the rule says cannot happen.
//
// ONCE A ROUND, at the same moment the charm effects are rolled
// (model/charm.ts) and for the same reason: a hand that changed under the
// player mid-round would make the ring's first cell a moving target, and the
// ring's first cell is what a fast player presses. A round is the hand.
//
// MAGIC CANNOT MISS, CANNOT BE DODGED, AND IGNORES ARMOUR. All three fall
// out of one line -- the strike is resolved with `defence: 'magic'`
// (model/combat.ts), which skips the hit roll and never consults the
// defender's plate -- and the dodge roll is simply not taken, rather than
// taken and discarded. It is what armour is FOR, on both sides: a plated
// monster is the problem Intellect answers.
//
// The CRIT roll stays. A spell is an attack, and Luck is what a crit reads.

import { nextChance, type RngState } from '../core/rng'
import { CRIT_CHANCE, type DerivedStats, type StatBlock } from './stats'
import { resolveChanceWith, type ChanceAdjustment } from './chance'
import { damageFrom, type Monster } from './monsters'
import { monsterActionsLeft, resolveExchange, type Blow, type RoundState } from './combat'
import { NO_SPELLS } from './spellReach'

export const SPELL_IDS = ['singe', 'plague', 'ignite', 'lightningBolt', 'lightningStorm', 'meteor'] as const

export type SpellId = (typeof SPELL_IDS)[number]

/**
 * HOW A SPELL LANDS, which is the only thing about it the fight branches on.
 *
 *  - `strike`  happens now and is over: damage, and possibly something else
 *              to the round.
 *  - `lasting` sets a condition that pays out at the END of every round from
 *              here on. Casting it again would do nothing, so it is not
 *              offered again -- see `spellsOffered`.
 *  - `stacking` is the same except that a second cast is worth a second
 *              helping, so it stays on the ring.
 */
export type SpellKind = 'strike' | 'lasting' | 'stacking'

export interface Spell {
  id: SpellId
  /** Its place in the table, and the number its availability is rolled against. */
  level: number
  name: string
  icon: string
  kind: SpellKind
  /** What it does, in the words the ring's detail pill shows. */
  lines: readonly string[]
}

/**
 * The table, in level order, which is also the order of `SPELL_IDS`.
 *
 * Singe is the floor on purpose: at Intellect 1 a player's whole magic is
 * "your attack cannot miss and goes through plate", which is a real answer
 * to an armoured elite without being a second attack to think about. Every
 * level above it is either a bigger version of that or a debuff that keeps
 * paying while you go back to attacking -- nothing here asks the player to
 * plan, which is the whole constraint the fight is built under.
 */
export const SPELLS: readonly Spell[] = [
  {
    id: 'singe',
    level: 0,
    name: 'Singe',
    icon: 'fa-solid fa-fire-flame-simple',
    kind: 'strike',
    lines: ['An attack that cannot miss', 'Straight through armour'],
  },
  {
    id: 'plague',
    level: 1,
    name: 'Plague',
    icon: 'fa-solid fa-disease',
    kind: 'lasting',
    lines: ['A fifth of what it has left, at the end of every round', 'Once is enough'],
  },
  {
    id: 'ignite',
    level: 2,
    // Singe already holds the plain flame, and these two must not read as one
    // spell at a glance: the curved flame is the one that keeps burning.
    icon: 'fa-solid fa-fire-flame-curved',
    name: 'Ignite',
    kind: 'stacking',
    lines: ['It burns for every action it takes', 'Cast again and it burns worse'],
  },
  {
    id: 'lightningBolt',
    level: 3,
    name: 'Lightning Bolt',
    icon: 'fa-solid fa-bolt-lightning',
    kind: 'strike',
    lines: ['An attack that cannot miss', 'And leaps again on a Luck check, until it does not'],
  },
  {
    id: 'lightningStorm',
    level: 4,
    name: 'Lightning Storm',
    icon: 'fa-solid fa-cloud-bolt',
    kind: 'lasting',
    lines: ['A bolt at the end of every round', 'Once is enough'],
  },
  {
    id: 'meteor',
    level: 5,
    name: 'Meteor Strike',
    icon: 'fa-solid fa-meteor',
    kind: 'strike',
    lines: ['Double damage, through armour', 'And it acts no more this round'],
  },
]

export { NO_SPELLS }

export function spellAt(level: number): Spell | null {
  return SPELLS.find((spell) => spell.level === level) ?? null
}

/**
 * THE DIVISOR, on both of the two rolls a round opens with -- a spell's reach
 * and a charm effect's (model/charm.ts).
 *
 * It sits here rather than in each because the two are one rule wearing two
 * hats: what a mind of six is worth against a thing of level N. Six is the
 * base stat cap, so `(6 - 0) / 12` is a half and the ceiling on the whole
 * table is what gear carries you past.
 */
export const REACH_DIVISOR = 12

/** `(intellect - level) / 12`, clamped. Zero Intellect is no magic at all. */
export function spellChance(intellect: number, level: number): number {
  return Math.max(0, Math.min(1, (intellect - level) / REACH_DIVISOR))
}

/**
 * How far up the table this round reaches: the HIGHEST level that came up,
 * and everything below it comes with it.
 *
 * Every level is rolled, not just the top one, which is what makes a high
 * Intellect feel like a wide hand rather than a single lottery: a mind of
 * five fails Meteor most rounds and still has Lightning Storm more often
 * than not.
 */
export function rollSpellReach(intellect: number, rng: RngState): { reach: number; rng: RngState } {
  let reach = NO_SPELLS
  let next = rng
  for (const spell of SPELLS) {
    const draw = nextChance(next, spellChance(intellect, spell.level))
    next = draw.rng
    if (draw.value) reach = Math.max(reach, spell.level)
  }
  return { reach, rng: next }
}

/**
 * What the ring offers this round, STRONGEST FIRST -- which is what makes
 * pressing the first cell the right play without the player reading anything.
 *
 * A `lasting` spell already in effect is ABSENT rather than offered and
 * wasted. That is the same rule "you cannot afford this" follows: an action
 * with nothing to do does not appear, because the alternative is a first cell
 * that is sometimes a mistake -- and a first cell that is sometimes a mistake
 * is a fight the player has to read.
 */
export function spellsOffered(reach: number, state: RoundState): Spell[] {
  return SPELLS
    .filter((spell) => spell.level <= reach)
    .filter((spell) => {
      if (spell.id === 'plague') return !state.plagued
      if (spell.id === 'lightningStorm') return !state.storming
      return true
    })
    .sort((left, right) => right.level - left.level)
}

/** The strongest thing in reach, which is what a prepared attack fires alongside itself. */
export function strongestOffered(reach: number, state: RoundState): Spell | null {
  return spellsOffered(reach, state)[0] ?? null
}

/** What a spell's damage is measured in: one ordinary attack of this character's. */
export function magicalDamage(playerDerived: DerivedStats): number {
  return damageFrom(playerDerived.damageMultiplier)
}

/** The bolt's chance to leap again. `base` is the spec's 50%; the step is Luck's own. */
export const LIGHTNING_REPEAT_CHANCE = { base: 0.5, perPoint: 0.1, stat: 'luck' } as const

/**
 * How many times a bolt may leap in total.
 *
 * NOT a rule, a TERMINATOR. The repeat chance is contested Luck on a base of
 * a half and reaches certainty at ten points of it, at which the chain would
 * never end -- an unbounded loop in a pure function nothing can interrupt. It
 * is named rather than buried so the number is the author's to set, and it is
 * high enough that a bolt reaching it is already an extraordinary round.
 */
export const LIGHTNING_MAX_STRIKES = 10

interface CastInput {
  spell: Spell
  state: RoundState
  monster: Monster
  playerStats: StatBlock
  playerDerived: DerivedStats
  playerChances?: Readonly<Record<'hitChance' | 'critChance', ChanceAdjustment>>
  successAdjust?: number
  rng: RngState
  /**
   * Whether this cast SPENDS the player's action. False for the spell a
   * prepared attack fires alongside itself, which rides on the attack's own.
   */
  spendsAction?: boolean
  /** Multiplier on the strike, for a prepared attack's sharpened damage. */
  damageScale?: number
}

export interface CastResult {
  state: RoundState
  /** Every blow this cast landed, in order. Empty for a spell that only sets a condition. */
  blows: Blow[]
  rng: RngState
}

/** One magical blow: no hit roll, no dodge, no armour, crit as usual. */
function magicStrike(input: CastInput, damage: number, rng: RngState): { blow: Blow; rng: RngState } {
  const exchange = resolveExchange({
    attackerStats: input.playerStats,
    attackerDamage: damage,
    defenderStats: input.monster.stats,
    armor: input.monster.armor,
    armorDecayFloor: 0,
    attackerChances: input.playerChances,
    attacker: 'player',
    successAdjust: input.successAdjust,
    // The whole of "cannot miss, cannot be dodged, ignores armour", in one
    // word the exchange already understands.
    defence: 'magic',
    dodgeOffered: false,
    rng,
  })
  return { blow: exchange.blow, rng: exchange.rng }
}

/**
 * A spell, cast. Pure, and the only place a spell's rules are written.
 *
 * The action is spent HERE rather than by the caller, so a spell and an
 * attack cost the same thing in the same way -- and so the one cast that
 * does NOT cost an action (a prepared attack's rider) says so by asking.
 */
export function castSpell(input: CastInput): CastResult {
  const spent = input.spendsAction === false
    ? input.state
    : { ...input.state, playerActionsSpent: input.state.playerActionsSpent + 1 }
  const scale = input.damageScale ?? 1
  const base = magicalDamage(input.playerDerived) * scale

  switch (input.spell.id) {
    case 'plague':
      return { state: { ...spent, plagued: true }, blows: [], rng: input.rng }

    case 'lightningStorm':
      return { state: { ...spent, storming: true }, blows: [], rng: input.rng }

    case 'ignite':
      return { state: { ...spent, igniteStacks: spent.igniteStacks + 1 }, blows: [], rng: input.rng }

    case 'singe': {
      const struck = magicStrike(input, base, input.rng)
      return {
        state: { ...spent, monsterDamageTaken: spent.monsterDamageTaken + struck.blow.damage },
        blows: [struck.blow],
        rng: struck.rng,
      }
    }

    case 'meteor': {
      const struck = magicStrike(input, base * 2, input.rng)
      return {
        state: {
          ...spent,
          monsterDamageTaken: spent.monsterDamageTaken + struck.blow.damage,
          // Every action it had left, gone. Spending the whole pool is how a
          // round says "no more of yours": `monsterActionsLeft` reads the
          // difference, so nothing else has to learn a stun.
          monsterActionsSpent: spent.monsterActionsSpent + monsterActionsLeft(spent, input.monster),
        },
        blows: [struck.blow],
        rng: struck.rng,
      }
    }

    case 'lightningBolt': {
      const blows: Blow[] = []
      let state = spent
      let rng = input.rng
      for (let strike = 0; strike < LIGHTNING_MAX_STRIKES; strike += 1) {
        const struck = magicStrike(input, base, rng)
        blows.push(struck.blow)
        state = { ...state, monsterDamageTaken: state.monsterDamageTaken + struck.blow.damage }
        rng = struck.rng
        const again = nextChance(rng, resolveChanceWith(
          LIGHTNING_REPEAT_CHANCE,
          input.playerStats,
          input.monster.stats,
          { side: 'player', successAdjust: input.successAdjust },
        ))
        rng = again.rng
        if (!again.value) break
      }
      return { state, blows, rng }
    }
  }
}

/** One thing a lingering spell did, for the log to read from. */
export interface SpellTick {
  spell: Spell
  damage: number
}

/**
 * WHAT THE FIRE DOES AFTER THE MONSTER MOVES: Ignite, once per stack, after
 * every action the monster takes.
 *
 * Separate from the end-of-round payouts below because it answers a
 * different clock. A monster that acts four times in a round burns four
 * times; one that is stunned by a Meteor burns not at all, which is the
 * right relationship between those two spells and costs no code to get.
 */
export function igniteTick(state: RoundState, playerDerived: DerivedStats): { state: RoundState; tick: SpellTick | null } {
  if (state.igniteStacks <= 0) return { state, tick: null }
  const spell = SPELLS.find((candidate) => candidate.id === 'ignite')!
  const damage = Math.round(magicalDamage(playerDerived) * IGNITE_SHARE * state.igniteStacks)
  if (damage <= 0) return { state, tick: null }
  return {
    state: { ...state, monsterDamageTaken: state.monsterDamageTaken + damage },
    tick: { spell, damage },
  }
}

/** What one stack of Ignite is worth, as a share of one ordinary attack. */
export const IGNITE_SHARE = 0.1

/** What Plague takes off, as a share of what the monster has LEFT. */
export const PLAGUE_SHARE = 0.2

/**
 * THE END OF A ROUND, paid out in level order -- so the log, which is newest
 * first, reads with the bigger spell at its head.
 *
 * Plague reads the monster's CURRENT health, so it is worth less every round
 * and can never finish a fight on its own; the Storm is a flat bolt and can.
 * Both roll their own crit, because both are attacks.
 */
export function endOfRoundTicks(options: {
  state: RoundState
  monster: Monster
  playerStats: StatBlock
  playerDerived: DerivedStats
  playerChances?: Readonly<Record<'hitChance' | 'critChance', ChanceAdjustment>>
  successAdjust?: number
  rng: RngState
}): { state: RoundState; ticks: SpellTick[]; rng: RngState } {
  let state = options.state
  let rng = options.rng
  const ticks: SpellTick[] = []

  if (state.plagued) {
    const left = Math.max(0, options.monster.maxHitPoints - state.monsterDamageTaken)
    const damage = Math.round(left * PLAGUE_SHARE)
    if (damage > 0) {
      state = { ...state, monsterDamageTaken: state.monsterDamageTaken + damage }
      ticks.push({ spell: spellAt(1)!, damage })
    }
  }

  if (state.storming) {
    const crit = nextChance(rng, resolveChanceWith(CRIT_CHANCE, options.playerStats, options.monster.stats, {
      adjustment: options.playerChances?.critChance,
      side: 'player',
      successAdjust: options.successAdjust,
    }))
    rng = crit.rng
    const damage = Math.round(magicalDamage(options.playerDerived) * (crit.value ? 2 : 1))
    if (damage > 0) {
      state = { ...state, monsterDamageTaken: state.monsterDamageTaken + damage }
      ticks.push({ spell: spellAt(4)!, damage })
    }
  }

  return { state, ticks, rng }
}
