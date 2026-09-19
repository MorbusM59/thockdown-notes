// What a level offers at each of its ten encounters.
//
// A level is ten encounters. The fifth and ninth are mini bosses and the
// tenth is the boss, and at those there is nothing to choose -- the encounter
// is the encounter. Everywhere else the player picks from `2 + Perception/2`
// of them.
//
// AN OFFER IS FOUR IDS AND A HEAD COUNT, and nothing else: the build, the
// species, the class and the rank, plus how many of them there are. The
// monster is rebuilt from those every time it is needed (stages/encounter.ts)
// and its NAME is derived from them too, so there is no stored string that
// can disagree with what the creature turned out to be.
//
// The first choice is always a REGULAR, so no reading of the dice can open a
// level with three packs of runts. Every further choice is drawn at random
// and must not repeat one already on the list.
//
// UNIQUENESS is by SPECIES, CLASS AND RANK, and deliberately not by the
// build too. The rule exists to make a list VARIED, and a Hulking Orc
// Bruiser beside a Wiry Orc Bruiser is the same fight with a different
// adjective -- the build changes how hard it hits, the species and the class
// change what the fight IS. (The species was excluded from this key while a
// species was only a name and a stat delta; it now carries the whole non-stat
// vector, so a Golem and an Imp are no longer interchangeable and the key
// says so.)

import { nextChance, nextInt, nextPick, type RngState } from '../core/rng'
import type { Build, CombatClass, Species } from '../content'
import { MONSTER_BUDDY_CHANCES, type MonsterType } from './vectors'

export const LEVEL_ENCOUNTER_COUNT = 10

/** 1-based positions in the level. Fixed, not drawn. */
export const MINI_BOSS_ENCOUNTERS: readonly number[] = [5, 9]
export const BOSS_ENCOUNTER = 10

/** What an ordinary encounter may be. Mini bosses and bosses are placed, never rolled. */
export const OFFERABLE_TYPES: readonly MonsterType[] = ['runt', 'regular', 'elite']

export interface EncounterOffer {
  buildId: string
  speciesId: string
  classId: string
  type: MonsterType
  /** Bodies, fought as one. At least 1; see `rollCount`. */
  count: number
}

/** The rank a given position in the level is fixed at, or null where the player chooses. */
export function fixedTypeAt(encounter: number): MonsterType | null {
  if (encounter === BOSS_ENCOUNTER) return 'boss'
  return MINI_BOSS_ENCOUNTERS.includes(encounter) ? 'miniBoss' : null
}

/** What may appear only once in a list: what the fight IS, not what it is called. */
function identityOf(offer: EncounterOffer): string {
  return `${offer.speciesId}:${offer.classId}:${offer.type}`
}

/**
 * HOW MANY OF THEM, rolled once per offer and stored on it.
 *
 * One draw per possible friend, in order, and it STOPS at the first refusal:
 * a second buddy is a friend of the first, so a creature that came alone
 * cannot have a second companion. Written as a loop over the rank's own
 * chance list (model/vectors.ts) so the rule is the data, and a chance of 1
 * still costs a draw -- the alternative is a special case that makes the
 * seeded stream depend on which rank was rolled.
 */
export function rollCount(type: MonsterType, rng: RngState): { count: number; rng: RngState } {
  let current = rng
  let count = 1
  for (const chance of MONSTER_BUDDY_CHANCES[type]) {
    const draw = nextChance(current, chance)
    current = draw.rng
    if (!draw.value) break
    count += 1
  }
  return { count, rng: current }
}

function drawOffer(
  builds: readonly Build[],
  species: readonly Species[],
  classes: readonly CombatClass[],
  type: MonsterType,
  rng: RngState,
): { offer: EncounterOffer | null; rng: RngState } {
  const pickedBuild = nextPick(rng, builds)
  if (!pickedBuild.value) return { offer: null, rng: pickedBuild.rng }
  const pickedSpecies = nextPick(pickedBuild.rng, species)
  if (!pickedSpecies.value) return { offer: null, rng: pickedSpecies.rng }
  const pickedClass = nextPick(pickedSpecies.rng, classes)
  if (!pickedClass.value) return { offer: null, rng: pickedClass.rng }
  const counted = rollCount(type, pickedClass.rng)
  return {
    offer: {
      buildId: pickedBuild.value.id,
      speciesId: pickedSpecies.value.id,
      classId: pickedClass.value.id,
      type,
      count: counted.count,
    },
    rng: counted.rng,
  }
}

/**
 * How many draws to spend looking for one that is not already on the list.
 *
 * This is NOT converge-by-retrying: the pool is small and finite, the draw is
 * uniform, and the bound exists because the caller asked for more offers than
 * the content can distinguish -- at which point the honest answer is a
 * shorter list, not a longer loop. The alternative, enumerating every legal
 * combination and shuffling, would be exact; it is not obviously better,
 * because the enumeration is the thing that grows with content and the list
 * a player sees never will.
 */
const DRAW_ATTEMPTS = 24

/**
 * WHAT A MONSTER MAY BE DRAWN FROM, in one place.
 *
 * Every build and every class, and the species that are NOT one of the
 * peoples. That last filter is the only asymmetry between the two sides of
 * the game and it lives here rather than at the two call sites (the hub and
 * the hunt), because a rule stated at two of them is a rule the third will
 * not know about.
 */
export function monsterPools(content: {
  builds: readonly Build[]
  species: readonly Species[]
  combatClasses: readonly CombatClass[]
}): OfferPools {
  return {
    builds: content.builds,
    species: content.species.filter((species) => !species.playable),
    classes: content.combatClasses,
  }
}

export interface OfferPools {
  builds: readonly Build[]
  /** Already filtered to what a monster may be -- the caller owns that rule. */
  species: readonly Species[]
  classes: readonly CombatClass[]
}

export function buildEncounterOffers(options: OfferPools & {
  encounter: number
  choiceCount: number
  rng: RngState
}): { offers: EncounterOffer[]; rng: RngState } {
  const fixed = fixedTypeAt(options.encounter)
  if (fixed) {
    // No choice at a boss. One encounter, drawn from the whole pool.
    const drawn = drawOffer(options.builds, options.species, options.classes, fixed, options.rng)
    return { offers: drawn.offer ? [drawn.offer] : [], rng: drawn.rng }
  }

  const wanted = Math.max(1, Math.floor(options.choiceCount))
  const offers: EncounterOffer[] = []
  const seen = new Set<string>()
  let rng = options.rng

  // The opener is always a regular, so the dice can never present a level's
  // first decision as a choice between three packs.
  const first = drawOffer(options.builds, options.species, options.classes, 'regular', rng)
  rng = first.rng
  if (first.offer) {
    offers.push(first.offer)
    seen.add(identityOf(first.offer))
  }

  while (offers.length < wanted) {
    let added = false
    for (let attempt = 0; attempt < DRAW_ATTEMPTS && !added; attempt += 1) {
      const type = nextInt(rng, 0, OFFERABLE_TYPES.length - 1)
      rng = type.rng
      const drawn = drawOffer(options.builds, options.species, options.classes, OFFERABLE_TYPES[type.value], rng)
      rng = drawn.rng
      if (!drawn.offer || seen.has(identityOf(drawn.offer))) continue
      offers.push(drawn.offer)
      seen.add(identityOf(drawn.offer))
      added = true
    }
    // Content cannot distinguish any more of them. A shorter list is the
    // honest answer; a longer loop is not.
    if (!added) break
  }

  return { offers, rng }
}
