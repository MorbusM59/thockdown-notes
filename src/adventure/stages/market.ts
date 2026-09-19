// The trader and the Oracle: one stage with two faces.
//
// They differ in the kind they sell, the currency they take and the words on
// the bar -- and in nothing else. Two stages would be the same flow written
// twice, and the second copy is where the drift starts; the design calls them
// two places in the world, which is content, not machinery.
//
// SIX OFFERS, and this stage does not ROLL them -- the outpost does, once,
// and hands the same list to whichever door is opened. That is what makes
// "what is on the table is what is on the table" true across a visit to the
// other door and back: a market that rolled its own would hand out a fresh
// six every time it was re-entered, which is a free reroll for the price of
// two presses. Bought things leave the table by being HELD rather than by
// being struck off, so the filter is the same one the pools use everywhere.
//
// Each costs ten of its currency, and the player buys until they run out --
// so the screen is a purse being spent rather than a single decision, and the
// cells thin out as it goes.
//
// Nothing here checks whether the player can afford a cell it is offering.
// The cell is simply not there, which is the platform's own rule: choices are
// PRE-RESOLVED (core/stage.ts), so a cell in the ring is a thing that will
// happen rather than a thing that might be refused.

import type { JsonObject } from '../core/json'
import type { Effect } from '../model/effects'
import type { StageContext, StageModule } from '../core/stage'
import { goldBalance } from '../model/gold'
import { moteBalance } from '../model/motes'
import { describeModifier, type ModifierKind } from '../model/modifiers'
import {
  DROP_CANCEL, dropCancelledNarration, dropChoices, dropEffects, dropNarration, handsAreFull, readPendingId,
} from './carry'
import { MARKET_STAGE_ID } from './ids'


/** What one thing costs, in the currency of its kind. */
export const MARKET_PRICE = 10

/** How much is laid out. Six is what the design asks for. */
export const MARKET_OFFER_COUNT = 6

interface Face {
  title: string
  greeting: string
  currency: string
  spend: Effect['kind']
}

const FACES: Readonly<Record<ModifierKind, Face>> = {
  item: {
    title: 'The trader',
    greeting: 'The trader lays out what they have.',
    currency: 'gold',
    spend: 'spendGold',
  },
  trait: {
    title: 'The Oracle',
    greeting: 'The Oracle considers you, and names what she can teach.',
    currency: 'motes',
    spend: 'spendExperience',
  },
}

function kindOf(value: unknown): ModifierKind {
  return value === 'trait' ? 'trait' : 'item'
}

/** What the run can spend here, in this face's own currency. */
export function purse(context: StageContext, kind: ModifierKind): number {
  const game = context.game
  if (!game) return 0
  return kind === 'item'
    ? goldBalance(game.goldEarned, game.goldSpentOnItems)
    : moteBalance(game.experienceEarned, game.experienceSpentOnTraits)
}

/**
 * What is still ON the table: the outpost's list, less anything now held.
 *
 * Bought things disappear this way rather than by being removed from the
 * list, which is why leaving and coming back shows the same table minus the
 * purchases -- and why the OUTPOST can own the stock without the market ever
 * writing to its state (a child cannot; see core/stage.ts).
 */
export function tableOf(offerIds: readonly string[], context: StageContext): string[] {
  return offerIds.filter((id) => !context.held.some((row) => row.id === id))
}

export const marketStage: StageModule = {
  id: MARKET_STAGE_ID,
  title: 'Market',

  enter: (input, _context, rng) => {
    const kind = kindOf(input.kind)
    const offerIds = (Array.isArray(input.offerIds) ? input.offerIds : [])
      .filter((id): id is string => typeof id === 'string')
    return {
      state: { kind, offerIds, pendingId: null } satisfies JsonObject,
      narration: FACES[kind].greeting,
      rng,
    }
  },

  present: (state, context) => {
    const kind = kindOf(state.kind)
    const pending = readPendingId(state)
    if (pending) {
      return { screenKey: `market:drop:${pending}`, choices: dropChoices(context, kind, pending) }
    }

    const offerIds = tableOf(
      (Array.isArray(state.offerIds) ? state.offerIds : []).filter((id): id is string => typeof id === 'string'),
      context,
    )
    const affordable = purse(context, kind) >= MARKET_PRICE
    return {
      screenKey: `market:${kind}:${offerIds.length}`,
      choices: [
        // Only while there is something to spend. A cell that would be
        // refused is a cell that should not be in the ring at all.
        ...(affordable
          ? offerIds.flatMap((id) => {
              const modifier = context.catalog.get(id)
              if (!modifier) return []
              return [{
                id: `buy:${modifier.id}`,
                label: modifier.name,
                icon: modifier.icon,
                detail: {
                  title: `${modifier.name} — ${MARKET_PRICE} ${FACES[kind].currency}`,
                  lines: describeModifier(modifier, context.describe),
                },
              }]
            })
          : []),
        { id: 'market:leave', label: 'Take your leave', icon: 'fa-solid fa-rotate-left', isBack: true },
      ],
    }
  },

  resolve: (state, choiceId, context, rng) => {
    const kind = kindOf(state.kind)
    const offerIds = (Array.isArray(state.offerIds) ? state.offerIds : []).filter(
      (id): id is string => typeof id === 'string',
    )
    const onTable = tableOf(offerIds, context)
    const pending = readPendingId(state)

    if (pending) {
      // Free, because nothing was taken: the purchase waits on this screen
      // rather than having been made before it (see stages/carry.ts).
      if (choiceId === DROP_CANCEL) {
        return {
          kind: 'stay',
          state: { ...state, pendingId: null },
          narration: dropCancelledNarration(context.catalog.get(pending)?.name ?? 'It'),
          rng,
        }
      }
      const effects = dropEffects(kind, choiceId, pending)
      if (!effects) return { kind: 'stay', state, rng }
      const modifier = context.catalog.get(pending)
      return {
        kind: 'stay',
        state: { ...state, pendingId: null },
        effects: [...effects, { kind: FACES[kind].spend, units: MARKET_PRICE } as Effect],
        narration: `**${modifier?.name ?? 'It'}.** *Yours, for ${MARKET_PRICE} ${FACES[kind].currency}.*`,
        rng,
      }
    }

    // POP, not replace: the outpost is still underneath with the stock it
    // rolled, so the other door -- and this one again -- open on the same
    // table rather than on a fresh six.
    if (choiceId === 'market:leave') {
      return { kind: 'pop', narration: 'You step back out into the light.', rng }
    }

    const boughtId = choiceId.startsWith('buy:') ? choiceId.slice('buy:'.length) : null
    const modifier = boughtId ? context.catalog.get(boughtId) : undefined
    if (!modifier || !onTable.includes(modifier.id)) return { kind: 'stay', state, rng }

    // HANDS FULL: the purchase is not made yet -- the drop screen is the
    // other half of this choice, and the money is spent there with it, so a
    // player cannot pay and then find the question unanswerable.
    if (handsAreFull(context, kind)) {
      return {
        kind: 'stay',
        state: { ...state, pendingId: modifier.id },
        narration: dropNarration(kind, modifier.name),
        rng,
      }
    }

    return {
      kind: 'stay',
      state,
      effects: [
        { kind: 'acquireModifier', modifierKind: kind, modifierId: modifier.id },
        { kind: FACES[kind].spend, units: MARKET_PRICE } as Effect,
      ],
      narration: `**${modifier.name}.** *Yours, for ${MARKET_PRICE} ${FACES[kind].currency}.*`,
      rng,
    }
  },
}

export { MARKET_STAGE_ID }
