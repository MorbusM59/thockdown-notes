// AN ITEM IS ROLLED FROM A TEMPLATE, once per run.
//
// A trait is a written thing: somebody decided what Cornered Animal does and
// it does that forever. An item is not. A template says what a Spyglass COULD
// be -- which stats it would plausibly sharpen, which odds it would plausibly
// shift, which of the richer effects suit it -- and the run rolls which of
// those it actually is. Thirty templates is thirty items in any one run and a
// different thirty in the next, without thirty numbers to hand-tune.
//
// ONCE PER RUN, PER TEMPLATE, and that is the load-bearing half.
//
// A roll at the moment of the OFFER would mean the Spyglass in the market and
// the Spyglass in the chest are different objects with one name, that the same
// cell shows different numbers if the screen is re-entered, and that every
// unacquired offer has to be persisted so it survives a reload. A roll per run
// means a Spyglass is simply what a Spyglass is in this world: the save keeps
// referring to items BY ID exactly as it did, the keep-marks, the carry limit,
// the "already held" filters and the market table all keep working untouched,
// and nothing new is written to disk at all.
//
// The stream is the run's own seed mixed with the template's id
// (core/rng.ts's `seedFrom`), NOT one sequence walked template by template.
// That is what lets a thirty-first item be added to content without silently
// re-rolling the other thirty for every save in existence.
//
// THE SLOTS, and what each one is for:
//
//   armor    -- a pool of armor belonging to this item (model/armor.ts).
//               Present only where the fiction carries it, ALWAYS filled when
//               it is, and taken FIRST: a breastplate that rolled no armor
//               would be a breastplate in name only.
//   stat     -- a stat point or three, drawn from the stats the template says
//               it suits. Two such slots exist and an item may roll both, but
//               never the same stat twice.
//   derived  -- a percentage on one of the odds or quantities the template
//               suits: 10% to 50%, in tens. What that percentage MEANS differs
//               between a chance and a quantity, and the difference is
//               model/modifiers.ts's to state, not this file's.
//   verbose  -- one of the richer effects: conditional on how the fight is
//               going, on where in the round the action falls, or on what else
//               is being carried.
//
// Two or three slots are filled, armor counting as one of them. Fewer would
// make an item a stat stick; more would make every item a build.

import { nextInt, nextPick, nextSample, seedFrom, type RngState } from '../core/rng'
import type { Modifier, ModifierEffect } from './modifiers'
import type { DerivedKey } from './stats'
import type { StatKey } from './stats'

/** What a stat slot is worth. Both ends included. */
export const STAT_SLOT_RANGE = [1, 3] as const

/** What a derived slot is worth, and the step it moves in. */
export const DERIVED_SLOT_RANGE = [0.1, 0.5] as const
export const DERIVED_SLOT_STEP = 0.1

/** How many slots an item fills, armor counting as one. Both ends included. */
export const SLOT_COUNT_RANGE = [2, 3] as const

/**
 * The verbose effects, by name. A template lists the ones that suit it and the
 * roll picks one; each knows how to build itself out of the template's own
 * thematic keys, so a verbose effect is never about something the item has no
 * business touching.
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
  /** The opening blow of a round. */
  | 'opener'
  /** The last thing you do before the round turns over. */
  | 'finisher'
  /** Worth more the more you are carrying. */
  | 'collector'
  /** Worth more the narrower you have specialised. */
  | 'studied'
  /** This item's own armor wears only so far. Armour templates only. */
  | 'tempered'
  /** Armor nothing can wear away. */
  | 'ward'
  /** Sees to the whole kit after every fight. */
  | 'repair'

export const VERBOSE_IDS: readonly VerboseId[] = [
  'desperate', 'opener', 'finisher', 'collector', 'studied', 'tempered', 'ward', 'repair',
]

/**
 * What an item COULD be. Authored in content; never itself a `Modifier`.
 *
 * Each list is the template's own sense of what suits it -- a spyglass
 * sharpens Perception and what Perception buys, and has no opinion about
 * Might. An empty list simply makes that slot unavailable, which is how a
 * plain trinket ends up as two stat points and nothing else.
 */
