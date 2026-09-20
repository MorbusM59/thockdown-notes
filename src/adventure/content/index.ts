// Content: everything the game is made of that a player never changes.
//
// Ships with the app, is never written, and changes every release -- which
// is exactly why it is TypeScript data rather than rows in the save
// database. A copy in the database would need a migration per content edit
// and could drift from the code that reads it; a copy in code cannot.
//
// The save refers to all of this BY ID and tolerates an id that content no
// longer has (dropped, never crashed on), which is what lets an item or a
// region be deleted without breaking somebody's game.
//
// WHAT IS AND IS NOT SPECIFIED: the game's rules document leaves large
// parts deliberately blank, and this module does not fill them in. An entry
// whose effect has not been decided carries a `tag` effect that says so, in
// words, which means an unspecified trait is visible AS unspecified -- in
// the tab bar, to the player, rather than as a plausible number nobody
// chose. See docs/adventure-platform.md.

import type { Modifier } from '../model/modifiers'
import { ENCOUNTER_POOL_IDS, type Build, type CombatClass, type Species } from '../model/vectors'
import { STAT_KEYS } from '../model/stats'
import { rollModifier, validateTemplate, type ModifierTemplate } from '../model/modifierSlots'
import type { RngState } from '../core/rng'
import { DEFENCES } from '../model/defences'

/** The four a move may replace, beside `attack`. Read as strings by the validator. */
const DEFENCE_IDS: readonly string[] = DEFENCES

/**
 * THE FOUR VECTORS live in model/vectors.ts, and content declares lists of
 * them. They are re-exported here so a caller that wants "the content types"
 * gets all of them from one place, and so the old `MonsterClass`/`Origin`
 * pair cannot be reached by accident: both are gone, their jobs split across
 * `Build`, `Species` and `CombatClass`.
 */
export { ENCOUNTER_POOL_IDS, type EncounterPoolId } from '../model/vectors'
export type { Build, CombatClass, CombatMove, MonsterType, Species } from '../model/vectors'

/**
 * Where a level is played. A region is meant to determine which encounters
 * and which monsters are in scope for that level; those pools are NOT
 * specified yet, so a region is currently a name and nothing more. The
 * fields for the pools are not written until there is something to put in
 * them -- an empty array is a promise, and this document does not make ones
 * it cannot keep.
 */
export interface Region {
  id: string
  name: string
  icon: string
  /**
   * THE TWO BORDERS this region lies between, named -- which is what a player
   * reads when choosing where to go. Not decoration: the names ARE the two
   * groups of five its traits come from, so reading them tells you what can
   * be found here and, because a neighbour shares one of them, which way to
   * travel for more of it.
   */
  borders: readonly string[]
  /**
   * WHICH TRAITS THIS PLACE BREEDS -- the ten a special event here may offer
   * (stages/encounterSelect.ts's omen). Every trait belongs to two regions
   * and every region holds ten, which is not a coincidence to be maintained
   * by hand: the regions are a RING and the traits are authored on the
   * borders between them, so a region is the two groups it lies between. See
   * `content/thockquest.ts`.
   *
   * By ID, like everything else the save and the content share, so a trait
   * renamed or dropped costs a name in a list rather than a broken region.
   */
  traits: readonly string[]
}

export interface Content {
  /** VECTOR ONE. Shared: a monster and a player are shaped from the same list. */
  builds: readonly Build[]
  /**
   * What an item and a trait COULD be. Rolled into actual modifiers once per
   * run, from the run's own seed -- see `catalogFor` and
   * model/modifierSlots.ts. Templates rather than modifiers because the
   * numbers are not content's to decide.
   *
   * TWO LISTS rather than one with a filter, because they are two pools: gold
   * buys from one and experience from the other, and every screen that offers
   * knows which it is offering. Each entry still carries its own `kind`, so
   * nothing downstream has to remember which list it came out of.
   */
  items: readonly ModifierTemplate[]
  traits: readonly ModifierTemplate[]
  regions: readonly Region[]
  /** VECTOR THREE. `playable` splits the peoples from what you fight. */
  species: readonly Species[]
  /** VECTOR FOUR. Shared, like builds -- an orc bruiser fights like a bruiser. */
  combatClasses: readonly CombatClass[]
}

