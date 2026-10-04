// Armor, which is not a stat, and which belongs to the ITEM rather than to
// the player.
//
// Every other stat is static for the length of a level. Armor is SPENT: it
// absorbs damage as a flat reduction, and each time it absorbs anything it
// may wear away by a point. So it lives beside hit points rather than in the
// stat block -- and it is a POOL PER ITEM plus one pool for everything else:
//
//   - `pieces`   -- one per item carrying an armor slot, with its own current
//                   points and its own maximum. Tracked
//                   on the item because that is what it is a property of:
//                   drop the item and its armor goes with it, with nothing to
//                   correct afterwards. A player who drops a battered shield
//                   and finds one in the next chest is carrying a whole
//                   shield, not the battered one's points in a new shape.
//   - `natural`  -- granted by traits and by items that promise armor decay
//                   cannot touch, and exempt from decay entirely.
//
// ONE NUMBER COULD NOT EXPRESS ANY OF THIS. A single `fromItems` pool was the
// first version: it could not say which item wore down, so dropping one had
// to guess how much of the pool went with it, and "restore each item to what
// your Might and Intellect maintain" had no *each* to speak of.
//
// THREE MOMENTS, and they are different rules rather than three sizes of the
// same one:
//   1. ABSORB       -- a blow is reduced, and one piece may lose a point.
//   2. AFTER A FIGHT -- every piece is brought back UP TO the condition the
//                      character can maintain, `(Might + Intellect) / 20` of
//                      its maximum, plus whatever repairs anything held
//                      promises. A piece already above that keeps what it has:
//                      this tops up, it never trims.
//   3. A NEW LEVEL   -- every piece is full again. A level is a journey with
//                      a rest at either end, and gear is seen to in between.

import { nextChance, type RngState } from '../core/rng'
import type { Modifier } from './modifiers'
import { armorSlotOf } from './modifiers'

/** One item's own armor: what is left, what it holds when whole, and how far it can wear. */
export interface ArmorPiece {
  /** The item this pool belongs to. Its holding row is where the points persist. */
  itemId: string
  points: number
  /** What a new level -- or a fresh acquisition -- fills it to. */
  max: number
}

export interface Armor {
  /** Granted by traits and by non-decaying item effects. Decay cannot touch it. */
  natural: number
  pieces: readonly ArmorPiece[]
}

export const NO_ARMOR: Armor = { natural: 0, pieces: [] }

/** What the items are holding between them, which is the half that wears. */
export function itemArmor(armor: Armor): number {
  return armor.pieces.reduce((sum, piece) => sum + Math.max(0, piece.points), 0)
}

export function totalArmor(armor: Armor): number {
  return Math.max(0, armor.natural) + itemArmor(armor)
}

/** A monster's plate, or a trait's: one pool, no pieces, nothing to wear down. */
export function naturalArmorOf(amount: number): Armor {
  return { natural: Math.max(0, amount), pieces: [] }
}

/**
 * The armor an item grants when whole, or null when it carries no armor slot.
 * Read from the ROLLED item (model/itemSlots.ts), which is why the maximum is
 * never stored: it is a property of what the item is in this run.
 */
export function pieceOf(modifier: Modifier, points?: number): ArmorPiece | null {
  const slot = armorSlotOf(modifier)
  if (!slot || slot.amount <= 0) return null
  const filled = points === undefined ? slot.amount : Math.max(0, Math.min(slot.amount, Math.floor(points)))
  return { itemId: modifier.id, points: filled, max: slot.amount }
}

/**
 * UNSPECIFIED, and labelled rather than guessed at quietly. The design says
 * a successful absorb has "a chance based on luck" that the armor is not
 * worn down, without giving the curve. This is a placeholder shape with one
 * named constant per term, so replacing it is an edit here and nowhere
 * else. It is NOT a tuned value.
 */
export const ARMOR_DECAY_TUNING = {
  /** Chance the armor survives an absorb at Luck 0. */
  baseSurvivalChance: 0.2,
  /** Added to that chance per point of Luck. */
  survivalChancePerLuck: 0.1,
} as const

