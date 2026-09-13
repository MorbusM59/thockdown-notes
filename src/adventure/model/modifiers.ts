// Items and traits: the only things that change a player outside of
// levelling, and therefore the only place the order of operations matters.
//
// One shape covers both. They differ in where they come from (gold buys
// items, experience buys traits) and in nothing the rules care about, so
// they share a type and are told apart by `kind` -- which keeps "keep one
// item and one trait at the end of a level" a filter rather than two
// parallel systems.
//
// EFFECTS ARE DATA, NOT CODE, and that is load-bearing rather than
// fastidious. The tab bar shows a modifier's effect while its cell is in
// the ring's selection spot, and that text has to be LIVE: "Avid Collector:
// +30% damage (3 items)" is true only if the number is computed from the
// same declaration the resolver applies. A hand-written description string
// goes stale the first time the effect depends on anything, and nothing
// tells you it has. So one vocabulary produces both the maths and the
// words, and `tag` is the deliberate escape hatch for the rare effect the
// vocabulary cannot express -- that one carries a written description,
// because nothing else can describe it.
//
// THE ORDER, which is the actual rule "capped at 6 before item gains":
//   1. base stats, clamped to 0..6        <- a game's own progression
//   2. + every statDelta                  <- uncapped; this is the point
//   3. derive                             <- stats.ts's formulas
//   4. * derivedScale, + derivedDelta     <- effects that skip the stats
//   5. normalize                          <- counts whole, chances 0..1

import { NO_CHANCE_ADJUSTMENT, resolveChanceWith, type ChanceAdjustment } from './chance'
import {
  addStats,
  clampBaseStats,
  deriveStats,
  formatDerived,
  normalizeDerived,
  STAT_LABELS,
  type DerivedKey,
  type DerivedStats,
  type StatBlock,
  type StatKey,
  type ChanceKey,
  CHANCE_DERIVED_KEYS,
  CHANCE_SPECS,
  isChanceKey,
  DERIVED_LABELS,
} from './stats'

export type ModifierKind = 'item' | 'trait'

/** What a modifier's effect can depend on besides the stat block itself. */
export interface HoldingCounts {
  items: number
  traits: number
}

export type ModifierEffect =
  /** Straight stat points. Uncapped by design -- see the module comment. */
  | { kind: 'statDelta'; stat: StatKey; amount: number }
  /** Added to a derived value after scaling. */
  | { kind: 'derivedDelta'; derived: DerivedKey; amount: number }
  /** Multiplied into a derived value before flat deltas. */
  | { kind: 'derivedScale'; derived: DerivedKey; factor: number }
  /**
   * Scales with how much is currently held -- "+10% damage for every
   * acquired item". The one effect shape that proves the vocabulary was
   * worth having: it cannot be a constant, and its description cannot be
   * written down in advance.
   */
  | { kind: 'derivedScalePerHolding'; derived: DerivedKey; factorPer: number; holding: ModifierKind }
  /**
   * A derived value scaled only while the character is BELOW a fraction of
   * their maximum hit points -- "fights harder with their back to the wall".
   *
   * Conditional rather than constant, and resolved in the same place every
   * other effect is: `resolveProfile` takes the situation it is being
   * resolved in, so a caller reads the profile it already had and gets a
   * number that is true right now. The alternative -- applying the condition
   * at each place the value is used -- is the same rule written once per
   * consumer, which is this codebase's characteristic failure.
   */
  | { kind: 'derivedScaleWhileHurt'; derived: DerivedKey; factor: number; belowFraction: number }
  /**
   * Hit points returned after every encounter that pays out. The one
   * recovery in the game, and it is CONTENT rather than a systemic rule: a
   * run heals because the player chose something that heals it, and a run
   * that chose otherwise does not. See the loot stage, which is the single
   * place this is applied.
   *
   * `fraction` is of maximum hit points; `amount` is flat. Both may be
   * present, and they add.
   */
  | { kind: 'recoverAfterEncounter'; amount?: number; fraction?: number }
  /**
   * Armor granted ONCE, when this modifier is acquired. Not a passive
   * bonus: armor is spent as it absorbs, and carrying an item into the next
   * level counts as a fresh acquisition. See armor.ts.
   */
  | { kind: 'armorOnAcquire'; amount: number }
  /** Armor that decay cannot touch. Added on top of the decaying pool. */
  | { kind: 'naturalArmor'; amount: number }
  /** Decay never takes the decaying pool below this. */
  | { kind: 'armorDecayFloor'; floor: number }
  /** The escape hatch: a named hook a system looks for, with its own prose. */
  | { kind: 'tag'; tag: string; description: string }

