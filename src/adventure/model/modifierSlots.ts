// A MODIFIER IS ROLLED FROM A TEMPLATE, once per run -- items and traits
// alike.
//
// A template says what a thing is ABOUT -- which stats it would plausibly
// sharpen, which odds it would plausibly shift, which of the richer effects
// suit it, and whether it is armour -- and the run rolls which of those it
// actually is. Sixty templates is sixty things in any one run and a different
// sixty in the next, without sixty numbers to hand-tune.
//
// ONCE PER RUN, PER TEMPLATE, and that is the load-bearing half.
//
// A roll at the moment of the OFFER would mean the Spyglass in the market and
// the Spyglass in the chest are different objects with one name, that the same
// cell shows different numbers if the screen is re-entered, and that every
// unacquired offer has to be persisted so it survives a reload. A roll per run
// means a Spyglass is simply what a Spyglass is in this world: the save keeps
// referring to modifiers BY ID exactly as it did, the keep-marks, the carry
// limit, the "already held" filters and the market table all keep working
// untouched, and nothing new is written to disk at all.
//
// The stream is the run's own seed mixed with the template's id
// (core/rng.ts's `seedFrom`), NOT one sequence walked template by template.
// That is what lets a sixty-first template be added to content without
// silently re-rolling the other sixty for every save in existence.
//
// THE SLOTS, and what each one is for:
//
//   armor    -- present only where the fiction carries it, ALWAYS filled when
//               it is, and taken FIRST: a breastplate that rolled no armor
//               would be a breastplate in name only. What it grants differs by
//               kind and by nothing else -- an ITEM gets a pool of its own
//               that wears as it absorbs, a TRAIT gets armor decay cannot
//               touch (model/armor.ts). A third of the size, because a point
//               that never wears is worth several that do.
//   stat     -- a stat point or three, drawn from the stats the template says
//               it suits. ITEMS ONLY, and there are two of them.
//   derived  -- a percentage on one of the odds or quantities the template
//               suits: 10% to 50%, in tens. What that percentage MEANS differs
//               between a chance and a quantity, and the difference is
//               model/modifiers.ts's to state, not this file's.
//   verbose  -- one of the richer effects: conditional on how the fight is
//               going, on where in the round the action falls, or on what else
//               is being carried. ITEMS get one; TRAITS get two.
//
// WHY THE TWO KINDS DIFFER, and why it is a declared PLAN rather than two
// rollers: gold buys items and experience buys traits, but nothing below that
// distinction cared which was which -- one `Modifier` shape, one resolver, one
// carry rule. That still holds. What differs is only which slots exist, so
// that is the only thing written down twice (`SLOT_PLAN`), and the roller
// reads it. An item is GEAR -- it is the thing that carries you past the base
// stat cap, which is what stat slots are for. A trait is something you ARE,
// and cannot be picked up, so it buys the odd and the particular instead.
//
// Two or three slots are filled, armor counting as one of them. Fewer would
// make a modifier a stat stick; more would make every one of them a build.

import { nextInt, nextPick, nextSample, seedFrom, type RngState } from '../core/rng'
import type { Modifier, ModifierEffect, ModifierKind } from './modifiers'
import type { DerivedKey, StatKey } from './stats'

/** What a stat slot is worth. Both ends included. */
export const STAT_SLOT_RANGE = [1, 3] as const

/** What a derived slot is worth, and the step it moves in. */
export const DERIVED_SLOT_RANGE = [0.1, 0.5] as const
export const DERIVED_SLOT_STEP = 0.1

/**
 * What an armor slot is worth, by what it grants rather than by who grants it.
 *
 * A DECAYING pool is spent as it absorbs and is rebuilt between fights only as
 * far as its owner can maintain it; a NATURAL point cannot be worn away at
 * all. So a third, and the ratio is the whole of the reasoning -- one point
 * that survives a level is worth several that do not.
 *
 * ONE RANGE PER SLOT, not one per template. Every other slot in this file is
 * declared here and drawn from here; armor was eight hand-written pairs in
 * content, which is eight numbers to re-tune every time the damage curve moves
 * and eight chances to write an armour item that is not one.
 */
