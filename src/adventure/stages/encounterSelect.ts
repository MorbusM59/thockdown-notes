// The hub a level keeps returning to: what do you do next.
//
// A level is ten encounters, the fifth and ninth are mini bosses and the
// tenth is the boss, and at those three there is nothing to choose -- the
// encounter is the encounter. Everywhere else the player picks how to look
// for one.
//
// WHICH encounter is read off the record (see levelProgress.ts), not held
// here and not threaded in: this stage is re-entered once per encounter and
// has no way to count its own re-entries.

import type { JsonObject } from '../core/json'
import type { StageModule } from '../core/stage'
import { MONSTER_CLASS_IDS } from '../content'
import { buildEncounterOffers, fixedTypeAt, LEVEL_ENCOUNTER_COUNT } from '../model/encounterOffers'
import { iconFor, monsterDetailLines, monsterFor, offerFromJson, offerToJson } from './encounter'
import { currentEncounter, isLevelComplete } from './levelProgress'
import { COMBAT_STAGE_ID, ENCOUNTER_SELECT_STAGE_ID, HUNT_STAGE_ID, REGION_SELECT_STAGE_ID } from './ids'


const ADVANCE_CHOICE = 'level:advance'

// SPENDING A STAT POINT IS NOT A CELL HERE any more, and the cell it replaced
// was this stage's only reason to know about the ladder. A point waiting is
// shown on the rail's star gauge on EVERY screen, and pressing that gauge is
// what opens the stage that spends it -- which is what "spendable at any
// time" actually asks for, where a hub cell could only ever mean "spendable
// when the level lets you". It also gives the dial back a twelfth of itself
// on every screen of the hub. See stages/statPoints.ts.

export const encounterSelectStage: StageModule = {
  id: ENCOUNTER_SELECT_STAGE_ID,
  title: 'Wilds',

  enter: (_input, context, rng) => {
    const encounter = currentEncounter(context.game)
    const fixed = fixedTypeAt(encounter)
    if (!fixed || isLevelComplete(encounter)) {
      return { state: { fixedOffer: null } satisfies JsonObject, rng }
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
      state: { fixedOffer: offer ? offerToJson(offer) : null } satisfies JsonObject,
      narration: offer
        ? `**${offer.name}.** *It has been waiting for you.*`
        : 'Something should be here, and the game cannot say what.',
      rng: drawn.rng,
    }
  },

  present: (state, context) => {
    const encounter = currentEncounter(context.game)

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
                lines: monsterDetailLines(monster),
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
        input: { offer: offerToJson(fixed) },
        rng,
      }
    }

    if (choiceId === 'encounter:hunt') {
      return { kind: 'replace', stageId: HUNT_STAGE_ID, rng }
    }

    if (choiceId === 'encounter:explore' || choiceId === 'encounter:special') {
      // Still unbuilt, and the stage says so in the game rather than being
      // stubbed with something plausible. The encounter is NOT spent by
      // looking at a wall: nothing advances the count, so it comes back to
      // the same one.
      return {
        kind: 'replace',
        stageId: 'underConstruction',
        input: { what: choiceId === 'encounter:explore' ? 'Exploring' : 'The special encounter' },
        rng,
      }
    }

    return { kind: 'stay', state, rng }
  },
}

export { LEVEL_ENCOUNTER_COUNT }

export { ENCOUNTER_SELECT_STAGE_ID }
