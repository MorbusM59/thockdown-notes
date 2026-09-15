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
import { totalArmor } from '../model/armor'
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

/**
 * WHAT A MONSTER IS, in the lines an offer's detail pill shows -- written
 * once because the hub and the hunt both show it, and a creature that read
 * differently depending on which screen offered it would be two creatures.
 *
 * Armour is the one CONDITIONAL line, and deliberately unlike the player's
 * own armour readout (which is shown at zero, because a status line that
 * appears only when interesting teaches that armour is something that
 * happens to you). This is not a status line: it is a description of one
 * creature, and "0 armour" on every goblin is a line that says nothing on
 * nine offers in ten.
 */
export function monsterDetailLines(monster: Monster): string[] {
  const armor = totalArmor(monster.armor)
  return [
    `${monster.maxHitPoints} hit points`,
    `${monster.maxActions} action${monster.maxActions === 1 ? '' : 's'} a round`,
    `${Math.round(monster.damage)} damage a blow`,
    ...(armor > 0 ? [`${armor} armour, and magic goes through it`] : []),
  ]
}
