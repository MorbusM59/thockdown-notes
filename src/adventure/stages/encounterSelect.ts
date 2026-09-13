// The hub a level keeps returning to: what do you do next.
//
// It also counts. A level is ten encounters, the fifth and ninth are mini
// bosses and the tenth is the boss, and at those three there is nothing to
// choose -- the encounter is the encounter. Everywhere else the player picks
// how to look for one.
//
// The count arrives as INPUT and leaves as input to the next stage in the
// chain (see levelProgress.ts). This stage does not hold it across an
// encounter, because it is not underneath one: every stage in an encounter
// replaces the last at the same depth, and the chain comes back here.

import type { JsonObject } from '../core/json'
import type { StageModule } from '../core/stage'
import { MONSTER_CLASS_IDS } from '../content'
import { buildEncounterOffers, fixedTypeAt, LEVEL_ENCOUNTER_COUNT } from '../model/encounterOffers'
import { iconFor, monsterFor, offerFromJson, offerToJson } from './encounter'
import { encounterIndexOf, isLevelComplete } from './levelProgress'
import { COMBAT_STAGE_ID, ENCOUNTER_SELECT_STAGE_ID, HUNT_STAGE_ID, REGION_SELECT_STAGE_ID } from './ids'


const ADVANCE_CHOICE = 'level:advance'

export const encounterSelectStage: StageModule = {
  id: ENCOUNTER_SELECT_STAGE_ID,
  title: 'Wilds',

  enter: (input, context, rng) => {
    const encounter = encounterIndexOf(input.encounterIndex)
    const fixed = fixedTypeAt(encounter)
    if (!fixed || isLevelComplete(encounter)) {
      return { state: { encounterIndex: encounter, fixedOffer: null } satisfies JsonObject, rng }
    }
    // A boss is PLACED, so it is drawn here rather than offered: one species
    // able to field that rank, and no choice about it.
    const drawn = buildEncounterOffers({
      encounter,
      choiceCount: 1,
      species: context.content.species,
      classes: MONSTER_CLASS_IDS,
      rng,
    })
    const offer = drawn.offers[0]
    return {
      state: {
        encounterIndex: encounter,
        fixedOffer: offer ? offerToJson(offer) : null,
      } satisfies JsonObject,
      narration: offer
        ? `**${offer.name}.** *It has been waiting for you.*`
        : 'Something should be here, and the game cannot say what.',
      rng: drawn.rng,
    }
  },

  present: (state, context) => {
    const encounter = encounterIndexOf(state.encounterIndex)

    if (isLevelComplete(encounter)) {
      return {
        screenKey: 'encounter:levelComplete',
        choices: [{
          id: ADVANCE_CHOICE,
          label: 'Press on',
          icon: 'fa-solid fa-flag-checkered',
          detail: { title: 'The road again', lines: ['A new region, and ten more encounters'] },
        }],
      }
    }

    const fixed = offerFromJson(state.fixedOffer ?? undefined)
    if (fixed) {
      const monster = monsterFor(fixed, context)
      return {
        screenKey: `encounter:fixed:${encounter}`,
        choices: [{
          id: 'encounter:fixed',
          label: fixed.name,
          icon: iconFor(fixed, context),
          detail: monster
            ? {
                title: fixed.name,
                lines: [
                  `${monster.maxHitPoints} hit points`,
                  `${monster.maxActions} action${monster.maxActions === 1 ? '' : 's'} a round`,
                  `${Math.round(monster.damage)} damage a blow`,
                ],
              }
            : undefined,
        }],
      }
    }

    return {
      screenKey: `encounter:open:${encounter}`,
      choices: [
        { id: 'encounter:hunt', label: 'Go Hunting', icon: 'fa-solid fa-paw' },
        { id: 'encounter:explore', label: 'Go Exploring', icon: 'fa-solid fa-compass' },
        { id: 'encounter:special', label: 'Special Encounter', icon: 'fa-solid fa-dice' },
      ],
    }
  },

  resolve: (state, choiceId, _context, rng) => {
    const encounter = encounterIndexOf(state.encounterIndex)

    if (choiceId === ADVANCE_CHOICE) {
      return {
        kind: 'replace',
        stageId: REGION_SELECT_STAGE_ID,
        effects: [{ kind: 'advanceLevel' }],
        narration: 'That is a level behind you.',
        rng,
      }
    }

    const fixed = offerFromJson(state.fixedOffer ?? undefined)
    if (choiceId === 'encounter:fixed' && fixed) {
      return {
        kind: 'replace',
        stageId: COMBAT_STAGE_ID,
        input: { encounterIndex: encounter, offer: offerToJson(fixed) },
        rng,
      }
    }

    if (choiceId === 'encounter:hunt') {
      return { kind: 'replace', stageId: HUNT_STAGE_ID, input: { encounterIndex: encounter }, rng }
    }

    if (choiceId === 'encounter:explore' || choiceId === 'encounter:special') {
      // Still unbuilt, and the stage says so in the game rather than being
      // stubbed with something plausible. The encounter is NOT spent by
      // looking at a wall: it comes back to the same index.
      return {
        kind: 'replace',
        stageId: 'underConstruction',
        input: {
          what: choiceId === 'encounter:explore' ? 'Exploring' : 'The special encounter',
          encounterIndex: encounter,
        },
        rng,
      }
    }

    return { kind: 'stay', state, rng }
  },
}

export { LEVEL_ENCOUNTER_COUNT }

export { ENCOUNTER_SELECT_STAGE_ID }
