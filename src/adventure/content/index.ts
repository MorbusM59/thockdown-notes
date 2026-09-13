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
import type { StatKey } from '../model/stats'

/**
 * A monster's CLASS -- what it fights like. The same three the player's own
 * origins are built from, on the same stat scale.
 *
 * Bard is deliberately absent: the design's monster classes are the fighting
 * three. A charisma-shaped monster would be interesting (Talk is one of the
 * plan's own monster actions) and is not written.
 */
export type MonsterClassId = 'warrior' | 'thief' | 'mage'

export const MONSTER_CLASS_IDS: readonly MonsterClassId[] = ['warrior', 'thief', 'mage']

export interface MonsterClass {
  id: MonsterClassId
  statDeltas: Partial<Record<StatKey, number>>
}

/**
 * One shape a species takes at one type -- its NAME at that rank, and which
 * classes it may be.
 *
 * A type can have more than one form: a Beast group is a pack of wolves or a
 * pack of boars, and which it is decides both the name and the class. That
 * is why this is a list per type rather than a name and a class list.
 */
export interface MonsterForm {
  name: string
  /** Empty means any class. */
  classes: readonly MonsterClassId[]
}

/** WHAT a monster is: its stat modifiers, and what it is called at each rank. */
export interface Species {
  id: string
  name: string
  statDeltas: Partial<Record<StatKey, number>>
  /** One or more forms per type. Every type must have at least one. */
  forms: Readonly<Record<'group' | 'regular' | 'elite' | 'miniBoss' | 'boss', readonly MonsterForm[]>>
}

/** What you were, before any of this. Chosen once, at the start of a game. */
export interface Origin {
  id: string
  name: string
  icon: string
  statDeltas: Partial<Record<StatKey, number>>
}

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
}

export interface Content {
  origins: readonly Origin[]
  items: readonly Modifier[]
  traits: readonly Modifier[]
  regions: readonly Region[]
  monsterClasses: readonly MonsterClass[]
  species: readonly Species[]
}

export function buildCatalog(content: Content): ReadonlyMap<string, Modifier> {
  return new Map([...content.items, ...content.traits].map((modifier) => [modifier.id, modifier]))
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

  for (const origin of content.origins) check(origin.id, `origin "${origin.name}"`)
  for (const region of content.regions) check(region.id, `region "${region.name}"`)
  for (const species of content.species) {
    check(species.id, `species "${species.name}"`)
    // Every rank needs at least one form, or the offer generator has nothing
    // to name a monster of that type and would silently skip the species.
    for (const [type, forms] of Object.entries(species.forms)) {
      if (forms.length === 0) problems.push(`species "${species.id}" has no ${type} form`)
      for (const form of forms) {
        const unknown = form.classes.filter((id) => !content.monsterClasses.some((cls) => cls.id === id))
        for (const id of unknown) problems.push(`species "${species.id}" form "${form.name}" allows unknown class "${id}"`)
      }
    }
  }
  for (const item of content.items) {
    check(item.id, `item "${item.name}"`)
    if (item.kind !== 'item') problems.push(`item "${item.id}" is declared as a ${item.kind}`)
  }
  for (const trait of content.traits) {
    check(trait.id, `trait "${trait.name}"`)
    if (trait.kind !== 'trait') problems.push(`trait "${trait.id}" is declared as a ${trait.kind}`)
  }

  if (content.origins.length === 0) problems.push('no origins: character creation would have nothing to offer')
  if (content.regions.length === 0) problems.push('no regions: a level would have nowhere to happen')
  if (content.species.length === 0) problems.push('no species: an encounter would have nothing to be')
  if (content.monsterClasses.length === 0) problems.push('no monster classes: a monster would have no stats')

  return problems
}

export { THOCKQUEST } from './thockquest'