export function armorSurvivalChance(luck: number): number {
  const chance = ARMOR_DECAY_TUNING.baseSurvivalChance + ARMOR_DECAY_TUNING.survivalChancePerLuck * luck
  return Math.max(0, Math.min(1, chance))
}

/**
 * WHICH PIECE WEARS, when one has to.
 *
 * The fullest one with anything left, earliest acquired breaking a tie.
 * Not random and not the piece that "took the blow" -- the pool absorbs as one
 * thing, so there is no such piece to find. Wearing the fullest spreads the
 * damage across the kit, which is what makes the repair rule (a share of each
 * piece's own maximum) mean something: concentrating the wear on one piece
 * would let a big shield rot to nothing while a bracer stayed pristine.
 */
function pieceToWear(pieces: readonly ArmorPiece[]): number {
  let best = -1
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index]
    if (piece.points <= 0) continue
    if (best === -1 || piece.points > pieces[best].points) best = index
  }
  return best
}

export interface AbsorbResult {
  /** Damage left after armor took its share. Never below zero. */
  damage: number
  /** How much armor actually stopped. Zero when the blow was already harmless. */
  absorbed: number
  armor: Armor
  /** Whether this absorb cost a point of armor. Worth narrating. */
  decayed: boolean
  rng: RngState
}

/**
 * Armor's whole behaviour in one place: reduce, then possibly wear.
 *
 * The decay roll happens ONLY when armor actually stopped something. Armor
 * that was not tested does not wear out, which is the difference between a
 * shield and a candle -- and rolling regardless would make a fight the
 * player dodged entirely cost them the same as one they took on the chin.
 */
export function absorb(
  armor: Armor,
  incomingDamage: number,
  luck: number,
  rng: RngState,
): AbsorbResult {
  const shield = totalArmor(armor)
  const absorbed = Math.max(0, Math.min(shield, incomingDamage))
  const damage = Math.max(0, incomingDamage - absorbed)

  if (absorbed <= 0) return { damage, absorbed, armor, decayed: false, rng }

  const survived = nextChance(rng, armorSurvivalChance(luck))
  const index = pieceToWear(armor.pieces)
  if (survived.value || index === -1) {
    return { damage, absorbed, armor, decayed: false, rng: survived.rng }
  }

  const pieces = armor.pieces.map((piece, at) => (
    at === index ? { ...piece, points: Math.max(0, piece.points - 1) } : piece
  ))
  return { damage, absorbed, armor: { ...armor, pieces }, decayed: true, rng: survived.rng }
}

/**
 * THE CONDITION A CHARACTER CAN MAINTAIN, as a fraction of a piece's maximum:
 * `(Might + Intellect) / 20`. The strength to beat a dent out and the
 * knowledge of what you are doing to it, and nothing else -- at the base stat
 * cap of six apiece that is 60%, and a character who invested in neither
 * repairs a fifth of a shield between fights.
 */
export function maintainedFraction(might: number, intellect: number): number {
  return Math.max(0, Math.min(1, (Math.max(0, might) + Math.max(0, intellect)) / 20))
}

/**
 * AFTER A FIGHT: every piece brought UP TO what the character maintains, plus
 * whatever repairs the run is carrying (`EffectiveProfile.armorRepair`).
 *
 * It tops up and never trims -- a piece already above the maintained line
 * keeps every point it has. That is what makes the line a floor the kit
 * settles onto over a level rather than a level it is held at: a fight that
 * takes little leaves a piece above it, and the next one may not.
 */
export function repairAfterFight(armor: Armor, might: number, intellect: number, extraRepair = 0): Armor {
  const fraction = maintainedFraction(might, intellect)
  const extra = Math.max(0, Math.floor(extraRepair))
  const pieces = armor.pieces.map((piece) => {
    const maintained = Math.floor(piece.max * fraction)
    const points = Math.max(0, Math.min(piece.max, Math.max(piece.points, maintained) + extra))
    return points === piece.points ? piece : { ...piece, points }
  })
  return { ...armor, pieces }
}

/** A NEW LEVEL: everything whole again. */
export function refillArmor(armor: Armor): Armor {
  return { ...armor, pieces: armor.pieces.map((piece) => (piece.points === piece.max ? piece : { ...piece, points: piece.max })) }
}