/**
 * THE RUN'S CATALOG: every trait as written, and every item as this run rolled
 * it.
 *
 * Keyed by the run's seed and MEMOIZED, because it is asked for constantly --
 * every profile resolution, every screen, every effect applied -- and rolling
 * thirty templates each time would be thirty hashes and a hundred draws per
 * keypress. The cache is per `Content` object (a WeakMap, so a test's own
 * content is collected with it) and per seed, and it is safe to be a cache at
 * all precisely because the roll is a pure function of those two things: a
 * miss and a hit cannot disagree.
 *
 * Seed 0 is the no-run case -- the welcome screen resolves a catalog before
 * any game exists, so that "what is a Whetstone" has an answer even with
 * nothing to answer it for.
 */
const CATALOG_CACHE = new WeakMap<Content, Map<RngState, ReadonlyMap<string, Modifier>>>()

export function catalogFor(content: Content, runSeed: RngState): ReadonlyMap<string, Modifier> {
  let bySeed = CATALOG_CACHE.get(content)
  if (!bySeed) {
    bySeed = new Map()
    CATALOG_CACHE.set(content, bySeed)
  }
  const cached = bySeed.get(runSeed)
  if (cached) return cached

  const built: ReadonlyMap<string, Modifier> = new Map(
    [...content.items, ...content.traits].map((template) => [template.id, rollModifier(template, runSeed)] as const),
  )
  bySeed.set(runSeed, built)
  return built
}

/** One pool this run, rolled, in content's own order. The ordered half of `catalogFor`. */
export function rolledPool(content: Content, runSeed: RngState, kind: 'item' | 'trait'): Modifier[] {
  const catalog = catalogFor(content, runSeed)
  return (kind === 'item' ? content.items : content.traits).flatMap((template) => {
    const rolled = catalog.get(template.id)
    return rolled ? [rolled] : []
  })
}

/**
 * Everything that can be wrong with content, as a list of complaints rather
 * than a throw. Run in a test, not at launch: content is fixed at build
 * time, so a content error is a failing test on somebody's branch, never a
 * crash in somebody's evening.
 */