export const DECAYING_ARMOR_RANGE = [3, 9] as const
export const NATURAL_ARMOR_RANGE = [1, 3] as const

/** How many slots a modifier fills, armor counting as one. Both ends included. */
export const SLOT_COUNT_RANGE = [2, 3] as const

/**
 * The verbose effects, by name. A template lists the ones that suit it and the
 * roll picks as many as its kind has slots for; each knows how to build itself
 * out of the template's own thematic keys, so a verbose effect is never about
 * something the modifier has no business touching.
 *
 * The list is short on purpose. Every entry here has to REACH THE FIGHT --
 * `npm run adventure:sim -- --rank` pins each one in turn and prints what it
 * is actually worth, and a row that does not move is an effect that never
 * arrives. An effect nobody can feel is worse than a slot left empty, because
 * the slot at least reads as empty.
 */
export type VerboseId =
  /** Fights harder with its back to the wall. */
  | 'desperate'
  | 'hale'
  /** The opening blow of a round. */
  | 'opener'
  /** The last thing you do before the round turns over. */
  | 'finisher'
  /** Worth more the more you are carrying. */
  | 'collector'
  /** Worth more the narrower you have specialised. */
  | 'studied'
  /** This thing's own armor wears only so far. Armour ITEMS only -- a trait's armor never wears. */
  /** Armor nothing can wear away. Items only -- a trait's armor slot IS this. */
  | 'ward'
  /** Sees to the whole kit after every fight. */
  | 'repair'

export const VERBOSE_IDS: readonly VerboseId[] = [
  'desperate', 'hale', 'opener', 'finisher', 'collector', 'studied', 'ward', 'repair',
]

/**
 * What a modifier COULD be. Authored in content; never itself a `Modifier`.
 *
 * Each list is the template's own sense of what suits it -- a spyglass
 * sharpens Perception and what Perception buys, and has no opinion about
 * Might. An empty list simply makes that slot unavailable.
 */
export interface ModifierTemplate {
  id: string
  kind: ModifierKind
  name: string
  icon: string
  /** Stats a stat slot may draw. Two slots draw without repeating. Items only. */
  stats?: readonly StatKey[]
  /** Derived values a derived slot -- or a conditional verbose one -- may draw. */
  derived: readonly DerivedKey[]
  /** The verbose effects that suit this thing. */
  verbose: readonly VerboseId[]
  /**
   * Whether the thing is armour. The slot is then always filled -- see the
   * module comment -- with a decaying pool for an item and a natural one for a
   * trait.
   */
  armor?: boolean
}

/** A slot, named, so the sampler can draw from a list of them. */
type SlotKind = 'stat' | 'derived' | 'verbose'

/**
 * WHICH SLOTS EACH KIND HAS, in the one place the two differ. Repeats are
 * real: an item has two stat slots and a trait has two verbose ones, and the
 * sampler draws distinct ENTRIES from this list.
 */
export const SLOT_PLAN: Readonly<Record<ModifierKind, readonly SlotKind[]>> = {
  item: ['stat', 'stat', 'derived', 'verbose'],
  trait: ['derived', 'verbose', 'verbose'],
}

function slotsOfKind(kind: ModifierKind, slot: SlotKind): number {
  return SLOT_PLAN[kind].filter((entry) => entry === slot).length
}

