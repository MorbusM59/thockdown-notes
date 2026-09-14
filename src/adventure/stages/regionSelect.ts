// Where this level happens.
//
// A region is meant to determine which encounters and which monsters are in
// scope for the level. Those pools are not specified yet, so choosing one
// currently records the choice and nothing more -- which is the honest
// state of it, and visible as such rather than dressed up.

import type { StageModule } from '../core/stage'
import { MARKET_PRICE, purse } from './market'
import { ENCOUNTER_SELECT_STAGE_ID, OUTPOST_STAGE_ID, REGION_SELECT_STAGE_ID } from './ids'


export const regionSelectStage: StageModule = {
  id: REGION_SELECT_STAGE_ID,
  title: 'The Road',

  enter: (_input, _context, rng) => ({
    state: {},
    narration: 'Space and time dissolve in a chaotic vortex. As you come to, you look around. It looks like you have ended up...',
    rng,
  }),

  present: (_state, context) => ({
    choices: context.content.regions.map((region) => ({
      id: `region:${region.id}`,
      label: region.name,
      icon: region.icon,
    })),
  }),

  resolve: (state, choiceId, context, rng) => {
    const region = context.content.regions.find((candidate) => `region:${candidate.id}` === choiceId)
    if (!region) return { kind: 'stay', state, rng }
    // Through the OUTPOST when there is something to spend there, and
    // straight on when there is not: an outpost you can only walk through is
    // a screen that asks nothing (stages/outpost.ts).
    const canTrade = purse(context, 'item') >= MARKET_PRICE || purse(context, 'trait') >= MARKET_PRICE
    return {
      kind: 'replace',
      stageId: canTrade ? OUTPOST_STAGE_ID : ENCOUNTER_SELECT_STAGE_ID,
      effects: [
        { kind: 'setRegion', regionId: region.id },
        { kind: 'recordOutcome', outcome: 'region-entered', payload: { regionId: region.id } },
      ],
      ...(canTrade ? {} : { narration: 'You take a moment to consider your options.' }),
      rng,
    }
  },
}

export { REGION_SELECT_STAGE_ID }
