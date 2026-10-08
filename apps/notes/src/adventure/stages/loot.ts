// What you found, and then what you learned.
//
// One screen per loot the escalating check bought (`model/rewards.ts`), each
// a choice between a piece of gold and an item. The MOTES are not part of
// that choice and are not shown alongside it: they land once, on the way
// back to encounter selection, so the sequence reads as two things rather
// than one crowded one.
//
// A monster that RAN pays the gold branch with no choice offered -- it was
// beaten, it just was not searched.


import { foundIn, regionOf } from '../content'
import { nextSample } from '../core/rng'
import type { JsonObject } from '../core/json'
import type { StageContext, StageModule } from '../core/stage'
import type { Effect } from '../model/effects'
import { describeModifier } from '../model/modifiers'
import { GOLD_PER_LOOT_SCREEN } from '../model/rewards'
import {
  DROP_CANCEL, dropCancelledNarration, dropChoices, dropEffects, dropNarration, handsAreFull, readPendingId,
} from './carry'
import { ENCOUNTER_SELECT_STAGE_ID, LOOT_STAGE_ID } from './ids'
import { playerTierOf, type GameRecord } from '../model/gameState'
import { famePointsAvailable } from '../model/gold'
import { statPointsAvailable } from '../model/motes'


const GOLD_CHOICE = 'loot:gold'

function rollItemOffers(context: StageContext, rng: number, alreadyShown: readonly string[] = []) {
  // Not what is already held: a duplicate is not a second item, it is the
  // same one applying twice (model/gameState.ts's `acquireModifier`), and
  // offering it would be offering nothing.
  const unheld = foundIn(regionOf(context.content, context.game?.regionId), context.items, 'item').filter((item) => !context.held.some((row) => row.id === item.id))
  const wanted = context.profile?.derived.offerChoices ?? 2
  // Unseen first. When one fight pays several screens, an item an earlier
  // screen of the same spoils already showed is the same choice asked again,
  // so every screen is filled from items not yet shown, and only the
  // shortfall -- when too few unseen items are left unheld -- is filled from
  // the shown ones. One rule at every pool size, so there is no threshold
  // at which the exclusion switches off.
  const unseen = unheld.filter((item) => !alreadyShown.includes(item.id))
  const seen = unheld.filter((item) => alreadyShown.includes(item.id))
  const first = nextSample(rng, unseen, wanted)
  const rest = nextSample(first.rng, seen, wanted - first.value.length)
  return { offerIds: [...first.value, ...rest.value].map((item) => item.id), rng: rest.rng }
}

function readIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
}

/**
 * WHAT CROSSING A LADDER BOUGHT, said where it was crossed. Gold and motes
 * are only earned here, and each can tip over a fame point or a stat point --
 * the second also raising the run's tier. The rail's gauges show it a moment
 * later, but a gauge that fills with no word of why is a number changing on
 * its own; this is the word. Read against the run as it was BEFORE this
 * choice's effects, which is what `context.game` is.
 */
function crossedPills(game: GameRecord | null, gold: number, motes: number): string[] {
  if (!game) return []
  const fame = famePointsAvailable(game.goldEarned + gold, game.goldToNextFamePoint, game.famePointsSpent)
    - famePointsAvailable(game.goldEarned, game.goldToNextFamePoint, game.famePointsSpent)
  const stat = statPointsAvailable(game.experienceEarned + motes, game.experienceToNextStatPoint, game.statPointsSpent)
    - statPointsAvailable(game.experienceEarned, game.experienceToNextStatPoint, game.statPointsSpent)
  return [
    ...(stat > 0 ? [`**Tier ${playerTierOf(game) + stat}.** *${stat === 1 ? 'A stat point' : `${stat} stat points`} to spend.*`] : []),
    ...(fame > 0 ? [`**${fame === 1 ? 'A fame point' : `${fame} fame points`}** to spend.`] : []),
  ]
}

/** The line after taking one of several spoils; exported for choiceWidth.contract.test.ts. */
export function moreToSearch(label: string): string {
  return `**${label}**, and more to search.`
}

