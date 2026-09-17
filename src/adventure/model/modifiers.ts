// Items and traits: the only things that change a player outside of
// levelling, and therefore the only place the order of operations matters.
//
// One shape covers both. They differ in where they come from (gold buys
// items, experience buys traits) and in nothing the rules care about, so
// they share a type and are told apart by `kind` -- which keeps "keep one
// item and one trait at the end of a level" a filter rather than two
// parallel systems.
//
// A TRAIT IS WRITTEN; AN ITEM IS ROLLED. Traits are authored one by one in
// content. Items are authored as TEMPLATES (model/itemSlots.ts) that roll
// their slots once per run from the run's own seed, so a Spyglass is a fixed
// thing for the length of a run and a different thing in the next one. Both
// arrive here as the same `Modifier`, because nothing below this line should
// be able to tell which is which -- that is the whole point of rolling into
// the existing shape rather than beside it.
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
// EVERYTHING IS A PERCENTAGE, never a flat value, and that is a rule rather
// than a style: a flat "+25 hit points" is a third of a starting character
// and a rounding error on a late one, so the same item has to be re-tuned
// every time the curve moves. A percentage is worth the same share of
// whatever it is applied to, at every point of the run. Stat POINTS are the
// one exception, because a stat point is the unit the whole table is written
// in -- "+2 Might" means the same thing wherever it lands.
//
// The two kinds of percentage are not the same arithmetic, and the split is
// the one thing about this vocabulary worth memorising:
//
//   - a QUANTITY (hit points, damage, actions) takes percentages ADDITIVELY:
//     +20% and +30% is +50%, because two effects that each promise a fifth
//     of a pool should not quietly turn into a fifth of a fifth more.
//   - a CHANCE takes percentages off what is LEFT: +20% accuracy removes a
//     fifth of your MISSES, and a second +10% removes a tenth of what still
//     misses. See model/chance.ts for why -- in short, it cannot overshoot,
//     it is the same shape as the run's own thumb on the scale, and adding
//     percentage points to probabilities is how a game ends up with a
//     guaranteed critical hit.
//
// THERE IS NO HEALING, and it is DEFERRED rather than ruled out. Recovery
// makes the balance unreadable: with it, every question about how long a run
// should last has two answers at once, and the ones being settled now are
// about damage, actions and armor. So hit points are filled once, when the
// character sets out, and every fight after that is paid for out of what is
// left -- until healing returns TOGETHER with equally punishing new damage
// sources, as one layer balanced against itself (docs/adventure-game-design.md).
//
// A `recoverAfterEncounter` effect existed here for one evening. It is gone
// from the vocabulary rather than merely unused, so that layer arrives as a
// decision rather than by accident. ARMOR repair is not healing and does not
// reopen it: armor is spent and rebuilt within a level by design, and what
// repairs it is bounded by the item that carries it (model/armor.ts).
//
// THE ORDER, which is the actual rule "capped at 6 before item gains":
//   1. base stats, clamped to 0..6        <- a game's own progression
//   2. + every statDelta                  <- uncapped; this is the point
//   3. derive                             <- stats.ts's formulas
//   4. x (1 + sum of percentages)         <- quantities; chances leave by
//                                            their own door, below
//   5. normalize                          <- counts whole, chances 0..1

