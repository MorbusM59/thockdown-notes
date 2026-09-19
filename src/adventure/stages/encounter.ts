// Reading an encounter offer out of stage state, building the monster it
// names, and naming it.
//
// A stage stores the OFFER -- three ids, a rank and a head count -- and never
// the monster. That is the same discipline character creation follows: state
// holds what was chosen, and everything derivable is derived again from
// content. `buildMonster` rolls nothing, so rebuilding it mid-fight cannot
// disagree with the one the fight started against.
//
// THE NAME IS DERIVED TOO, and that is new. Names used to be authored per
// species per rank ("Goblin Chieftain", "Pack of Orcs") and stored on the
// offer, which meant a hand-written table that had to be kept in step with
// what a creature actually was -- and a stored string that a content edit
// could leave describing a different monster. A name is now READ OFF THE
// FOUR VECTORS, in their own order: rank, build, species, class.
//
//     Champion Hulking Orc Bruiser
//     Runt Sly Kobold Trickster x3
//
// which is exactly the sentence the vectors already are, and cannot go stale
// because there is nothing to keep in step.

import type { JsonObject } from '../core/json'
import type { Content } from '../content'
import type { StageContext } from '../core/stage'
import type { EncounterOffer } from '../model/encounterOffers'
import { totalArmor } from '../model/armor'
import { describeMove } from '../model/moves'
import type { DescriptionStyle } from '../model/modifiers'
import { buildMonster, type Monster } from '../model/monsters'
import { runTuning } from '../model/gameState'
import { MONSTER_TYPES, MONSTER_TYPE_WORD, monsterTier, type MonsterType } from '../model/vectors'

export function offerToJson(offer: EncounterOffer): JsonObject {
  return {
    buildId: offer.buildId,
    speciesId: offer.speciesId,
    classId: offer.classId,
    type: offer.type,
    count: offer.count,
  }
}

export function offerFromJson(value: JsonObject[''] | undefined): EncounterOffer | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const { buildId, speciesId, classId, type, count } = row
  if (typeof buildId !== 'string' || typeof speciesId !== 'string' || typeof classId !== 'string') return null
  if (!MONSTER_TYPES.includes(type as MonsterType)) return null
  return {
    buildId,
    speciesId,
    classId,
    type: type as MonsterType,
    // A saved count that is missing or nonsense is ONE, not a crash and not a
    // re-roll: a re-roll would make a reloaded fight a different fight.
    count: typeof count === 'number' && Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1,
  }
}

/** The three vectors an offer names, looked up. Any of them may be missing from content. */
export function vectorsOf(offer: EncounterOffer, content: Content) {
  return {
    build: content.builds.find((candidate) => candidate.id === offer.buildId) ?? null,
    species: content.species.find((candidate) => candidate.id === offer.speciesId) ?? null,
    combatClass: content.combatClasses.find((candidate) => candidate.id === offer.classId) ?? null,
  }
}

/**
 * WHAT IT IS CALLED: rank, build, species, class, and a count where there is
 * more than one of them.
 *
 * A missing vector is simply left out rather than replaced with a word, so a
 * content edit that drops a species reads as a shorter name instead of as
 * "Unknown". The rank word is empty for a regular, which is what makes an
 * ordinary monster read as "Hulking Orc Bruiser" and not "Regular Hulking
 * Orc Bruiser".
 */
export function monsterName(offer: EncounterOffer, content: Content): string {
  const { build, species, combatClass } = vectorsOf(offer, content)
  const words = [MONSTER_TYPE_WORD[offer.type], build?.name, species?.name, combatClass?.name]
    .filter((word): word is string => typeof word === 'string' && word.length > 0)
  const name = words.join(' ')
  return offer.count > 1 ? `${name} ×${offer.count}` : name
}

export function monsterFor(offer: EncounterOffer, context: StageContext): Monster | null {
  if (!context.game || !context.profile) return null
  const { build, species, combatClass } = vectorsOf(offer, context.content)
  return buildMonster({
    build,
    species,
    combatClass,
    type: offer.type,
    tier: monsterTier(offer.type, context.game.level),
    level: context.game.level,
    // RESOLVED, not read off the record: in free mode the live slider
    // overrides what the run was created with, and `runTuning` is the one
    // place that knows which (model/gameState.ts).
    progression: runTuning(context.game, context.save.settings).progression,
    against: context.profile.stats,
    count: offer.count,
  })
}

/**
 * The SPECIES' icon, because the species is what the thing IS. The build is
 * an adjective and the class is a job; neither is a picture of a creature.
 */
export function iconFor(offer: EncounterOffer, context: StageContext): string {
  return vectorsOf(offer, context.content).species?.icon ?? 'fa-solid fa-paw'
}

/**
 * WHAT A MONSTER IS, in the lines an offer's detail pill shows -- written
 * once because the hub and the hunt both show it, and a creature that read
 * differently depending on which screen offered it would be two creatures.
 *
 * The TIER leads, because it is the one number that says how much of a
 * creature this is and it is the same number on every offer -- which is what
 * makes two offers comparable at a glance in a way four derived quantities
 * never were.
 *
 * Armour is CONDITIONAL, and deliberately unlike the player's own armour
 * readout (which is shown at zero, because a status line that appears only
 * when interesting teaches that armour is something that happens to you).
 * This is not a status line: it is a description of one creature, and "0
 * armour" on every goblin is a line that says nothing on nine offers in ten.
 *
 * The CLASS'S MOVES are last and are the reason a class is worth naming: a
 * player who reads "Ambush: 250% of a blow, on the first action of a fight"
 * knows what the first exchange is going to cost them, which is a decision
 * they can act on rather than a surprise.
 */
export function monsterDetailLines(monster: Monster, style: DescriptionStyle, count = monster.count): string[] {
  const armor = totalArmor(monster.armor)
  return [
    // A MONSTER's tier, which is the one tier that still belongs in a
    // description: it is how the two offers on a screen are compared. The
    // PLAYER's tier is a standing quantity of the run and lives on the bar.
    `Tier ${monster.tier}`,
    ...(count > 1 ? [`${count} of them, fought as one`] : []),
    `${monster.maxHitPoints} Health`,
    `${monster.maxActions} Action${monster.maxActions === 1 ? '' : 's'} a round`,
    `${Math.round(monster.damage)} Damage a blow`,
    ...(armor > 0 ? [`${armor} Armor, and magic goes through it`] : []),
    ...(monster.combatClass?.moves ?? []).flatMap((move) => [`${move.name}: ${describeMove(move, style)[0] ?? ''}`]),
  ]
}
