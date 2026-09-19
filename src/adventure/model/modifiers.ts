// Items and traits: the only things that change a player outside of
// levelling, and therefore the only place the order of operations matters.
//
// One shape covers both. They differ in where they come from (gold buys
// items, experience buys traits) and in nothing the rules care about, so
// they share a type and are told apart by `kind` -- which keeps "keep one
// item and one trait at the end of a level" a filter rather than two
// parallel systems.
//
// BOTH ARE ROLLED FROM TEMPLATES (model/modifierSlots.ts), once per run from
// the run's own seed, so a Spyglass is a fixed thing for the length of a run
// and a different thing in the next one. They differ in WHICH SLOTS they have
// and in nothing else: an item is gear, so it buys stat points and the base
// stat cap is what gear exists to carry you past; a trait is something you
// ARE, so it buys the odd and the particular -- two verbose slots instead of
// two stat ones. Both arrive here as the same `Modifier`, because nothing
// below this line should be able to tell which is which.
//
// EFFECTS ARE DATA, NOT CODE, and that is load-bearing rather than
// fastidious. The tab bar shows a modifier's effect while its cell is in
// the ring's selection spot, and that text has to be LIVE: "Avid Collector:
// +30% damage (3 items)" is true only if the number is computed from the
// same declaration the resolver applies. A hand-written description string
// goes stale the first time the effect depends on anything, and nothing
// tells you it has. So one vocabulary produces both the maths and the words,
// and every effect in it is a shape the describer can put into English.
//
// A `tag` ESCAPE HATCH lived here -- a named hook with its own written prose,
// for the effect the vocabulary could not express. Nothing ever used it except
// the `unspecified` placeholder, and a placeholder is not a state a modifier
// can be in any more: every one of them is rolled from a template
// (model/modifierSlots.ts) and a template always rolls into something. It is
// deleted rather than kept for the day something needs it, which is the same
// rule model/effects.ts states about its own vocabulary -- an effect that
// exists because it might be useful one day is an effect nobody can delete
// later.
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
import { HEALTH_BAND_BOUNDS, bandWithArticle, inHealthBand, type HealthBand } from './health'
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
  | {
    kind: 'derivedPercentWhileHealth'
    derived: DerivedKey
    percent: number
    band: HealthBand
    /**
     * WHOSE health decides it. `self` is the character carrying the effect;
     * `target` is whoever they are about to hit, which only a blow knows --
     * so a target-conditioned effect is simply not in force anywhere there is
     * no opponent, exactly as a self-conditioned one is not in force with no
     * hit points given. Same door, same absence, one rule.
     */
    subject: 'self' | 'target'
  }
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
  /**
   * NO DECAYING ARMOR: the armour items carry is worth nothing to this
   * character. Natural armour is untouched, so a trait's toughness still
   * counts -- the rule is about worn gear, not about being hard to hurt.
   *
   * A CEILING rather than a quantity, which is why it is a flag and not a
   * negative number: "minus all of it" would depend on what happened to be
   * worn, and could be out-added by a second piece.
   */
  | { kind: 'noDecayingArmor' }

export interface Modifier {
  id: string
  kind: ModifierKind
  name: string
  icon: string
  effects: readonly ModifierEffect[]
}

export interface EffectiveProfile {
  /** Base + modifiers, uncapped. What a stat check rolls against. */
  stats: StatBlock
  /** Everything those stats imply, after modifiers have had their say. */
  derived: DerivedStats
  /** Whether worn armour counts for anything (model/armor.ts reads it). */
  noDecayingArmor: boolean
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
  /**
   * How hurt the OPPONENT is, 0..1. Absent means there is nobody to hit, and
   * every `subject: 'target'` effect is out of force -- which is the honest
   * answer for the status bar, for character creation and for every offer
   * screen, none of which have an opponent in hand.
   *
   * A FRACTION rather than hit points, unlike the self side: this character's
   * maximum is derived right here from their own stats, and the opponent's is
   * the opponent's business.
   */
  opponentHealthFraction?: number
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
  let noDecayingArmor = false
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
        case 'derivedPercentWhileHealth':
          {
            // A target-conditioned effect with no opponent in the situation
            // is out of force, the same way a self-conditioned one is with no
            // hit points -- `undefined` is "not applicable", never "full".
            const fraction = effect.subject === 'target' ? situation.opponentHealthFraction : hurtFraction
            if (fraction !== undefined && inHealthBand(fraction, effect.band)) bank(effect.derived, effect.percent)
          }
          break
        case 'derivedPercentOnAction':
          if (actionPosition[effect.position]) bank(effect.derived, effect.percent)
          break
        case 'noDecayingArmor':
          noDecayingArmor = true
          break

        case 'naturalArmor':
          naturalArmor += effect.amount
          break
        case 'armorRepairAfterCombat':
          armorRepair += effect.amount
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
    noDecayingArmor,
    naturalArmor,
    armorRepair,
    chances,
  }
}

function signed(amount: number): string {
  return amount >= 0 ? `+${amount}` : String(amount)
}

function signedPercent(fraction: number): string {
  const percent = Math.round(fraction * 100)
  return percent >= 0 ? `+${percent}%` : `${percent}%`
}

/**
 * HOW MUCH A DESCRIPTION EXPLAINS ITSELF.
 *
 * `verbose` says what changed AND what that means: "+20% Accuracy (of your
 * misses)" spells out that a chance takes a share of what is left rather
 * than twenty flat points, which is the difference between an item worth
 * taking and an item worth taking twice.
 *
 * `concise` says only WHAT CHANGED. The explanation is the same sentence at
 * every fight forever once it has been read once, and it is what stops a
 * narration line fitting a narrow editor slot. Nothing is abbreviated away
 * that a player could not recover -- the names stay whole, only the gloss
 * goes.
 *
 * ONE ARGUMENT, REQUIRED, threaded from the setting rather than defaulted:
 * a default would mean a call site that forgot it silently stays verbose,
 * and this is exactly the rule that has to hold at every describer or at
 * none. `StageContext.describe` carries it so no stage reads the save for
 * it twice.
 */
