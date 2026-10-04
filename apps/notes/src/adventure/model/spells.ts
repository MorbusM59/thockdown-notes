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
// ONCE PER ACTION, every time the player is about to act. It was once a
// ROUND at first, alongside the charms (model/charm.ts), on the argument that
// the ring's first cell should not move under a fast player -- and that was
// the wrong trade: a round that reached Meteor reached it for EVERY action in
// that round, and a Meteor streak is not what a one-in-twelve chance is meant
// to buy. `(intellect - level) / 12` reads as the chance of an ACTION having
// it, which is what it now is. The charms stay per round, because being under
// one is a property of the round rather than of an action -- it is what the
// pill says and what "lasts until the end of the round" means.
//
// MAGIC CANNOT MISS, CANNOT BE DODGED, AND IGNORES ARMOUR. All three fall
// out of one line -- the strike is resolved with `defence: 'magic'`
// (model/combat.ts), which skips the hit roll and never consults the
// defender's plate -- and the dodge roll is simply not taken, rather than
// taken and discarded. It is what armour is FOR, on both sides: a plated
// monster is the problem Intellect answers.
//
// The CRIT roll stays. A spell is an attack, and Luck is what a crit reads.

import { nextChance, nextRoll, type RngState, type Roll } from '../core/rng'
import { CRIT_CHANCE, type DerivedStats, type StatBlock } from './stats'
import { DEFAULT_DELTA_FORCE, resolveChanceWith, type ChanceAdjustment, type StatChance } from './chance'
import { damageFrom, type Monster } from './monsters'
import { rollAttackDamage, type DamageRoll } from './damageRoll'
import { monsterActionsLeft, resolveExchange, type Blow, type RoundState } from './combat'
import { NO_SPELLS } from './spellReach'

export const SPELL_IDS = ['singe', 'plague', 'ignite', 'lightningBolt', 'lightningStorm', 'meteor'] as const

export type SpellId = (typeof SPELL_IDS)[number]

/**
 * EVERY LASTING SPELL STACKS, so there is no longer a `kind` to branch on.
 *
 * There was one -- `strike` / `lasting` / `stacking` -- because a second
 * Plague did nothing and was therefore kept off the ring, while a second
 * Ignite was worth a second helping. The author settled it the other way:
 * active effects stack, all of them. A second Plague takes twice the share, a
 * second Storm throws twice the bolt, and nothing is ever withheld for having
 * been cast already. `castSpell` switches on the spell's ID, which is the
 * only thing it ever really needed.
 */
export interface Spell {
  id: SpellId
  /** Its place in the table, and the number its availability is rolled against. */
  level: number
  name: string
  icon: string
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
    lines: ['An attack that cannot miss', 'Straight through armour'],
  },
  {
    id: 'plague',
    level: 1,
    name: 'Plague',
    icon: 'fa-solid fa-disease',
    lines: ['A fifth of what it has left, at the end of every round', 'Cast again and it takes twice as much'],
  },
  {
    id: 'ignite',
    level: 2,
    // Singe already holds the plain flame, and these two must not read as one
    // spell at a glance: the curved flame is the one that keeps burning.
    icon: 'fa-solid fa-fire-flame-curved',
    name: 'Ignite',
    lines: ['It burns for every action it takes', 'Cast again and it burns twice as hot'],
  },
  {
    id: 'lightningBolt',
    level: 3,
    name: 'Lightning Bolt',
    icon: 'fa-solid fa-bolt-lightning',
    lines: ['An attack that cannot miss', 'And leaps again on a Luck check, until it does not'],
  },
  {
    id: 'lightningStorm',
    level: 4,
    name: 'Lightning Storm',
    icon: 'fa-solid fa-cloud-bolt',
    lines: ['A bolt at the end of every round', 'Cast again and it throws twice as many'],
  },
  {
    id: 'meteor',
    level: 5,
    name: 'Meteor Strike',
    icon: 'fa-solid fa-meteor',
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
 * What the ring offers for this action, STRONGEST FIRST -- which is what
 * makes pressing the first cell the right play without the player reading
 * anything.
 *
 * Everything in reach is offered, including a lasting spell already in
 * effect: they STACK, so a second cast is never a wasted one. An earlier
 * version withheld those, on the argument that a first cell which is
 * sometimes a mistake is a fight the player has to read -- true, and no
 * longer load-bearing here, because there is no longer a wasted cast to
 * protect them from.
 */
export function spellsOffered(reach: number, _state?: RoundState): Spell[] {
  return SPELLS
    .filter((spell) => spell.level <= reach)
    .sort((left, right) => right.level - left.level)
}

/** The strongest thing in reach, which is what a prepared attack fires alongside itself. */
export function strongestOffered(reach: number): Spell | null {
  return spellsOffered(reach)[0] ?? null
}

/** What a spell's damage is measured in: one ordinary attack of this character's. */
export function magicalDamage(playerDerived: DerivedStats): number {
  return damageFrom(playerDerived.damageMultiplier)
}

/** The bolt's chance to leap again: the spec's 50% between equals, on contested Luck. */
export const LIGHTNING_REPEAT_CHANCE: StatChance = {
  deltaForce: DEFAULT_DELTA_FORCE, deltaShift: 0, stat: 'luck',
}

/**
 * How many times a bolt may leap in total.
 *
 * NOT a rule, a TERMINATOR. It was load-bearing while the repeat chance was a
 * straight line, which reached CERTAINTY at ten points of Luck -- an
 * unbounded loop in a pure function nothing can interrupt. The curve cannot
 * reach one at any delta (model/chance.ts), so the chain now ends on its own
 * with probability one; this stays because "ends eventually" and "ends" are
 * not the same promise to make about a loop, and because the number is the
 * author's to set. It is high enough that a bolt reaching it is already an
 * extraordinary round.
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
  /** Whether this took the monster's remaining actions away. Meteor's, and worth its own pill. */
  stunned: boolean
  /**
   * The spell's own working, for the pill's tooltip -- what it laid on, or
   * how a bolt's chain went. The BLOWS explain themselves (`Blow.math`); this
   * is only what the spell did that a blow cannot say.
   */
  detail: string[]
  rng: RngState
}