export interface ItemTemplate {
  id: string
  name: string
  icon: string
  /** Stats a stat slot may draw. Two slots draw without repeating. */
  stats: readonly StatKey[]
  /** Derived values a derived slot -- or a conditional verbose one -- may draw. */
  derived: readonly DerivedKey[]
  /** The verbose effects that suit this thing. */
  verbose: readonly VerboseId[]
  /**
   * Present exactly when the thing is armour. `[min, max]` points, both ends
   * included. The slot is then always filled -- see the module comment.
   */
  armor?: readonly [number, number]
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

/** A slot, named, so the sampler can draw from a list of them. */
type SlotKind = 'statA' | 'statB' | 'derived' | 'verbose'

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
 * conditional on a derived value needs a derived list to draw from, and
 * `tempered` needs armor to temper. Content should not name one it cannot
 * fill, and `validateContent` says so; this stays defensive because the
 * alternative is an item that rolled an undefined effect.
 */
function rollVerbose(id: VerboseId, template: ItemTemplate, rng: RngState): { effect: ModifierEffect | null; rng: RngState } {
  const drawDerived = (state: RngState, within?: readonly DerivedKey[]) => nextPick(
    state,
    within ? template.derived.filter((key) => within.includes(key)) : template.derived,
  )

  switch (id) {
    case 'desperate': {
      const key = drawDerived(rng, IN_A_FIGHT)
      if (!key.value) return { effect: null, rng: key.rng }
      const size = nextInt(key.rng, 3, 6)
      const threshold = nextInt(size.rng, 0, 1)
      return {
        effect: {
          kind: 'derivedPercentWhileHurt',
          derived: key.value,
          percent: roundStep(size.value / 10, 0.1),
          belowFraction: threshold.value === 0 ? 1 / 3 : 1 / 2,
        },
        rng: threshold.rng,
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
    case 'tempered': {
      if (!template.armor) return { effect: null, rng }
      // A FRACTION of whatever this item's armor rolled, not a number of its
      // own: a floor of four on a piece that rolled three is a piece that
      // never wears at all, which is a different item.
      const share = nextInt(rng, 2, 4)
      return { effect: { kind: 'armorDecayFloor', floor: share.value }, rng: share.rng }
    }
    case 'ward': {
      const size = nextInt(rng, 2, 5)
      return { effect: { kind: 'naturalArmor', amount: size.value }, rng: size.rng }
    }
    case 'repair': {
      const size = nextInt(rng, 1, 2)
      return { effect: { kind: 'armorRepairAfterCombat', amount: size.value }, rng: size.rng }
    }
  }
}

/**
 * ONE ITEM, as it is in this run.
 *
 * Deterministic in `(runSeed, template.id)` and in nothing else -- not in the
 * order templates are listed, not in how many there are, not in what the run
 * has done so far. Calling it twice gives the same item, which is what lets
 * the catalog be rebuilt from the save at any moment rather than stored.
 */
export function rollItem(template: ItemTemplate, runSeed: RngState): Modifier {
  let rng = seedFrom(runSeed, template.id)
  const effects: ModifierEffect[] = []

  // ARMOR FIRST, and unconditionally where the template carries it. It is one
  // of the two or three slots, so an armour item spends a slot on being
  // armour and rolls one or two others.
  let armorAmount = 0
  if (template.armor) {
    const drawn = nextInt(rng, template.armor[0], template.armor[1])
    rng = drawn.rng
    armorAmount = Math.max(1, drawn.value)
    effects.push({ kind: 'armorSlot', amount: armorAmount })
  }

  const available: SlotKind[] = [
    ...(template.stats.length > 0 ? (['statA'] as SlotKind[]) : []),
    ...(template.stats.length > 1 ? (['statB'] as SlotKind[]) : []),
    ...(template.derived.length > 0 ? (['derived'] as SlotKind[]) : []),
    ...(template.verbose.length > 0 ? (['verbose'] as SlotKind[]) : []),
  ]

  const total = nextInt(rng, SLOT_COUNT_RANGE[0], SLOT_COUNT_RANGE[1])
  rng = total.rng
  const wanted = Math.max(1, total.value - (template.armor ? 1 : 0))
  const picked = nextSample(rng, available, wanted)
  rng = picked.rng
  const slots = new Set(picked.value)

  // Both stat slots draw from ONE sample, so an item that rolled two of them
  // cannot put its points into the same stat twice -- which would read as one
  // bigger slot and quietly break the 1..3 range.
  const statSlots = (slots.has('statA') ? 1 : 0) + (slots.has('statB') ? 1 : 0)
  if (statSlots > 0) {
    const stats = nextSample(rng, template.stats, statSlots)
    rng = stats.rng
    for (const stat of stats.value) {
      const amount = nextInt(rng, STAT_SLOT_RANGE[0], STAT_SLOT_RANGE[1])
      rng = amount.rng
      effects.push({ kind: 'statDelta', stat, amount: amount.value })
    }
  }

  if (slots.has('derived')) {
    const key = nextPick(rng, template.derived)
    rng = key.rng
    if (key.value) {
      const size = rollDerivedPercent(rng)
      rng = size.rng
      effects.push({ kind: 'derivedPercent', derived: key.value, percent: size.percent })
    }
  }

  if (slots.has('verbose')) {
    const id = nextPick(rng, template.verbose)
    rng = id.rng
    if (id.value) {
      const built = rollVerbose(id.value, template, rng)
      rng = built.rng
      if (built.effect) {
        // A temper cannot be deeper than the piece it hardens, and the armor
        // slot is already rolled by the time this runs -- so the clamp is
        // arithmetic here rather than a rule `armorSlotOf` has to re-apply.
        if (built.effect.kind === 'armorDecayFloor') {
          const floor = Math.min(built.effect.floor, Math.max(0, armorAmount - 1))
          if (floor > 0) effects.push({ kind: 'armorDecayFloor', floor })
        } else {
          effects.push(built.effect)
        }
      }
    }
  }

  return { id: template.id, kind: 'item', name: template.name, icon: template.icon, effects }
}

/** Everything wrong with a template, as complaints. Run in a test -- see content/index.ts. */
export function validateItemTemplate(template: ItemTemplate): string[] {
  const problems: string[] = []
  const where = `item template "${template.id}"`
  if (template.stats.length === 0 && template.derived.length === 0 && template.verbose.length === 0 && !template.armor) {
    problems.push(`${where} can fill no slot at all`)
  }
  if (new Set(template.stats).size !== template.stats.length) problems.push(`${where} lists a stat twice`)
  if (new Set(template.derived).size !== template.derived.length) problems.push(`${where} lists a derived value twice`)
  if (template.armor && template.armor[0] > template.armor[1]) problems.push(`${where} has an inverted armor range`)
  if (template.armor && template.armor[0] < 1) problems.push(`${where} may roll no armor at all`)
  if (!template.armor && template.verbose.includes('tempered')) {
    problems.push(`${where} names "tempered" but carries no armor to temper`)
  }
  const standing: readonly VerboseId[] = ['collector', 'studied']
  if (template.derived.length === 0 && template.verbose.some((id) => standing.includes(id))) {
    problems.push(`${where} names a scaling verbose effect but no derived value for it to act on`)
  }
  // The two narrowed sets, checked HERE rather than left to roll into nothing:
  // a slot that silently comes up empty is an item with one fewer slot than
  // the design says it has, and nothing says so.
  const needs = (ids: readonly VerboseId[], within: readonly DerivedKey[], what: string) => {
    if (!template.verbose.some((id) => ids.includes(id))) return
    if (template.derived.some((key) => within.includes(key))) return
    problems.push(`${where} names ${what} but no derived value it could act on`)
  }
  needs(['desperate'], IN_A_FIGHT, 'a below-hit-points effect')
  needs(['opener', 'finisher'], IN_A_ROUND, 'a first/last-action effect')
  return problems
}