export function validateContent(content: Content): string[] {
  const problems: string[] = []
  const seen = new Set<string>()

  const check = (id: string, where: string) => {
    if (id.length === 0) problems.push(`${where} has an empty id`)
    if (seen.has(id)) problems.push(`duplicate id "${id}" (${where})`)
    seen.add(id)
  }

  // --- THE FOUR VECTORS, and what each one is FORBIDDEN from doing -------
  //
  // This is the half of the vector rule that cannot be enforced by a type:
  // `ModifierEffect` is one union, so nothing stops a species declaring a
  // `statDelta` except this. Without it, the first interesting monster puts
  // two Might on a species and within a release the vectors overlap again --
  // which is exactly how the arrangement this replaced came apart.

  for (const build of content.builds) {
    check(build.id, `build "${build.name}"`)
    const weights = STAT_KEYS.map((key) => build.weights[key] ?? 0)
    if (weights.some((weight) => weight < 0)) {
      problems.push(`build "${build.id}" has a negative weight: a weight is a share, and a negative share has no meaning`)
    }
    if (weights.every((weight) => weight <= 0)) {
      problems.push(`build "${build.id}" has no positive weight: every tier would resolve to nothing`)
    }
  }

  // Two builds with the same normalised ratio are one build with two names,
  // and a player choosing between them is choosing nothing.
  const shapes = new Map<string, string>()
  for (const build of content.builds) {
    const weights = STAT_KEYS.map((key) => build.weights[key] ?? 0)
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    if (total <= 0) continue
    const shape = weights.map((weight) => (weight / total).toFixed(4)).join(':')
    const first = shapes.get(shape)
    if (first) problems.push(`builds "${first}" and "${build.id}" are the same shape in different words`)
    else shapes.set(shape, build.id)
  }

  for (const species of content.species) {
    check(species.id, `species "${species.name}"`)
    if (species.effects.length === 0) {
      problems.push(`species "${species.id}" does nothing: a species with no effects is a name`)
    }
    if (!species.playable && !species.encounterPool) {
      problems.push(`monster species "${species.id}" is missing an encounterPool: it would never be trackable`)
    }
    if (species.encounterPool && !ENCOUNTER_POOL_IDS.includes(species.encounterPool)) {
      problems.push(`species "${species.id}" is in an unknown encounterPool: ${species.encounterPool}`)
    }
    for (const effect of species.effects) {
      if (effect.kind === 'statDelta') {
        problems.push(`species "${species.id}" carries a statDelta: stats are the build's and the tier's (model/vectors.ts)`)
      }
      // An armour SLOT is a pool that decays and is repaired per item. A
      // species is not carried and cannot be dropped, so its toughness is
      // natural armour -- the half decay cannot touch.
      if (effect.kind === 'armorSlot') {
        problems.push(`species "${species.id}" carries ${effect.kind}: a species has no decaying pool, only natural armour`)
      }
    }
  }
  if (!content.species.some((species) => species.playable)) {
    problems.push('no playable species: character creation would have nothing to offer')
  }
  if (!content.species.some((species) => !species.playable)) {
    problems.push('no monster species: an encounter would have nothing to be')
  }

  const moveIds = new Set<string>()
  for (const combatClass of content.combatClasses) {
    check(combatClass.id, `class "${combatClass.name}"`)
    if (combatClass.moves.length === 0) {
      problems.push(`class "${combatClass.id}" has no moves: a class that swaps nothing is a name`)
    }
    for (const move of combatClass.moves) {
      if (moveIds.has(move.id)) problems.push(`duplicate move id "${move.id}" (class "${combatClass.id}")`)
      moveIds.add(move.id)
      if (move.when.kind === 'chance' && (move.when.chance <= 0 || move.when.chance > 1)) {
        problems.push(`move "${move.id}" has a chance of ${move.when.chance}, which is not a chance`)
      }
      if ((move.strikes ?? 1) < 1) problems.push(`move "${move.id}" strikes fewer than once`)
      if ((move.damageShare ?? 1) < 0) problems.push(`move "${move.id}" has negative damage`)
      // A defence that replaces `dodge` only ever appears when dodge was
      // offered, which is a roll -- so a class whose ONLY move is a dodge
      // swap does nothing on most turns. That is allowed; what is not is a
      // move that replaces a choice nobody has.
      if (move.replaces !== 'attack' && !DEFENCE_IDS.includes(move.replaces)) {
        problems.push(`move "${move.id}" replaces "${move.replaces}", which is not a choice anybody is offered`)
      }
    }
  }

  // A class's moves must not ALL be unconditional replacements of the same
  // cell: the second would be unreachable, since the first declared wins.
  for (const combatClass of content.combatClasses) {
    const unconditional = new Set<string>()
    for (const move of combatClass.moves) {
      if (move.when.kind !== 'always') continue
      if (unconditional.has(move.replaces)) {
        problems.push(`class "${combatClass.id}" has two unconditional moves for "${move.replaces}"; the second can never fire`)
      }
      unconditional.add(move.replaces)
    }
    // Same defect one step subtler: an unconditional move declared ABOVE a
    // conditional one for the same cell makes the conditional unreachable.
    const seenAlways = new Set<string>()
    for (const move of combatClass.moves) {
      if (seenAlways.has(move.replaces)) {
        problems.push(`class "${combatClass.id}" declares "${move.id}" below an unconditional move for the same choice; it can never fire`)
      }
      if (move.when.kind === 'always') seenAlways.add(move.replaces)
    }
  }

  for (const region of content.regions) check(region.id, `region "${region.name}"`)

  for (const template of [...content.items, ...content.traits]) {
    check(template.id, `${template.kind} "${template.name}"`)
    problems.push(...validateTemplate(template))
  }
  // WHICH LIST a template is in has to agree with what it says it is, because
  // the pools are what a screen offers from and `kind` is what everything
  // downstream reads. A trait in the item list would be bought with gold and
  // resolved as a trait.
  for (const template of content.items) {
    if (template.kind !== 'item') problems.push(`"${template.id}" is in the item pool but declares itself a ${template.kind}`)
  }
  for (const template of content.traits) {
    if (template.kind !== 'trait') problems.push(`"${template.id}" is in the trait pool but declares itself a ${template.kind}`)
  }

  if (content.builds.length === 0) problems.push('no builds: nothing would have a stat block')
  if (content.regions.length === 0) problems.push('no regions: a level would have nowhere to happen')
  if (content.combatClasses.length === 0) problems.push('no classes: nothing would have anything to do in a fight')

  return problems
}

export { THOCKQUEST } from './thockquest'
