// Going hunting: which of these do you take on.
//
// The list is `2 + Perception/2` long, opens on a regular, and never repeats
// a class-and-rank -- all of which is `model/encounterOffers.ts`. This stage
// only rolls it once, on entry, and shows it.

import type { JsonObject } from '../core/json'
import type { StageModule } from '../core/stage'
import { MONSTER_CLASS_IDS } from '../content'
import { buildEncounterOffers } from '../model/encounterOffers'
import { iconFor, monsterFor, offerFromJson, offerToJson } from './encounter'
import { encounterIndexOf } from './levelProgress'
import { COMBAT_STAGE_ID, HUNT_STAGE_ID } from './ids'


export const huntStage: StageModule = {
  id: HUNT_STAGE_ID,
  title: 'The Hunt',

  enter: (input, context, rng) => {
    const encounter = encounterIndexOf(input.encounterIndex)
    const rolled = buildEncounterOffers({
      encounter,
      choiceCount: context.profile?.derived.encounterChoices ?? 2,
      species: context.content.species,
      classes: MONSTER_CLASS_IDS,
      rng,
    })
    return {
      state: { encounterIndex: encounter, offers: rolled.offers.map(offerToJson) } satisfies JsonObject,
      narration: 'You cast about for tracks. Something is out there.',
      rng: rolled.rng,
    }
  },

  present: (state, context) => {
    const offers = Array.isArray(state.offers) ? state.offers : []
    return {
      screenKey: `hunt:${String(state.encounterIndex ?? 1)}`,
      choices: offers.flatMap((raw, index) => {
        const offer = offerFromJson(raw)
        if (!offer) return []
        const monster = monsterFor(offer, context)
        return [{
          id: `hunt:${index}`,
          label: offer.name,
          icon: iconFor(offer, context),
          detail: monster
            ? {
                title: offer.name,
                lines: [
                  `${monster.maxHitPoints} hit points`,
                  `${monster.maxActions} action${monster.maxActions === 1 ? '' : 's'} a round`,
                  `${Math.round(monster.damage)} damage a blow`,
                ],
              }
            : undefined,
        }]
      }),
    }
  },

  resolve: (state, choiceId, _context, rng) => {
    const offers = Array.isArray(state.offers) ? state.offers : []
    const index = Number.parseInt(choiceId.replace('hunt:', ''), 10)
    const offer = Number.isInteger(index) ? offerFromJson(offers[index]) : null
    if (!offer) return { kind: 'stay', state, rng }
    return {
      kind: 'replace',
      stageId: COMBAT_STAGE_ID,
      input: { encounterIndex: encounterIndexOf(state.encounterIndex), offer: offerToJson(offer) },
      rng,
    }
  },
}

export { HUNT_STAGE_ID }
