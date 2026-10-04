// The hub a level keeps returning to: what do you do next.
//
// A level is ten encounters, the fifth and ninth are mini bosses and the
// tenth is the boss, and at those three there is nothing to choose -- the
// encounter is the encounter. Everywhere else the player picks how to look
// for one.
//
// THE OMEN STANDS BEFORE THE THREE, and it is a phase of THIS stage rather
// than a stage of its own. That is not where it would naturally live, and the
// reason is the funnel: five stages route into this one (the outpost, the
// loot screen, a fight ending either way, the region select, the
// under-construction wall), and "go to the omen first when the next encounter
// is fixed" placed at each of them is five copies of one rule -- this
// codebase's characteristic failure, and the next route in would not know to
// ask. Placed here it is asked once, because every route in arrives here.
//
// A stage cannot redirect on entry (a transition comes from `resolve`), so
// the omen being a separate stage would mean showing the boss screen first
// and pushing the omen off it -- which is the wrong order, and the order is
// the whole point: you are given something BEFORE you see what you are given
// it for. The rules and the draw are `model/specialEvents.ts`; only the
// screen is here.
//
// WHICH encounter is read off the record (see levelProgress.ts), not held
// here and not threaded in: this stage is re-entered once per encounter and
// has no way to count its own re-entries.

import type { JsonObject } from '../core/json'
import type { StageModule } from '../core/stage'
import { ENCOUNTER_TRACKS, monsterPools, buildEncounterOffers, fixedTypeAt, LEVEL_ENCOUNTER_COUNT, mostSelectedEncounterPool, trackChoicesFor } from '../model/encounterOffers'
import { ENCOUNTER_POOL_IDS } from '../model/vectors'
import {
  iconFor, monsterCellLabel, monsterDetailLines, monsterFor, monsterName, offerFromJson, offerToJson,
} from './encounter'
import {
  DROP_CANCEL, dropCancelledNarration, dropChoices, dropEffects, dropNarration, handsAreFull, readPendingId,
} from './carry'
import { drawOmenTraits, omenHealAmount, omenPool, omenTraitCount } from '../model/specialEvents'
import { describeModifier } from '../model/modifiers'
import { currentEncounter, isLevelComplete } from './levelProgress'
import { COMBAT_STAGE_ID, ENCOUNTER_SELECT_STAGE_ID, HUNT_STAGE_ID, REGION_SELECT_STAGE_ID } from './ids'


const ADVANCE_CHOICE = 'level:advance'
const OMEN_HEAL_CHOICE = 'omen:rest'
const OMEN_TRAIT_PREFIX = 'omen:trait:'

// SPENDING A STAT POINT IS NOT A CELL HERE any more, and the cell it replaced
// was this stage's only reason to know about the ladder. A point waiting is
// shown on the rail's star gauge on EVERY screen, and pressing that gauge is
// what opens the stage that spends it -- which is what "spendable at any
// time" actually asks for, where a hub cell could only ever mean "spendable
// when the level lets you". It also gives the dial back a twelfth of itself
// on every screen of the hub. See stages/statPoints.ts.

// SPECIAL ENCOUNTER IS GONE, and it is not a placeholder waiting to come
// back. It was a third cell here whose rules were never written, and what it
// would have been is now the OMEN -- which arrives on its own at the three
// fixed encounters rather than being one of the ways you go looking. A cell
// that leads to a wall is a promise the game cannot keep.
//
// AN OPEN ENCOUNTER IS FOUND BY TRACKING. The hub offers as many tracks as the
// profile's encounter choices, each an encounter pool (model/vectors.ts's
// ENCOUNTER_POOL_IDS); following one records it on the run and hands the pool
// to the hunt, which draws only from it. The level's tracks are what decide
// the pool its placed mini bosses and boss come from.

