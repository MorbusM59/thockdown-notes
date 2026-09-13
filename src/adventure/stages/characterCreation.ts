// Character creation: what you are, what you are known for, and what you
// would never leave home without.
//
// Three questions, and the stage hands off TO ITSELF between them rather
// than carrying a step counter through one long state. That is not a
// stylistic choice: `enter` runs after the director has applied the
// previous answer's effects, so the offers for the second question are
// rolled against the stats the first one granted. Rolling them inside a
// single `resolve` would use the profile as it was BEFORE the choice that
// just changed it -- which is exactly the bug the design calls out when it
// says a Luck bonus from the item just taken should widen the next offer.

import { nextSample, type RngState } from '../core/rng'
import type { JsonObject } from '../core/json'
import type { StageContext, StageModule } from '../core/stage'
import { describeModifier, type Modifier } from '../model/modifiers'
import { holdingCounts } from '../model/gameState'
import { STAT_KEYS, STAT_LABELS } from '../model/stats'
import { CHARACTER_CREATION_STAGE_ID, REGION_SELECT_STAGE_ID } from './ids'


type Step = 'origin' | 'trait' | 'item'

function stepOf(value: unknown): Step {
  return value === 'trait' || value === 'item' ? value : 'origin'
}

function offerPool(step: Step, context: StageContext): readonly Modifier[] {
  if (step === 'trait') return context.content.traits
  if (step === 'item') return context.content.items
  return []
}

function rollOffers(step: Step, context: StageContext, rng: RngState): { offerIds: string[]; rng: RngState } {
  const pool = offerPool(step, context)
  if (pool.length === 0) return { offerIds: [], rng }
  const count = context.profile?.derived.offerChoices ?? 2
  const sample = nextSample(rng, pool, count)
  return { offerIds: sample.value.map((modifier) => modifier.id), rng: sample.rng }
}

const NARRATION: Readonly<Record<Step, string>> = {
  origin: 'What are you? A...',
  trait: 'What are you known for?',
  item: 'You would never leave home without...',
}

export const characterCreationStage: StageModule = {
  id: CHARACTER_CREATION_STAGE_ID,
  title: 'Origins',

  enter: (input, context, rng) => {
    const step = stepOf(input.step)
    const rolled = rollOffers(step, context, rng)
    return {
      state: { step, offerIds: rolled.offerIds } satisfies JsonObject,
      narration: NARRATION[step],
      rng: rolled.rng,
    }
  },

  present: (state, context) => {
    const step = stepOf(state.step)
    if (step === 'origin') {
      return {
        screenKey: 'origin',
        choices: context.content.origins.map((origin) => ({
          id: `origin:${origin.id}`,
          label: origin.name,
          icon: origin.icon,
          detail: {
            title: origin.name,
            lines: STAT_KEYS.flatMap((stat) => {
              const amount = origin.statDeltas[stat]
              return amount ? [`+${amount} ${STAT_LABELS[stat]}`] : []
            }),
          },
        })),
      }
    }

    const offerIds = Array.isArray(state.offerIds) ? state.offerIds : []
    const counts = holdingCounts(context.held)
    return {
      screenKey: step,
      choices: offerIds.flatMap((id) => {
        const modifier = typeof id === 'string' ? context.catalog.get(id) : undefined
        if (!modifier) return []
        return [
          {
            id: `offer:${modifier.id}`,
            label: modifier.name,
            icon: modifier.icon,
            detail: { title: modifier.name, lines: describeModifier(modifier, counts) },
          },
        ]
      }),
    }
  },

  resolve: (state, choiceId, context, rng) => {
    const step = stepOf(state.step)

    if (step === 'origin') {
      const origin = context.content.origins.find((candidate) => `origin:${candidate.id}` === choiceId)
      if (!origin) return { kind: 'stay', state, rng }
      return {
        kind: 'replace',
        stageId: CHARACTER_CREATION_STAGE_ID,
        input: { step: 'trait' },
        effects: [
          ...STAT_KEYS.flatMap((stat) => {
            const amount = origin.statDeltas[stat]
            return amount ? [{ kind: 'adjustBaseStat' as const, stat, amount }] : []
          }),
          { kind: 'recordOutcome', outcome: 'origin-chosen', payload: { originId: origin.id } },
        ],
        rng,
      }
    }

    const modifierId = choiceId.startsWith('offer:') ? choiceId.slice('offer:'.length) : null
    const modifier = modifierId ? context.catalog.get(modifierId) : undefined
    if (!modifier) return { kind: 'stay', state, rng }

    const acquire = {
      kind: 'acquireModifier',
      modifierKind: modifier.kind,
      modifierId: modifier.id,
    } as const

    if (step === 'trait') {
      return {
        kind: 'replace',
        stageId: CHARACTER_CREATION_STAGE_ID,
        input: { step: 'item' },
        effects: [acquire],
        rng,
      }
    }

    return {
      kind: 'replace',
      stageId: REGION_SELECT_STAGE_ID,
      effects: [
        acquire,
        // A run SETS OUT WHOLE. The record's hit points are derived once, at
        // creation, from a stat block that is still all zeroes -- so the
        // fifty they start at is the floor of `50 + 15 x Might` with no Might
        // yet, and every point of it the origin and the opening item grant
        // raises the MAXIMUM without raising the current. A warrior walked
        // into their first fight at 50 of 80 until this. Clamped to the max
        // on apply, so the number here only has to be large.
        { kind: 'adjustHitPoints', amount: Number.MAX_SAFE_INTEGER },
      ],
      rng,
    }
  },
}

export { CHARACTER_CREATION_STAGE_ID }
