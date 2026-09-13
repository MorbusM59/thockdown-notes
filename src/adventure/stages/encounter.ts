// Reading an encounter offer out of stage state, and building the monster it
// names.
//
// A stage stores the OFFER -- four strings -- and never the monster. That is
// the same discipline character creation follows with `offerIds`: state holds
// what was chosen, and everything derivable is derived again from content.
// `buildMonster` rolls nothing, so rebuilding it mid-fight cannot disagree
// with the one the fight started against.

import type { JsonObject } from '../core/json'
import type { MonsterClassId } from '../content'
import type { StageContext } from '../core/stage'
import type { EncounterOffer } from '../model/encounterOffers'
import { buildMonster, MONSTER_TYPES, type Monster, type MonsterType } from '../model/monsters'
import { addStats, createStatBlock, type StatBlock } from '../model/stats'

export function offerToJson(offer: EncounterOffer): JsonObject {
  return { speciesId: offer.speciesId, name: offer.name, classId: offer.classId, type: offer.type }
}

export function offerFromJson(value: JsonObject[''] | undefined): EncounterOffer | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const { speciesId, name, classId, type } = row
  if (typeof speciesId !== 'string' || typeof name !== 'string') return null
  if (classId !== 'warrior' && classId !== 'thief' && classId !== 'mage') return null
  if (!MONSTER_TYPES.includes(type as MonsterType)) return null
  return { speciesId, name, classId: classId as MonsterClassId, type: type as MonsterType }
}

/**
 * The base stats a monster starts from: its CLASS's, plus its SPECIES'.
 *
 * Addition, so the order of the two does not matter -- and the type's own
 * shift is added by `buildMonster` on top, for the same reason.
 */
export function monsterBaseStats(offer: EncounterOffer, context: StageContext): StatBlock {
  const cls = context.content.monsterClasses.find((candidate) => candidate.id === offer.classId)
  const species = context.content.species.find((candidate) => candidate.id === offer.speciesId)
  return addStats(addStats(createStatBlock(0), cls?.statDeltas ?? {}), species?.statDeltas ?? {})
}

export function monsterFor(offer: EncounterOffer, context: StageContext): Monster | null {
  if (!context.game || !context.profile) return null
  return buildMonster({
    classId: offer.classId,
    classBaseStats: monsterBaseStats(offer, context),
    type: offer.type,
    level: context.game.level,
    // The RUN's preset, fixed when it started -- not the settings, which are
    // what the next run will be played under (model/gameState.ts).
    difficulty: context.game.difficulty,
    against: context.profile.stats,
  })
}

export function iconFor(offer: EncounterOffer, context: StageContext): string {
  return context.content.monsterClasses.find((candidate) => candidate.id === offer.classId)?.icon
    ?? 'fa-solid fa-paw'
}