export interface Modifier {
  id: string
  kind: ModifierKind
  name: string
  icon: string
  effects: readonly ModifierEffect[]
}

/**
 * The tag a piece of content carries when it exists by NAME and its effect
 * has not been decided. Named here rather than spelled in content, because
 * `isOfferable` below is the thing that reads it and a typo would silently
 * put an empty choice back in the ring.
 */
export const UNSPECIFIED_TAG = 'unspecified'

/**
 * Whether this is something to OFFER a player -- which is to say, whether it
 * does anything at all.
 *
 * The design names more items and traits than it has specified, and those
 * stay in content (they are the design's names, not ours to delete) carrying
 * a tag that says so. But an offer of two of them is a choice between two
 * nothings, which is exactly what character creation served up once the pool
 * grew: "Bronze Talisman or Nail Clipper", neither of which did anything.
 *
 * DERIVED rather than declared per entry: an entry becomes offerable the
 * moment somebody gives it an effect, with no second list to remember. That
 * is the same argument that took the hand-kept `weight` field out of this
 * type -- it was read by nothing and claimed that 0 made an entry
 * unreachable, which was true of no code anywhere.
 */
export function isOfferable(modifier: Modifier): boolean {
  return modifier.effects.some((effect) => !(effect.kind === 'tag' && effect.tag === UNSPECIFIED_TAG))
}

/**
 * Whether an effect fires once on acquisition rather than being re-applied
 * whenever the profile is resolved. Passive and on-acquire effects live in
 * the same list because a modifier is one thing to a player; they are told
 * apart HERE so that neither is ever applied the wrong number of times.
 */
export function isOnAcquireEffect(effect: ModifierEffect): boolean {
  return effect.kind === 'armorOnAcquire'
}

export interface EffectiveProfile {
  /** Base + modifiers, uncapped. What a stat check rolls against. */
  stats: StatBlock
  /** Everything those stats imply, after modifiers have had their say. */
  derived: DerivedStats
  /** Armor that decay cannot reduce. */
  naturalArmor: number
  /** The lowest the decaying armor pool can be driven by decay. */
  armorDecayFloor: number
  /**
   * What this character's modifiers do to each contested chance. Carried
   * rather than folded in, because a chance is resolved against an OPPONENT
   * at the moment it is rolled -- see model/chance.ts.
   */
  chances: Readonly<Record<ChanceKey, ChanceAdjustment>>
  /** Hit points returned after each paying encounter, already totalled. */
  recoveryPerEncounter: number
  /** Named hooks currently held, for effects the numbers cannot express. */
  tags: readonly string[]
}

/**
 * What a profile is being resolved IN: the facts outside the stat block that
 * a conditional effect reads. Optional everywhere, because most callers ask
 * "what is this character worth" rather than "what are they worth right
 * now", and a conditional effect simply does not fire without its condition.
 */
export interface Situation {
  /** Current hit points. Compared against the maximum the stats derive. */
  hitPoints?: number
}

/**
 * The player, resolved: base stats plus everything currently held, in the
 * SITUATION they are currently in. The one function every other module asks
 * for numbers, so no caller ever has to remember the order in the module
 * comment -- or which effects are conditional.
 *
 * The order, restated because two steps were added to it: stats, derive,
 * scale (including the conditional and per-holding scales), add, normalize.
 * CHANCES leave by a different door -- they are contested when they are
 * rolled, so a modifier's effect on one is collected as an adjustment and the
 * displayed figure is that adjustment applied to the UNCONTESTED chance. Both
 * go through `resolveChanceWith`, so the bar and the fight cannot disagree.
 */