export const lootStage: StageModule = {
  id: LOOT_STAGE_ID,
  title: 'Spoils',

  enter: (input, context, rng) => {
    const offersLoot = input.offersLoot !== false
    const rolled = offersLoot ? rollItemOffers(context, rng) : { offerIds: [] as string[], rng }
    const opening = offersLoot ? 'You search the remains.' : 'It fled, leaving little.'
    // THE KILL, IN PLACE OF THE OPENING LINE. The round's log is spent when
    // the fight ends, and the one thing worth carrying over is how the thing
    // died -- in the same four-part shape every combat pill has
    // (stages/combatLog.ts). It says what this screen is by itself, and a
    // line beside it saying so again was width the item previews needed.
    const kill = typeof input.killPill === 'string' ? input.killPill : null
    return {
      state: {
        screensLeft: Math.max(1, readNumber(input.screensLeft, 1)),
        motes: Math.max(0, readNumber(input.motes, 1)),
        offersLoot,
        offerIds: rolled.offerIds,
        shownIds: rolled.offerIds,
      } satisfies JsonObject,
      narration: kill ?? opening,
      rng: rolled.rng,
    }
  },

  present: (state, context) => {
    const offerIds = Array.isArray(state.offerIds) ? state.offerIds : []
    const screensLeft = readNumber(state.screensLeft, 1)
    // Hands full: the other half of the pick, on the same terms everywhere
    // something is acquired (stages/carry.ts).
    const pending = readPendingId(state)
    if (pending) {
      return { screenKey: `loot:drop:${pending}`, choices: dropChoices(context, 'item', pending) }
    }
    return {
      screenKey: `loot:${screensLeft}`,
      choices: [
        {
          id: GOLD_CHOICE,
          label: `${GOLD_PER_LOOT_SCREEN} gold`,
          icon: 'fa-solid fa-coins',
        },
        ...offerIds.flatMap((id) => {
          const item = typeof id === 'string' ? context.catalog.get(id) : undefined
          if (!item) return []
          return [{
            id: `loot:item:${item.id}`,
            label: item.name,
            icon: item.icon,
            detail: { title: item.name, lines: describeModifier(item, context.describe) },
          }]
        }),
      ],
    }
  },

  resolve: (state, choiceId, context, rng) => {
    const screensLeft = readNumber(state.screensLeft, 1)
    const motes = Math.max(0, readNumber(state.motes, 1))
    const pending = readPendingId(state)

    // Waving the question away costs nothing and gives the loot screen back
    // -- the pick was never applied (stages/carry.ts).
    if (pending && choiceId === DROP_CANCEL) {
      return {
        kind: 'stay',
        state: { ...state, pendingId: null },
        narration: dropCancelledNarration(context.catalog.get(pending)?.name ?? 'It'),
        rng,
      }
    }

    const taken: Effect[] = []
    let label: string
    let gold = 0
    if (pending) {
      const swapped = dropEffects('item', choiceId, pending)
      if (!swapped) return { kind: 'stay', state, rng }
      taken.push(...swapped)
      label = context.catalog.get(pending)?.name ?? 'It'
    } else if (choiceId === GOLD_CHOICE) {
      taken.push({ kind: 'grantGold', units: GOLD_PER_LOOT_SCREEN })
      gold = GOLD_PER_LOOT_SCREEN
      label = `${GOLD_PER_LOOT_SCREEN} gold`
    } else if (choiceId.startsWith('loot:item:')) {
      const item = context.catalog.get(choiceId.replace('loot:item:', ''))
      if (!item) return { kind: 'stay', state, rng }
      // Ask what to give up FIRST: the pick is not applied until the question
      // is answered, so a screen cannot be spent on a choice that stalls.
      if (handsAreFull(context, 'item')) {
        return {
          kind: 'stay',
          state: { ...state, pendingId: item.id },
          narration: dropNarration(item.name),
          rng,
        }
      }
      taken.push({ kind: 'acquireModifier', modifierKind: 'item', modifierId: item.id })
      label = item.name
    } else {
      return { kind: 'stay', state, rng }
    }

    if (screensLeft > 1) {
      // A save from before `shownIds` existed still knows the screen on view.
      const shown = [...readIds(state.shownIds), ...readIds(state.offerIds)]
      const rolled = state.offersLoot !== false ? rollItemOffers(context, rng, shown) : { offerIds: [] as string[], rng }
      return {
        kind: 'stay',
        state: { ...state, screensLeft: screensLeft - 1, offerIds: rolled.offerIds, shownIds: [...shown, ...rolled.offerIds], pendingId: null },
        // The pick is applied HERE, not held until the last screen. Holding
        // them would lose every intermediate one, and would also mean the
        // next screen's item offers rolled against a Luck the player had
        // already earned but not yet been given.
        effects: taken,
        narration: [...crossedPills(context.game, gold, 0), moreToSearch(label)],
        rng: rolled.rng,
      }
    }

    // Every screen has been through: the motes land now, together, on the way
    // out. See the module comment for why they are not on the loot screens.
    return {
      kind: 'replace',
      stageId: ENCOUNTER_SELECT_STAGE_ID,
      // THE ENCOUNTER IS SPENT HERE, on the way out of the spoils rather than
      // on the way into the next fight: everything about this one is behind
      // the player now, so the count they are shown is the one they are
      // preparing for (stages/levelProgress.ts).
      effects: [...taken, { kind: 'grantExperience', units: motes }, { kind: 'advanceEncounter' }],
      narration: [
        ...crossedPills(context.game, gold, motes),
        `**${label}**, and **${motes}** mote${motes === 1 ? '' : 's'}.`,
      ],
      rng,
    }
  },
}

export { LOOT_STAGE_ID }
