// Following a track: which of these do you take on.
//
// Entered from the hub with the encounter pool the player chose to track
// (`input.track`), and draws monsters from that pool only. The list is
// `2 + Perception/2` long, opens on a regular, and never repeats a
// class-and-rank -- all of which is `model/encounterOffers.ts`. This stage
// only rolls it once, on entry, and shows it.

import type { JsonObject } from '../core/json'
import type { StageModule } from '../core/stage'
import { ENCOUNTER_TRACKS, monsterPools, buildEncounterOffers } from '../model/encounterOffers'
import type { EncounterPoolId } from '../model/vectors'
import {
  iconFor, monsterCellLabel, monsterDetailLines, monsterFor, offerFromJson, offerToJson,
} from './encounter'
import { currentEncounter } from './levelProgress'
import { COMBAT_STAGE_ID, HUNT_STAGE_ID } from './ids'


export const huntStage: StageModule = {
  id: HUNT_STAGE_ID,
  title: 'The Hunt',

  enter: (input, context, rng) => {
    const encounter = currentEncounter(context.game)
    const targetPool: EncounterPoolId | undefined = typeof input.track === 'string'
      && ENCOUNTER_TRACKS.some((candidate) => candidate.id === input.track)
      ? input.track as EncounterPoolId
      : undefined
    const track = ENCOUNTER_TRACKS.find((candidate) => candidate.id === targetPool)
    const rolled = buildEncounterOffers({
      encounter,
      choiceCount: context.profile?.derived.encounterChoices ?? 2,
      ...monsterPools(context.content, targetPool),
      rng,
    })
    return {
      state: { offers: rolled.offers.map(offerToJson), track: track?.id ?? null } satisfies JsonObject,
      narration: track
        ? `You track ${track.label.toLowerCase()}. Something is out there.`
        : 'You cast about for tracks. Something is out there.',
      rng: rolled.rng,
    }
  },

  present: (state, context) => {
    const offers = Array.isArray(state.offers) ? state.offers : []
    return {
      screenKey: `hunt:${currentEncounter(context.game)}`,
      choices: offers.flatMap((raw, index) => {
        const offer = offerFromJson(raw)
        if (!offer) return []
        const monster = monsterFor(offer, context)
        return [{
          id: `hunt:${index}`,
          label: monsterCellLabel(offer, context.content, monster),
          icon: iconFor(offer, context),
          detail: monster
            ? {
                title: monsterCellLabel(offer, context.content, monster),
                lines: monsterDetailLines(monster, context.describe),
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
      input: { offer: offerToJson(offer) },
      rng,
    }
  },
}

export { HUNT_STAGE_ID }
