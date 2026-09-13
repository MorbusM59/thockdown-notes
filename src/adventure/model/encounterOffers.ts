// What a level offers at each of its ten encounters.
//
// A level is ten encounters. The fifth and ninth are mini bosses and the
// tenth is the boss, and at those there is nothing to choose -- the encounter
// is the encounter. Everywhere else the player picks from `2 + Perception/2`
// of them.
//
// The first of those choices is always a RANDOM SPECIES AT REGULAR RANK, so
// no reading of the dice can open with three packs. Every further choice is
// drawn at random and must be a combination not already on the list.
//
// UNIQUENESS is by CLASS AND TYPE, and deliberately not by the species too.
// The rule exists to make a list VARIED, and three regular warriors from
// three different species is not a varied list -- it is the same fight three
// times wearing different names. Widening the key to include the species
// would let exactly that through.

import { nextInt, nextPick, type RngState } from '../core/rng'
import type { MonsterClassId, MonsterForm, Species } from '../content'
import type { MonsterType } from './monsters'

export const LEVEL_ENCOUNTER_COUNT = 10

/** 1-based positions in the level. Fixed, not drawn. */
export const MINI_BOSS_ENCOUNTERS: readonly number[] = [5, 9]
export const BOSS_ENCOUNTER = 10

/** What an ordinary encounter may be. Mini bosses and bosses are placed, never rolled. */
export const OFFERABLE_TYPES: readonly MonsterType[] = ['group', 'regular', 'elite']

export interface EncounterOffer {
  speciesId: string
  /** The form's own name -- "Dire Wolf", "Pack of Orcs". What the ring shows. */
  name: string
  classId: MonsterClassId
  type: MonsterType
}

/** The rank a given position in the level is fixed at, or null where the player chooses. */
export function fixedTypeAt(encounter: number): MonsterType | null {
  if (encounter === BOSS_ENCOUNTER) return 'boss'
  return MINI_BOSS_ENCOUNTERS.includes(encounter) ? 'miniBoss' : null
}

/** What may appear only once in a list: how it FIGHTS, not what it is called. */
function identityOf(offer: EncounterOffer): string {
  return `${offer.classId}:${offer.type}`
}

function classesFor(form: MonsterForm, allClasses: readonly MonsterClassId[]): readonly MonsterClassId[] {
  return form.classes.length > 0 ? form.classes : allClasses
}

function drawOffer(
  species: readonly Species[],
  allClasses: readonly MonsterClassId[],
  type: MonsterType,
  rng: RngState,
): { offer: EncounterOffer | null; rng: RngState } {
  const pickedSpecies = nextPick(rng, species)
  if (!pickedSpecies.value) return { offer: null, rng: pickedSpecies.rng }
  const forms = pickedSpecies.value.forms[type]
  const pickedForm = nextPick(pickedSpecies.rng, forms)
  if (!pickedForm.value) return { offer: null, rng: pickedForm.rng }
  const classes = classesFor(pickedForm.value, allClasses)
  const pickedClass = nextPick(pickedForm.rng, classes)
  if (!pickedClass.value) return { offer: null, rng: pickedClass.rng }
  return {
    offer: {
      speciesId: pickedSpecies.value.id,
      name: pickedForm.value.name,
      classId: pickedClass.value,
      type,
    },
    rng: pickedClass.rng,
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

export function buildEncounterOffers(options: {
  encounter: number
  choiceCount: number
  species: readonly Species[]
  classes: readonly MonsterClassId[]
  rng: RngState
}): { offers: EncounterOffer[]; rng: RngState } {
  const fixed = fixedTypeAt(options.encounter)
  if (fixed) {
    // No choice at a boss. One encounter, drawn from whatever species can
    // field that rank.
    const drawn = drawOffer(options.species, options.classes, fixed, options.rng)
    return { offers: drawn.offer ? [drawn.offer] : [], rng: drawn.rng }
  }

  const wanted = Math.max(1, Math.floor(options.choiceCount))
  const offers: EncounterOffer[] = []
  const seen = new Set<string>()
  let rng = options.rng

  // The opener is always a regular, so the dice can never present a level's
  // first decision as a choice between three packs.
  const first = drawOffer(options.species, options.classes, 'regular', rng)
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
      const drawn = drawOffer(options.species, options.classes, OFFERABLE_TYPES[type.value], rng)
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