export function resolveProfile(
  baseStats: StatBlock,
  modifiers: readonly Modifier[],
  holdings: HoldingCounts,
  situation: Situation = {},
): EffectiveProfile {
  let stats = clampBaseStats(baseStats)
  for (const modifier of modifiers) {
    for (const effect of modifier.effects) {
      if (effect.kind === 'statDelta') stats = addStats(stats, { [effect.stat]: effect.amount })
    }
  }

  const derived = { ...deriveStats(stats) }
  // Measured against the maximum the STATS derive, before any modifier has
  // moved it. A conditional effect that raised the maximum would otherwise
  // decide its own condition.
  const hurtFraction = situation.hitPoints === undefined
    ? 1
    : situation.hitPoints / Math.max(1, derived.maxHitPoints)

  let naturalArmor = 0
  let armorDecayFloor = 0
  let recoveryPerEncounter = 0
  const tags: string[] = []
  const chances: Record<ChanceKey, ChanceAdjustment> = {
    dodgeChance: { ...NO_CHANCE_ADJUSTMENT },
    hitChance: { ...NO_CHANCE_ADJUSTMENT },
    critChance: { ...NO_CHANCE_ADJUSTMENT },
  }

  const scale = (key: DerivedKey, factor: number) => {
    if (isChanceKey(key)) chances[key].scale *= factor
    else derived[key] *= factor
  }

  for (const modifier of modifiers) {
    for (const effect of modifier.effects) {
      if (effect.kind === 'derivedScale') scale(effect.derived, effect.factor)
      else if (effect.kind === 'derivedScalePerHolding') {
        scale(effect.derived, 1 + effect.factorPer * holdings[effect.holding === 'item' ? 'items' : 'traits'])
      } else if (effect.kind === 'derivedScaleWhileHurt') {
        if (hurtFraction < effect.belowFraction) scale(effect.derived, effect.factor)
      }
    }
  }
  for (const modifier of modifiers) {
    for (const effect of modifier.effects) {
      if (effect.kind === 'derivedDelta') {
        if (isChanceKey(effect.derived)) chances[effect.derived].delta += effect.amount
        else derived[effect.derived] += effect.amount
      } else if (effect.kind === 'naturalArmor') naturalArmor += effect.amount
      else if (effect.kind === 'armorDecayFloor') armorDecayFloor = Math.max(armorDecayFloor, effect.floor)
      else if (effect.kind === 'recoverAfterEncounter') {
        recoveryPerEncounter += (effect.amount ?? 0) + (effect.fraction ?? 0) * derived.maxHitPoints
      } else if (effect.kind === 'tag') tags.push(effect.tag)
    }
  }

  // The UNCONTESTED figure, adjusted -- what the tab bar shows and what a
  // fight starts from before it subtracts the opponent.
  for (const key of CHANCE_DERIVED_KEYS) {
    derived[key] = resolveChanceWith(CHANCE_SPECS[key], stats, null, chances[key])
  }

  return {
    stats,
    derived: normalizeDerived(derived),
    naturalArmor,
    armorDecayFloor,
    chances,
    recoveryPerEncounter: Math.max(0, Math.round(recoveryPerEncounter)),
    tags,
  }
}

export function hasTag(profile: EffectiveProfile, tag: string): boolean {
  return profile.tags.includes(tag)
}

function signed(amount: number): string {
  return amount >= 0 ? `+${amount}` : String(amount)
}

function signedPercent(fraction: number): string {
  const percent = Math.round(fraction * 100)
  return percent >= 0 ? `+${percent}%` : `${percent}%`
}

/**
 * One effect, in words, computed from the SAME declaration the resolver
 * reads -- which is the whole reason effects are data. An effect that
 * depends on what is held says so and shows its current value, because a
 * player reading "+10% per item" still has to count their own items to know
 * what it is doing for them right now.
 */
export function describeEffect(effect: ModifierEffect, holdings: HoldingCounts): string {
  switch (effect.kind) {
    case 'statDelta':
      return `${signed(effect.amount)} ${STAT_LABELS[effect.stat]}`
    case 'derivedDelta':
      return `${signed(effect.amount)} ${DERIVED_LABELS[effect.derived]}`
    case 'derivedScale':
      return `${signedPercent(effect.factor - 1)} ${DERIVED_LABELS[effect.derived]}`
    case 'derivedScalePerHolding': {
      const held = holdings[effect.holding === 'item' ? 'items' : 'traits']
      const noun = effect.holding === 'item' ? 'item' : 'trait'
      const current = formatDerived(effect.derived, 1 + effect.factorPer * held)
      return `${signedPercent(effect.factorPer)} ${DERIVED_LABELS[effect.derived]} per ${noun} (${held} held: ${current})`
    }
    case 'derivedScaleWhileHurt':
      return `${signedPercent(effect.factor - 1)} ${DERIVED_LABELS[effect.derived]} below ${Math.round(effect.belowFraction * 100)}% hit points`
    case 'recoverAfterEncounter': {
      const parts = [
        ...(effect.amount ? [`${effect.amount}`] : []),
        ...(effect.fraction ? [`${Math.round(effect.fraction * 100)}% of maximum`] : []),
      ]
      return `Recover ${parts.join(' + ')} hit points after each encounter`
    }
    case 'armorOnAcquire':
      return `${signed(effect.amount)} Armor when acquired`
    case 'naturalArmor':
      return `${signed(effect.amount)} Armor that cannot decay`
    case 'armorDecayFloor':
      return `Armor never decays below ${effect.floor}`
    case 'tag':
      return effect.description
  }
}

/** Every line the tab bar shows while this modifier is in the selection spot. */
export function describeModifier(modifier: Modifier, holdings: HoldingCounts): string[] {
  return modifier.effects.map((effect) => describeEffect(effect, holdings))
}