/**
 * WHAT A CONDITIONAL VERBOSE EFFECT MAY ACT ON, and why it is not simply the
 * template's whole list.
 *
 * Both of these are "the effect has to reach the fight" stated precisely, and
 * both were found by reading a rolled catalog rather than by reasoning:
 *
 * `IN_A_FIGHT` -- what a below-hit-points condition may move. Everything a
 * fight reads, MINUS `maxHitPoints`: a modifier that raises the ceiling only
 * while its owner is under it is a loop, because `followMaxHitPoints` grants
 * the rise as hit points, which can lift them back over the threshold, which
 * drops the ceiling again. The two meta counts are out for the plainer reason
 * that "more encounter choices while bleeding" is not what the effect is about.
 *
 * `IN_A_ROUND` -- what a first/last-action condition may move, which is
 * narrower still. The round's action COUNT is read from the plain profile
 * (`stages/combat.ts`'s `actingProfile` says why: an effect that adds actions
 * on the last action of a round would be deciding when the last action is), so
 * "+70% Actions on your first action" is a line that reads well and does
 * nothing at all. That is exactly the class of defect
 * `model/modifierReach.test.ts` exists for, and the fix is not to let it be
 * rolled.
 */
const IN_A_FIGHT: readonly DerivedKey[] = [
  'damageMultiplier', 'dodgeChance', 'hitChance', 'critChance', 'actionsPerRound',
]
const IN_A_ROUND: readonly DerivedKey[] = ['damageMultiplier', 'dodgeChance', 'hitChance', 'critChance']

function roundStep(value: number, step: number): number {
  return Math.round(value / step) * step
}

function rollDerivedPercent(rng: RngState): { percent: number; rng: RngState } {
  const steps = Math.round((DERIVED_SLOT_RANGE[1] - DERIVED_SLOT_RANGE[0]) / DERIVED_SLOT_STEP)
  const draw = nextInt(rng, 0, steps)
  return { percent: roundStep(DERIVED_SLOT_RANGE[0] + draw.value * DERIVED_SLOT_STEP, DERIVED_SLOT_STEP), rng: draw.rng }
}

/**
 * One verbose effect, built out of the template's own thematic keys.
 *
 * Returns null where the template cannot support the id it named -- a
 * conditional on a derived value needs one of the right kind to draw from.
 * Content should not name one it cannot fill, and `validateTemplate` says so;
 * this stays defensive because the alternative is a modifier that rolled an
 * undefined effect.
 */
function rollVerbose(
  id: VerboseId,
  template: ModifierTemplate,
  rng: RngState,
): { effect: ModifierEffect | null; rng: RngState } {
  const drawDerived = (state: RngState, within?: readonly DerivedKey[]) => nextPick(
    state,
    within ? template.derived.filter((key) => within.includes(key)) : template.derived,
  )

  switch (id) {
    case 'desperate': {
      // ONE OF THE TWO HURT BANDS (model/health.ts). `maimed` is the narrower
      // window and so the bigger swing; `injured` includes it and pays less.
      const key = drawDerived(rng, IN_A_FIGHT)
      if (!key.value) return { effect: null, rng: key.rng }
      const size = nextInt(key.rng, 3, 6)
      const which = nextInt(size.rng, 0, 1)
      return {
        effect: {
          kind: 'derivedPercentWhileHealth',
          derived: key.value,
          percent: roundStep(size.value / 10, 0.1),
          band: which.value === 0 ? 'maimed' : 'injured',
          subject: 'self',
        },
        rng: which.rng,
      }
    }
    case 'hale': {
      // THE OTHER SIDE OF THE SAME COIN, and the only way `healthy` is
      // reachable at all: a bonus for being in good condition, which rewards
      // a kit built to stay there rather than one built to be nearly dead.
      const key = drawDerived(rng, IN_A_FIGHT)
      if (!key.value) return { effect: null, rng: key.rng }
      const size = nextInt(key.rng, 2, 5)
      return {
        effect: {
          kind: 'derivedPercentWhileHealth',
          derived: key.value,
          percent: roundStep(size.value / 10, 0.1),
          band: 'healthy',
          subject: 'self',
        },
        rng: size.rng,
      }
    }
    case 'opener':
    case 'finisher': {
      const key = drawDerived(rng, IN_A_ROUND)
      if (!key.value) return { effect: null, rng: key.rng }
      const size = nextInt(key.rng, 3, 8)
      return {
        effect: {
          kind: 'derivedPercentOnAction',
          derived: key.value,
          percent: roundStep(size.value / 10, 0.1),
          position: id === 'opener' ? 'first' : 'last',
        },
        rng: size.rng,
      }
    }
    case 'collector':
    case 'studied': {
      const key = drawDerived(rng)
      if (!key.value) return { effect: null, rng: key.rng }
      const size = nextInt(key.rng, 1, 3)
      return {
        effect: {
          kind: 'derivedPercentPerHolding',
          derived: key.value,
          percentPer: roundStep(size.value / 20, 0.05),
          holding: id === 'collector' ? 'item' : 'trait',
        },
        rng: size.rng,
      }
    }
    case 'ward': {
      // The same range the trait armor slot draws from, because it grants the
      // same thing: a point decay cannot touch is worth what it is worth
      // whoever hands it over.
      const size = nextInt(rng, NATURAL_ARMOR_RANGE[0], NATURAL_ARMOR_RANGE[1])
      return { effect: { kind: 'naturalArmor', amount: size.value }, rng: size.rng }
    }
    case 'repair': {
      const size = nextInt(rng, 1, 2)
      return { effect: { kind: 'armorRepairAfterCombat', amount: size.value }, rng: size.rng }
    }
  }
}

