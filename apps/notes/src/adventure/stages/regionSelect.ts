// Where this level happens.
//
// A region DECIDES WHAT CAN BE FOUND THERE: the traits its special events
// offer, before every mini boss and boss (model/specialEvents.ts). The six
// are a ring and their traits are authored on the borders between them, so
// each region's two border names say what it breeds -- and a neighbour shares
// one of those borders, which is why travelling one way rather than the other
// is a decision a player can actually make.
//
// A region also makes some MONSTERS common (`Region.favours`, weighted in
// model/encounterOffers.ts), and the detail names them, so where to go is
// also a choice of what to face.

import type { StageModule } from '../core/stage'
import { MARKET_PRICE, purse } from './market'
import { ENCOUNTER_SELECT_STAGE_ID, OUTPOST_STAGE_ID, REGION_SELECT_STAGE_ID } from './ids'


export const regionSelectStage: StageModule = {
  id: REGION_SELECT_STAGE_ID,
  title: 'The Road',

  enter: (_input, _context, rng) => ({
    state: {},
    narration: 'The vortex lets you go...',
    rng,
  }),

  present: (_state, context) => ({
    choices: context.content.regions.map((region) => ({
      id: `region:${region.id}`,
      label: region.name,
      icon: region.icon,
      // WHAT IS FOUND HERE, in two words per border rather than ten trait
      // names: the pace constraint says a choice cannot cost ten seconds of
      // reading, and the border names are the honest short form -- they are
      // literally the groups the traits come from.
      detail: {
        title: region.name,
        lines: [
          ...region.borders,
          'Common: ' + region.favours
            .map((id) => context.content.species.find((species) => species.id === id)?.name)
            .filter((name): name is string => !!name)
            .join(', '),
        ],
      },
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
      ...(canTrade ? {} : { narration: 'You take stock.' }),
      rng,
    }
  },
}

export { REGION_SELECT_STAGE_ID }