export type DescriptionStyle = 'verbose' | 'concise'

/** The style a save's settings ask for. The one place this is decided. */
export function descriptionStyleOf(settings: { verboseDescriptions: boolean }): DescriptionStyle {
  return settings.verboseDescriptions ? 'verbose' : 'concise'
}

/**
 * A percentage of a derived value, in words -- and, when verbose, what it is
 * a percentage OF.
 *
 * "+20% Accuracy" is read as twenty points by everybody, and for a chance it
 * is a fifth of the misses instead. The complement is named rather than left
 * to be inferred (stats.ts's CHANCE_COMPLEMENTS). Concise drops the
 * parenthesis and nothing else: the quantity and its name are what changed,
 * and the rest was the explanation.
 */
function describePercent(key: DerivedKey, percent: number, style: DescriptionStyle): string {
  const head = `${signedPercent(percent)} ${DERIVED_LABELS[key]}`
  if (style === 'concise' || !isChanceKey(key)) return head
  const complement = CHANCE_COMPLEMENTS[key]
  return `${head} (of ${percent >= 0 ? complement.failure : complement.success})`
}

/**
 * "Initial" and "Final", which is what the two round positions ARE.
 *
 * The verbose form is a clause ("on your first action of a round") and reads
 * as a condition the reader has to apply; the concise form is an ADJECTIVE on
 * the quantity, which is the same fact in the position a reader already
 * scans. Both name the stat, so neither loses anything.
 */
export const ROUND_POSITION_WORD: Readonly<Record<'first' | 'last', string>> = {
  first: 'Initial',
  last: 'Final',
}

/**
 * One effect, in words, computed from the SAME declaration the resolver
 * reads -- which is the whole reason effects are data. An effect that
 * depends on what is held says so and shows its current value, because a
 * player reading "+10% per item" still has to count their own items to know
 * what it is doing for them right now.
 */
export function describeEffect(effect: ModifierEffect, style: DescriptionStyle): string {
  const concise = style === 'concise'
  switch (effect.kind) {
    case 'statDelta':
      return `${signed(effect.amount)} ${STAT_LABELS[effect.stat]}`
    case 'derivedPercent':
      return describePercent(effect.derived, effect.percent, style)
    case 'derivedPercentPerHolding': {
      // THE RULE, and never the running total. The total was shown beside it
      // once -- "+15% per item (2 held: +30%)" -- and it is wrong in the one
      // place these are read most: at character creation nothing is held, so
      // a real effect announced itself as +0% and looked like nothing. What
      // an offer IS does not depend on what you happen to be carrying when
      // you look at it, and the carried count is on the bar anyway.
      const noun = effect.holding === 'item' ? 'item' : 'trait'
      return `${signedPercent(effect.percentPer)} ${DERIVED_LABELS[effect.derived]} per ${noun}`
    }
    case 'derivedPercentWhileHealth': {
      const head = describePercent(effect.derived, effect.percent, style)
      // The band's WORD is the concise form: it is a term the game uses
      // everywhere, so it needs no gloss once it has been met. Verbose says
      // where the line actually falls, which is the only place to find out.
      if (effect.subject === 'target') {
        // "vs maimed" -- the preposition is the whole difference, and it is
        // the same word in both styles because there is no shorter way to say
        // "theirs, not mine" and no reader who could guess it.
        return concise
          ? `${head} vs ${effect.band}`
          : `${head} against ${bandWithArticle(effect.band)} foe (${HEALTH_BAND_BOUNDS[effect.band]})`
      }
      return concise ? `${head} ${effect.band}` : `${head} while ${effect.band} (${HEALTH_BAND_BOUNDS[effect.band]})`
    }
    case 'derivedPercentOnAction': {
      if (concise) {
        // The position becomes an ADJECTIVE on the quantity rather than a
        // trailing clause: "+30% Initial Damage", not "+30% Damage on your
        // first action of a round".
        return `${signedPercent(effect.percent)} ${ROUND_POSITION_WORD[effect.position]} ${DERIVED_LABELS[effect.derived]}`
      }
      return `${describePercent(effect.derived, effect.percent, style)} on your ${effect.position} action of a round`
    }
    case 'armorSlot':
      return concise ? `${effect.amount} Armor` : `${effect.amount} Armor, worn down as it absorbs`
    case 'armorRepairAfterCombat':
      return concise
        ? `${signed(effect.amount)} Mending`
        : `${signed(effect.amount)} Armor to every item after each fight`
    case 'noDecayingArmor':
      return concise ? 'no Armor' : 'worn Armor counts for nothing'
    case 'naturalArmor':
      return concise
        ? `${signed(effect.amount)} Natural Armor`
        : `${signed(effect.amount)} Armor that cannot decay`
  }
}

/** Every line the tab bar shows while this modifier is in the selection spot. */
export function describeModifier(modifier: Modifier, style: DescriptionStyle): string[] {
  return modifier.effects.map((effect) => describeEffect(effect, style))
}

/** This item's own armor pool, and the floor decay may not take it below. */
export function armorSlotOf(modifier: Modifier): { amount: number } | null {
  let amount: number | null = null
  for (const effect of modifier.effects) {
    if (effect.kind === 'armorSlot') amount = (amount ?? 0) + effect.amount
  }
  if (amount === null) return null
  return { amount: Math.max(0, Math.floor(amount)) }
}