/**
 * ONE MODIFIER, as it is in this run.
 *
 * Deterministic in `(runSeed, template.id)` and in nothing else -- not in the
 * order templates are listed, not in how many there are, not in what the run
 * has done so far. Calling it twice gives the same thing, which is what lets
 * the catalog be rebuilt from the save at any moment rather than stored.
 */
export function rollModifier(template: ModifierTemplate, runSeed: RngState): Modifier {
  let rng = seedFrom(runSeed, template.id)
  const effects: ModifierEffect[] = []
  const stats = template.stats ?? []

  // ARMOR FIRST, and unconditionally where the template carries it. It is one
  // of the two or three slots, so an armour thing spends a slot on being
  // armour and rolls one or two others.
  let armorAmount = 0
  if (template.armor) {
    const range = template.kind === 'item' ? DECAYING_ARMOR_RANGE : NATURAL_ARMOR_RANGE
    const drawn = nextInt(rng, range[0], range[1])
    rng = drawn.rng
    armorAmount = Math.max(1, drawn.value)
    effects.push(template.kind === 'item'
      ? { kind: 'armorSlot', amount: armorAmount }
      : { kind: 'naturalArmor', amount: armorAmount })
  }

  // The plan, less the slots this template cannot fill. Indices rather than
  // names, because the plan repeats entries and the sampler draws DISTINCT
  // ones -- two stat slots are two draws, not one.
  const plan = SLOT_PLAN[template.kind]
  const available = plan
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot, index }) => {
      if (slot === 'derived') return template.derived.length > 0
      if (slot === 'verbose') return template.verbose.length > plan.slice(0, index).filter((s) => s === 'verbose').length
      return stats.length > plan.slice(0, index).filter((s) => s === 'stat').length
    })

  const total = nextInt(rng, SLOT_COUNT_RANGE[0], SLOT_COUNT_RANGE[1])
  rng = total.rng
  const wanted = Math.max(1, total.value - (template.armor ? 1 : 0))
  const picked = nextSample(rng, available, wanted)
  rng = picked.rng
  const chosen = picked.value.map((entry) => entry.slot)

  // Each repeated slot draws from ONE sample, so a thing that rolled two of
  // them cannot spend both on the same stat or the same verbose effect --
  // which would read as one bigger slot and quietly break its range.
  const statSlots = chosen.filter((slot) => slot === 'stat').length
  if (statSlots > 0) {
    const drawn = nextSample(rng, stats, statSlots)
    rng = drawn.rng
    for (const stat of drawn.value) {
      const amount = nextInt(rng, STAT_SLOT_RANGE[0], STAT_SLOT_RANGE[1])
      rng = amount.rng
      effects.push({ kind: 'statDelta', stat, amount: amount.value })
    }
  }

  if (chosen.includes('derived')) {
    const key = nextPick(rng, template.derived)
    rng = key.rng
    if (key.value) {
      const size = rollDerivedPercent(rng)
      rng = size.rng
      effects.push({ kind: 'derivedPercent', derived: key.value, percent: size.percent })
    }
  }

  const verboseSlots = chosen.filter((slot) => slot === 'verbose').length
  if (verboseSlots > 0) {
    const ids = nextSample(rng, template.verbose, verboseSlots)
    rng = ids.rng
    for (const id of ids.value) {
      const built = rollVerbose(id, template, rng)
      rng = built.rng
      if (built.effect) effects.push(built.effect)
    }
  }

  return { id: template.id, kind: template.kind, name: template.name, icon: template.icon, effects }
}