/** A roll as a tooltip reads it: what came up against what it needed. */
function rollLine(label: string, roll: Roll): string {
  return `${label}: ${Math.round(roll.rolled * 100)}|${Math.round(roll.needed * 100)}`
}

/**
 * A rolled damage, written out with its terms -- the same shape a blow's own
 * line uses (stages/combatLog.ts), because a bolt out of the sky and a bolt
 * out of a cast are the same arithmetic and should read as it.
 */
function damageLine(total: number, drawn: DamageRoll, multiplier: number, stacks: number): string {
  const band = Math.round(drawn.low) === Math.round(drawn.high)
    ? ''
    : ` (${Math.round(drawn.low)}-${Math.round(drawn.high)}, best of ${drawn.rolls})`
  const terms = [`${Math.round(drawn.damage)}${band}`]
  if (multiplier !== 1) terms.push(`x ${multiplier} crit`)
  if (stacks !== 1) terms.push(`x ${stacks} stack(s)`)
  return `Damage: ${total} = ${terms.join(' ')}`
}

/** One magical blow: no hit roll, no dodge, no armour, crit as usual. */
function magicStrike(input: CastInput, damage: number, rng: RngState): { blow: Blow; rng: RngState } {
  const exchange = resolveExchange({
    attackerStats: input.playerStats,
    attackerDamage: damage,
    defenderStats: input.monster.stats,
    armor: input.monster.armor,
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
      return {
        state: { ...spent, plagued: spent.plagued + 1 },
        blows: [],
        stunned: false,
        detail: [`${spent.plagued + 1} stack(s): ${Math.round(PLAGUE_SHARE * 100 * (spent.plagued + 1))}% of what it has left, each round`],
        rng: input.rng,
      }

    case 'lightningStorm':
      return {
        state: { ...spent, storming: spent.storming + 1 },
        blows: [],
        stunned: false,
        detail: [`${spent.storming + 1} stack(s): ${Math.round(magicalDamage(input.playerDerived))} damage each round, before crit`],
        rng: input.rng,
      }

    case 'ignite':
      return {
        state: { ...spent, igniteStacks: spent.igniteStacks + 1 },
        blows: [],
        stunned: false,
        detail: [`${spent.igniteStacks + 1} stack(s): ${Math.round(magicalDamage(input.playerDerived) * IGNITE_SHARE * (spent.igniteStacks + 1))} damage per action it takes`],
        rng: input.rng,
      }

    case 'singe': {
      const struck = magicStrike(input, base, input.rng)
      return {
        state: { ...spent, monsterDamageTaken: spent.monsterDamageTaken + struck.blow.damage },
        blows: [struck.blow],
        stunned: false,
        detail: [],
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
        stunned: true,
        detail: [`Double damage: ${Math.round(base)} for one of this character's attacks`],
        rng: struck.rng,
      }
    }

    case 'lightningBolt': {
      const blows: Blow[] = []
      const leaps: string[] = []
      let state = spent
      let rng = input.rng
      for (let strike = 0; strike < LIGHTNING_MAX_STRIKES; strike += 1) {
        const struck = magicStrike(input, base, rng)
        blows.push(struck.blow)
        state = { ...state, monsterDamageTaken: state.monsterDamageTaken + struck.blow.damage }
        rng = struck.rng
        const again = nextRoll(rng, resolveChanceWith(
          LIGHTNING_REPEAT_CHANCE,
          input.playerStats,
          input.monster.stats,
          { side: 'player', successAdjust: input.successAdjust },
        ))
        rng = again.rng
        leaps.push(rollLine('Leap', again.value))
        if (!again.value.passed) break
      }
      return {
        state,
        blows,
        stunned: false,
        detail: [`${blows.length} strike(s)`, ...leaps],
        rng,
      }
    }
  }
}

/** One thing a lingering spell did, for the log to read from. */
export interface SpellTick {
  spell: Spell
  damage: number
  /** The arithmetic behind that number, for the pill's tooltip. */
  detail: string[]
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
  const per = magicalDamage(playerDerived) * IGNITE_SHARE
  const damage = Math.round(per * state.igniteStacks)
  if (damage <= 0) return { state, tick: null }
  return {
    state: { ...state, monsterDamageTaken: state.monsterDamageTaken + damage },
    tick: {
      spell,
      damage,
      detail: [`Damage: ${damage} = ${Math.round(magicalDamage(playerDerived))} x ${Math.round(IGNITE_SHARE * 100)}% x ${state.igniteStacks} stack(s)`],
    },
  }
}

/** What one stack of Ignite is worth, as a share of one ordinary attack. */
export const IGNITE_SHARE = 0.1

/** What ONE stack of Plague takes off, as a share of what the monster has LEFT. */
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

  if (state.plagued > 0) {
    const left = Math.max(0, options.monster.maxHitPoints - state.monsterDamageTaken)
    // PER STACK: a second Plague takes twice the share of what is left.
    const damage = Math.round(left * PLAGUE_SHARE * state.plagued)
    if (damage > 0) {
      state = { ...state, monsterDamageTaken: state.monsterDamageTaken + damage }
      ticks.push({
        spell: spellAt(1)!,
        damage,
        detail: [`Damage: ${damage} = ${left} left x ${Math.round(PLAGUE_SHARE * 100)}% x ${state.plagued} stack(s)`],
      })
    }
  }

  if (state.storming > 0) {
    const crit = nextRoll(rng, resolveChanceWith(CRIT_CHANCE, options.playerStats, options.monster.stats, {
      adjustment: options.playerChances?.critChance,
      side: 'player',
      successAdjust: options.successAdjust,
    }))
    rng = crit.rng
    // PER STACK, on ONE crit roll: two storms are two bolts out of the same
    // sky, not two independently lucky ones.
    const multiplier = crit.value.passed ? 2 : 1
    // "REGULAR MAGICAL DAMAGE, THE SAME AS SINGE" is the spec's wording, and
    // Singe is an attack -- so the bolt is drawn from the same Perception
    // band, best of the same Luck's worth of draws (model/damageRoll.ts). The
    // other two lingering spells are NOT attacks being swung: Plague is a
    // share of what the monster has left and Ignite a share of a nominal, and
    // a drip that is already one or two hit points does not want a band.
    const drawn = rollAttackDamage({
      nominal: magicalDamage(options.playerDerived),
      attackerStats: options.playerStats,
      rng,
    })
    rng = drawn.rng
    const damage = Math.round(drawn.damage * multiplier * state.storming)
    if (damage > 0) {
      state = { ...state, monsterDamageTaken: state.monsterDamageTaken + damage }
      ticks.push({
        spell: spellAt(4)!,
        damage,
        detail: [
          rollLine('Crit', crit.value),
          damageLine(damage, drawn, multiplier, state.storming),
        ],
      })
    }
  }

  return { state, ticks, rng }
}