export const encounterSelectStage: StageModule = {
  id: ENCOUNTER_SELECT_STAGE_ID,
  title: 'Tracking',

  enter: (_input, context, rng) => {
    const encounter = currentEncounter(context.game)
    const fixed = fixedTypeAt(encounter)
    if (!fixed || isLevelComplete(encounter)) {
      const choiceCount = context.profile?.derived.encounterChoices ?? 2
      const sampled = trackChoicesFor(choiceCount, rng)
      return { state: { fixedOffer: null, trackIds: sampled.trackIds } satisfies JsonObject, rng: sampled.rng }
    }
    // A boss is PLACED, so it is drawn here rather than offered: one species
    // able to field that rank, from the pool tracked most this level, and no
    // choice about it.
    const selected = mostSelectedEncounterPool(context.game?.trackedPools, rng)
    const drawn = buildEncounterOffers({
      encounter,
      choiceCount: 1,
      ...monsterPools(context.content, selected.pool),
      rng: selected.rng,
    })
    const offer = drawn.offers[0]
    // The omen is drawn NOW, with the boss, and shown first. Drawing it here
    // rather than when it is presented is what lets both screens belong to
    // one entry: the player answers the omen, the stage stays, and the boss
    // it already drew is underneath -- no re-entry, no second draw, and the
    // monster cannot change because you took a heal.
    const region = context.content.regions.find((candidate) => candidate.id === context.game?.regionId)
    const pool = omenPool(region, context.traits, context.held)
    const omen = drawOmenTraits(
      pool,
      omenTraitCount(context.profile?.stats.intellect ?? 0),
      drawn.rng,
    )
    return {
      state: {
        fixedOffer: offer ? offerToJson(offer) : null,
        omenTraitIds: omen.traits.map((trait) => trait.id),
        omenAnswered: false,
        trackIds: [],
      } satisfies JsonObject,
      narration: offer
        ? `**${monsterName(offer, context.content)} is ahead.** *The road gives you something first.*`
        : 'Something should be here, and the game cannot say what.',
      rng: omen.rng,
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

    if (fixed && state.omenAnswered !== true) {
      const pending = readPendingId(state)
      if (pending) {
        return {
          screenKey: `omen:drop:${pending}`,
          choices: dropChoices(context, 'trait', pending),
        }
      }
      const heal = omenHealAmount(context.profile?.stats.might ?? 0)
      const offered = (Array.isArray(state.omenTraitIds) ? state.omenTraitIds : [])
        .flatMap((id) => {
          const trait = typeof id === 'string' ? context.catalog.get(id) : undefined
          return trait ? [trait] : []
        })
      return {
        screenKey: `omen:${encounter}`,
        choices: [
          ...offered.map((trait) => ({
            id: `${OMEN_TRAIT_PREFIX}${trait.id}`,
            label: trait.name,
            icon: trait.icon,
            detail: { title: trait.name, lines: describeModifier(trait, context.describe) },
          })),
          {
            id: OMEN_HEAL_CHOICE,
            label: 'Rest a while',
            icon: 'fa-solid fa-campground',
            detail: {
              title: 'Rest a while',
              // The number, not the formula: a player deciding between this
              // and a trait needs to know what they are being handed.
              lines: [`Recover ${heal} hit points`, 'Ten, and two for every point of Might'],
            },
          },
        ],
      }
    }

    if (fixed) {
      const monster = monsterFor(fixed, context)
      return {
        screenKey: `encounter:fixed:${encounter}`,
        choices: [{
          id: 'encounter:fixed',
          label: monsterCellLabel(fixed, context.content, monster),
          icon: iconFor(fixed, context),
          detail: monster
            ? {
                title: monsterCellLabel(fixed, context.content, monster),
                lines: monsterDetailLines(monster, context.describe),
              }
            : undefined,
        }],
      }
    }

    const trackIds = Array.isArray(state.trackIds) ? state.trackIds.filter((id): id is string => typeof id === 'string') : []
    const tracks = trackIds.length > 0
      ? ENCOUNTER_TRACKS.filter((track) => trackIds.includes(track.id))
      : ENCOUNTER_TRACKS

    return {
      screenKey: `encounter:open:${encounter}`,
      choices: tracks.map((track) => ({
        id: `track:${track.id}`,
        label: `Track ${track.label}`,
        icon: track.icon,
      })),
    }
  },

  resolve: (state, choiceId, context, rng) => {
    // THE OMEN, answered. It resolves with `stay`, so the boss this stage
    // already drew is still underneath and is what the next screen shows.
    if (state.fixedOffer && state.omenAnswered !== true) {
      const answered = { ...state, omenAnswered: true, omenTraitIds: [], pendingId: null }
      const pending = readPendingId(state)

      if (pending && choiceId === DROP_CANCEL) {
        return {
          kind: 'stay',
          state: { ...state, pendingId: null },
          narration: dropCancelledNarration(context.catalog.get(pending)?.name ?? 'It'),
          rng,
        }
      }
      if (pending) {
        const swapped = dropEffects('trait', choiceId, pending)
        if (!swapped) return { kind: 'stay', state, rng }
        return {
          kind: 'stay',
          state: answered,
          effects: swapped,
          narration: `**${context.catalog.get(pending)?.name ?? 'It'}.** *Carried out of here.*`,
          rng,
        }
      }

      if (choiceId === OMEN_HEAL_CHOICE) {
        const heal = omenHealAmount(context.profile?.stats.might ?? 0)
        return {
          kind: 'stay',
          state: answered,
          effects: [{ kind: 'adjustHitPoints', amount: heal }],
          narration: `**You rest.** *${heal} hit points back, and then the road.*`,
          rng,
        }
      }

      if (choiceId.startsWith(OMEN_TRAIT_PREFIX)) {
        const trait = context.catalog.get(choiceId.slice(OMEN_TRAIT_PREFIX.length))
        if (!trait) return { kind: 'stay', state, rng }
        // Ask what to give up FIRST, exactly as the loot screen does: the
        // pick is not applied until the question is answered.
        if (handsAreFull(context, 'trait')) {
          return {
            kind: 'stay',
            state: { ...state, pendingId: trait.id },
            narration: dropNarration('trait', trait.name),
            rng,
          }
        }
        return {
          kind: 'stay',
          state: answered,
          effects: [{ kind: 'acquireModifier', modifierKind: 'trait', modifierId: trait.id }],
          narration: `**${trait.name}.** *The place leaves its mark on you.*`,
          rng,
        }
      }
      return { kind: 'stay', state, rng }
    }

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

    if (choiceId.startsWith('track:')) {
      const pool = choiceId.slice('track:'.length)
      const trackedPool = ENCOUNTER_POOL_IDS.find((candidate) => candidate === pool)
      if (!trackedPool) return { kind: 'stay', state, rng }
      return {
        kind: 'replace',
        stageId: HUNT_STAGE_ID,
        input: { track: pool },
        effects: [{ kind: 'recordEncounterTrack', pool: trackedPool }],
        rng,
      }
    }

    return { kind: 'stay', state, rng }
  },
}

export { LEVEL_ENCOUNTER_COUNT }

export { ENCOUNTER_SELECT_STAGE_ID }