/** Everything wrong with a template, as complaints. Run in a test -- see content/index.ts. */
export function validateTemplate(template: ModifierTemplate): string[] {
  const problems: string[] = []
  const where = `${template.kind} template "${template.id}"`
  const stats = template.stats ?? []

  if (template.kind === 'trait' && stats.length > 0) {
    // A trait is something you ARE and cannot be picked up; gear is what
    // carries a character past the base stat cap. Declaring stats on one would
    // roll nothing (the plan has no stat slot) and read as content that does.
    problems.push(`${where} declares stats, and a trait has no stat slot to put them in`)
  }
  if (stats.length === 0 && template.derived.length === 0 && template.verbose.length === 0 && !template.armor) {
    problems.push(`${where} can fill no slot at all`)
  }
  if (new Set(stats).size !== stats.length) problems.push(`${where} lists a stat twice`)
  if (new Set(template.derived).size !== template.derived.length) problems.push(`${where} lists a derived value twice`)
  if (new Set(template.verbose).size !== template.verbose.length) problems.push(`${where} lists a verbose effect twice`)

  // ENOUGH TO FILL THE MINIMUM. Naming fewer options than its kind has slots
  // for is fine and often deliberate -- a Whetstone is Might and nothing else,
  // so it simply rolls one stat slot rather than two. What is NOT fine is a
  // template that cannot reach two slots at all, because then it rolls a
  // modifier thinner than the design says any of them are and nothing says so.
  const capacity = (template.armor ? 1 : 0)
    + Math.min(stats.length, slotsOfKind(template.kind, 'stat'))
    + (template.derived.length > 0 ? 1 : 0)
    + Math.min(template.verbose.length, slotsOfKind(template.kind, 'verbose'))
  if (capacity < SLOT_COUNT_RANGE[0]) {
    problems.push(`${where} can fill ${capacity} slot(s), and every modifier fills at least ${SLOT_COUNT_RANGE[0]}`)
  }

  if (template.kind !== 'item' && template.verbose.includes('ward')) {
    // A trait's armor slot grants natural armor already, so naming `ward`
    // beside it is naming the same slot twice -- and a trait that rolled both
    // came out with two identical effects, which is one slot spent for
    // nothing. An item's `ward` is a real second thing, because ITS armor slot
    // grants a pool that wears.
    problems.push(`${where} names "ward", which for a trait is what its own armor slot grants`)
  }

  const standing: readonly VerboseId[] = ['collector', 'studied']
  if (template.derived.length === 0 && template.verbose.some((id) => standing.includes(id))) {
    problems.push(`${where} names a scaling verbose effect but no derived value for it to act on`)
  }
  // The two narrowed sets, checked HERE rather than left to roll into nothing:
  // a slot that silently comes up empty is a modifier with one fewer slot than
  // the design says it has.
  const needs = (ids: readonly VerboseId[], within: readonly DerivedKey[], what: string) => {
    if (!template.verbose.some((id) => ids.includes(id))) return
    if (template.derived.some((key) => within.includes(key))) return
    problems.push(`${where} names ${what} but no derived value it could act on`)
  }
  needs(['desperate'], IN_A_FIGHT, 'a below-hit-points effect')
  needs(['opener', 'finisher'], IN_A_ROUND, 'a first/last-action effect')
  return problems
}