import { NO_CHANCE_ADJUSTMENT, resolveChanceWith, type ChanceAdjustment } from './chance'
import {
  addStats,
  clampBaseStats,
  deriveStats,
  normalizeDerived,
  STAT_LABELS,
  type DerivedKey,
  type DerivedStats,
  type StatBlock,
  type StatKey,
  type ChanceKey,
  CHANCE_COMPLEMENTS,
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

/**
 * WHERE IN THE ROUND an action falls, for the effects that care.
 *
 * TWO FLAGS rather than one of three positions, because a round of a single
 * action is genuinely BOTH its first and its last, and a single position would
 * have had to pick one -- silently switching off every finisher in the game
 * for the fastest monsters in it. Everything in between is both false.
 *
 * Read over the ROUND rather than over one side's pool: "the first action each
 * round" is the first thing that happens in the round, whoever does it, which
 * is what makes an opener on Dodge mean something (model/combat.ts's
 * `roundActionPosition`).
 */
export interface ActionPosition {
  first: boolean
  last: boolean
}

export const MID_ROUND: ActionPosition = { first: false, last: false }

export type ModifierEffect =
  /**
   * Straight stat points. Uncapped by design -- see the module comment. The
   * one flat value in the vocabulary, because a stat point is the unit the
   * whole table is written in.
   */
  | { kind: 'statDelta'; stat: StatKey; amount: number }
  /**
   * A percentage of a derived value. ADDITIVE for a quantity, a share of the
   * remainder for a chance -- see the module comment. `0.2` is +20%; negative
   * is a real and useful thing for an item that costs something.
   */
  | { kind: 'derivedPercent'; derived: DerivedKey; percent: number }
  /**
   * Scales with how much is currently held -- "+10% damage for every
   * acquired item". The one effect shape that proves the vocabulary was
   * worth having: it cannot be a constant, and its description cannot be
   * written down in advance.
   */
  | { kind: 'derivedPercentPerHolding'; derived: DerivedKey; percentPer: number; holding: ModifierKind }
  /**
   * A derived value boosted only while the character is BELOW a fraction of
   * their maximum hit points -- "fights harder with their back to the wall".
   *
   * Conditional rather than constant, and resolved in the same place every
   * other effect is: `resolveProfile` takes the situation it is being
   * resolved in, so a caller reads the profile it already had and gets a
   * number that is true right now. The alternative -- applying the condition
   * at each place the value is used -- is the same rule written once per
   * consumer, which is this codebase's characteristic failure.
   */
  | { kind: 'derivedPercentWhileHurt'; derived: DerivedKey; percent: number; belowFraction: number }
  /**
   * A derived value boosted only on the FIRST or the LAST action of a round.
   *
   * The same conditional mechanism as `derivedPercentWhileHurt`, reading a
   * different field of the same `Situation` -- deliberately, because a second
   * way to express "this effect only fires sometimes" is a second place for
   * the condition to be got wrong. What makes it interesting is that it
   * interacts with Agility from the other side: more actions per round make a
   * first-action bonus a smaller share of the round and a last-action bonus no
   * rarer, so the two are not the same effect with a word changed.
   */
  | { kind: 'derivedPercentOnAction'; derived: DerivedKey; percent: number; position: 'first' | 'last' }
  /**
   * THE ARMOR SLOT: a pool of armor belonging to THIS item, spent as it
   * absorbs and rebuilt between fights. Its points are tracked on the item,
   * not on the player -- drop the item and its armor goes with it. See
   * model/armor.ts.
   */
  | { kind: 'armorSlot'; amount: number }
  /** Decay never takes THIS item's own pool below this. */
  | { kind: 'armorDecayFloor'; floor: number }
  /**
   * Repairs every armor piece the run is carrying by this much after each
   * fight, on top of whatever the character's own Might and Intellect
   * maintain. Applies to EVERY piece, including pieces this item did not
   * grant -- which is what makes it worth a verbose slot rather than being
   * indistinguishable from a bigger armor slot.
   */
  | { kind: 'armorRepairAfterCombat'; amount: number }
  /** Armor that decay cannot touch. Added on top of every decaying pool. */
  | { kind: 'naturalArmor'; amount: number }
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
 * The design names more traits than it has specified, and those stay in
 * content (they are the design's names, not ours to delete) carrying a tag
 * that says so. But an offer of two of them is a choice between two nothings,
 * which is exactly what character creation served up once the pool grew:
 * "Bronze Talisman or Nail Clipper", neither of which did anything.
 *
 * ITEMS cannot be unspecified any more -- every item is rolled from a template
 * and a template that rolled nothing would be a bug in the roller, not a
 * decision somebody deferred. This now guards traits alone, and that is worth
 * saying because the check still runs over both: it is cheaper to keep one
 * rule that holds for everything than to remember which half it applies to.
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

export interface EffectiveProfile {
  /** Base + modifiers, uncapped. What a stat check rolls against. */
  stats: StatBlock
  /** Everything those stats imply, after modifiers have had their say. */
  derived: DerivedStats
  /** Armor that decay cannot reduce. */
  naturalArmor: number
  /** Extra points returned to EVERY armor piece after each fight. */
  armorRepair: number
  /**
   * What this character's modifiers do to each contested chance. Carried
   * rather than folded in, because a chance is resolved against an OPPONENT
   * at the moment it is rolled -- see model/chance.ts.
   */
  chances: Readonly<Record<ChanceKey, ChanceAdjustment>>
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
  /**
   * Where in the round the action being resolved falls. Absent means "not in
   * a round", which resolves as neither edge: a screen asking what a character
   * is worth must not quote them their opening-blow number.
   */
  actionPosition?: ActionPosition
}

/**
 * The player, resolved: base stats plus everything currently held, in the
 * SITUATION they are currently in. The one function every other module asks
 * for numbers, so no caller ever has to remember the order in the module
 * comment -- or which effects are conditional.
 *
 * The order, restated because the percentages changed shape: stats, derive,
 * sum every percentage per key, apply, normalize. CHANCES leave by a different
 * door -- they are contested when they are rolled, so a modifier's effect on
 * one is collected as an adjustment (a share of the remainder, not a
 * percentage of the value) and the displayed figure is that adjustment applied
 * to the UNCONTESTED chance. Both go through `resolveChanceWith`, so the bar
 * and the fight cannot disagree.
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
  const actionPosition = situation.actionPosition ?? MID_ROUND

  let naturalArmor = 0
  let armorRepair = 0
  const tags: string[] = []
  const chances: Record<ChanceKey, ChanceAdjustment> = {
    dodgeChance: { ...NO_CHANCE_ADJUSTMENT },
    hitChance: { ...NO_CHANCE_ADJUSTMENT },
    critChance: { ...NO_CHANCE_ADJUSTMENT },
  }

  /**
   * One percentage, banked against its key. A quantity accumulates it
   * ADDITIVELY (applied once, below); a chance takes it off whichever half of
   * the remainder its sign points at. Every percentage in the vocabulary
   * arrives here, which is what makes "the two kinds of percentage" one rule
   * rather than a habit.
   */
  const percents: Partial<Record<DerivedKey, number>> = {}
  const bank = (key: DerivedKey, percent: number) => {
    if (percent === 0) return
    if (!isChanceKey(key)) {
      percents[key] = (percents[key] ?? 0) + percent
      return
    }
    if (percent > 0) chances[key].failureKeep *= Math.max(0, 1 - percent)
    else chances[key].successKeep *= Math.max(0, 1 + percent)
  }

  for (const modifier of modifiers) {
    for (const effect of modifier.effects) {
      switch (effect.kind) {
        case 'derivedPercent':
          bank(effect.derived, effect.percent)
          break
        case 'derivedPercentPerHolding':
          bank(effect.derived, effect.percentPer * holdings[effect.holding === 'item' ? 'items' : 'traits'])
          break
        case 'derivedPercentWhileHurt':
          if (hurtFraction < effect.belowFraction) bank(effect.derived, effect.percent)
          break
        case 'derivedPercentOnAction':
          if (actionPosition[effect.position]) bank(effect.derived, effect.percent)
          break
        case 'naturalArmor':
          naturalArmor += effect.amount
          break
        case 'armorRepairAfterCombat':
          armorRepair += effect.amount
          break
        case 'tag':
          tags.push(effect.tag)
          break
        default:
          break
      }
    }
  }

  for (const [key, percent] of Object.entries(percents) as [DerivedKey, number][]) {
    // Floored at -100%: a stack of penalties that drove a quantity negative
    // would flip the sign of everything downstream of it rather than reducing
    // it to nothing, which is not what any of them promise.
    derived[key] *= Math.max(0, 1 + percent)
  }

  // The UNCONTESTED figure, adjusted -- what the tab bar shows and what a
  // fight starts from before it subtracts the opponent.
  for (const key of CHANCE_DERIVED_KEYS) {
    // NO SIDE, deliberately: this is what the CHARACTER is worth, and the
    // run's thumb is a property of the run's tuning rather than of them.
    // See `pressThumb`.
    derived[key] = resolveChanceWith(CHANCE_SPECS[key], stats, null, { adjustment: chances[key] })
  }

  return {
    stats,
    derived: normalizeDerived(derived),
    naturalArmor,
    armorRepair,
    chances,
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
 * A percentage of a derived value, in words -- and for a CHANCE, what it is a
 * percentage OF.
 *
 * "+20% Accuracy" is read as twenty points by everybody, and for a chance it
 * is a fifth of the misses instead. The complement is named rather than left
 * to be inferred (stats.ts's CHANCE_COMPLEMENTS), because the difference
 * between the two readings is the difference between an item worth taking and
 * an item worth taking twice.
 */
function describePercent(key: DerivedKey, percent: number): string {
  const head = `${signedPercent(percent)} ${DERIVED_LABELS[key]}`
  if (!isChanceKey(key)) return head
  const complement = CHANCE_COMPLEMENTS[key]
  return `${head} (of ${percent >= 0 ? complement.failure : complement.success})`
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
    case 'derivedPercent':
      return describePercent(effect.derived, effect.percent)
    case 'derivedPercentPerHolding': {
      const held = holdings[effect.holding === 'item' ? 'items' : 'traits']
      const noun = effect.holding === 'item' ? 'item' : 'trait'
      // THE TOTAL AS A PERCENTAGE, never as the multiplier it becomes: "(2
      // held: 130%)" beside "+15% per item" reads as a third number rather
      // than as the sum of the first two, and for a count it read as "1.2",
      // which is not a quantity of anything a player has.
      const total = effect.percentPer * held
      return `${signedPercent(effect.percentPer)} ${DERIVED_LABELS[effect.derived]} per ${noun} (${held} held: ${signedPercent(total)})`
    }
    case 'derivedPercentWhileHurt':
      return `${describePercent(effect.derived, effect.percent)} below ${Math.round(effect.belowFraction * 100)}% hit points`
    case 'derivedPercentOnAction':
      return `${describePercent(effect.derived, effect.percent)} on your ${effect.position} action of a round`
    case 'armorSlot':
      return `${effect.amount} Armor, worn down as it absorbs`
    case 'armorDecayFloor':
      return `Its armor never decays below ${effect.floor}`
    case 'armorRepairAfterCombat':
      return `${signed(effect.amount)} Armor to every item after each fight`
    case 'naturalArmor':
      return `${signed(effect.amount)} Armor that cannot decay`
    case 'tag':
      return effect.description
  }
}

/** Every line the tab bar shows while this modifier is in the selection spot. */
export function describeModifier(modifier: Modifier, holdings: HoldingCounts): string[] {
  return modifier.effects.map((effect) => describeEffect(effect, holdings))
}

/** This item's own armor pool, and the floor decay may not take it below. */
export function armorSlotOf(modifier: Modifier): { amount: number; floor: number } | null {
  let amount: number | null = null
  let floor = 0
  for (const effect of modifier.effects) {
    if (effect.kind === 'armorSlot') amount = (amount ?? 0) + effect.amount
    else if (effect.kind === 'armorDecayFloor') floor = Math.max(floor, effect.floor)
  }
  if (amount === null) return null
  return { amount: Math.max(0, Math.floor(amount)), floor: Math.max(0, Math.min(Math.floor(floor), Math.floor(amount))) }
}
