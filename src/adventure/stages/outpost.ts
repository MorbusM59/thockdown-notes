// The outpost: the last thing between the road and the level.
//
// Two doors and a way on. It exists only while there is something to spend --
// ten of either currency buys one thing (stages/market.ts), and an outpost
// you can only walk through is a screen that asks nothing. The road goes
// straight to the encounter hub in that case, which is what it always did.
//
// THE STOCK IS THE OUTPOST'S, rolled once when it is entered and handed to
// whichever door is opened. That is the whole reason the doors PUSH rather
// than replace: the outpost's frame stays underneath, so leaving a shop and
// opening the other -- or the same one again -- finds the table it left, less
// whatever was bought. A market that rolled its own six would hand out a
// fresh table every time it was re-entered, which is a free reroll for the
// price of two presses.
//
// A door is not offered when its purse cannot pay or its table is bare, by
// the platform's own rule: choices are PRE-RESOLVED, so a cell in the ring is
// a thing that will happen rather than one that might be refused.

import { nextSample } from '../core/rng'
import type { JsonObject } from '../core/json'
import type { StageContext, StageModule } from '../core/stage'
import { isOfferable, type Modifier, type ModifierKind } from '../model/modifiers'
import { MARKET_OFFER_COUNT, MARKET_PRICE, purse, tableOf } from './market'
import { ENCOUNTER_SELECT_STAGE_ID, MARKET_STAGE_ID, OUTPOST_STAGE_ID } from './ids'


/** What a face could possibly sell: specified, and not already held. */
function poolFor(context: StageContext, kind: ModifierKind): readonly Modifier[] {
  const pool = kind === 'item' ? context.items : context.content.traits
  return pool.filter((modifier) => isOfferable(modifier) && !context.held.some((row) => row.id === modifier.id))
}

function offersOf(state: JsonObject, key: 'itemOffers' | 'traitOffers'): string[] {
  const raw = state[key]
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []
}

/** Whether this door is worth a cell: money to spend, and something left to spend it on. */
function isOpen(state: JsonObject, context: StageContext, kind: ModifierKind): boolean {
  const offers = offersOf(state, kind === 'item' ? 'itemOffers' : 'traitOffers')
  return purse(context, kind) >= MARKET_PRICE && tableOf(offers, context).length > 0
}

export const outpostStage: StageModule = {
  id: OUTPOST_STAGE_ID,
  title: 'Outpost',

  enter: (_input, context, rng) => {
    const items = nextSample(rng, poolFor(context, 'item'), MARKET_OFFER_COUNT)
    const traits = nextSample(items.rng, poolFor(context, 'trait'), MARKET_OFFER_COUNT)
    return {
      state: {
        itemOffers: items.value.map((modifier) => modifier.id),
        traitOffers: traits.value.map((modifier) => modifier.id),
      } satisfies JsonObject,
      narration: 'A few lamps against the dark, and two doors worth knocking on.',
      rng: traits.rng,
    }
  },

  present: (state, context) => ({
    // Keyed on what is still buyable, so the dial resets when a door closes
    // behind the player rather than leaving them pointed at a gone cell.
    screenKey: `outpost:${isOpen(state, context, 'item')}:${isOpen(state, context, 'trait')}`,
    choices: [
      ...(isOpen(state, context, 'item')
        ? [{
            id: 'outpost:trader',
            label: 'The trader',
            icon: 'fa-solid fa-scale-balanced',
            detail: { title: 'The trader', lines: [`Items, ${MARKET_PRICE} gold each`] },
          }]
        : []),
      ...(isOpen(state, context, 'trait')
        ? [{
            id: 'outpost:oracle',
            label: 'The Oracle',
            icon: 'fa-solid fa-hat-wizard',
            detail: { title: 'The Oracle', lines: [`Traits, ${MARKET_PRICE} motes each`] },
          }]
        : []),
      { id: 'outpost:camp', label: 'Move to camp', icon: 'fa-solid fa-campground' },
    ],
  }),

  resolve: (state, choiceId, _context, rng) => {
    if (choiceId === 'outpost:trader' || choiceId === 'outpost:oracle') {
      const kind: ModifierKind = choiceId === 'outpost:trader' ? 'item' : 'trait'
      return {
        kind: 'push',
        stageId: MARKET_STAGE_ID,
        input: { kind, offerIds: offersOf(state, kind === 'item' ? 'itemOffers' : 'traitOffers') },
        rng,
      }
    }
    return {
      kind: 'replace',
      stageId: ENCOUNTER_SELECT_STAGE_ID,
      narration: 'You take a moment to consider your options.',
      rng,
    }
  },
}

export { OUTPOST_STAGE_ID }
