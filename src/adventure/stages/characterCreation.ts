// Character creation: the three content vectors, and then the two things you
// bring with you.
//
// FIVE QUESTIONS, in the order the four vectors read in a name:
//
//   1. build    -- what SHAPE you are          ("Dashing")
//   2. species  -- what you ARE                ("Davalian")
//   3. class    -- what you DO in a fight      ("Duelist")
//   4. trait    -- what you are known for
//   5. item     -- what you would never leave home without
//
// The fourth vector, TIER, is not asked: a run starts at five and fame buys
// it upward inside the run (model/vectors.ts, model/famePurchases.ts). A
// question whose only possible answer at this moment is "five" is not a
// question.
//
// The stage hands off TO ITSELF between steps rather than carrying a counter
// through one long state. That is not stylistic: `enter` runs after the
// director has applied the previous answer's effects, so the offers for a
// later question are rolled against the stats the earlier ones granted.
// Rolling them inside a single `resolve` would use the profile as it was
// BEFORE the choice that just changed it -- which is exactly the bug the
// design calls out when it says a Luck bonus from the item just taken should
// widen the next offer. With a build and a species now settled before the
// trait screen, that is no longer a subtlety: the whole stat block arrives in
// steps one and two, and step four's offer count is `2 + Luck/2` of it.

import { nextSample, type RngState } from '../core/rng'
import type { JsonObject } from '../core/json'
import type { StageContext, StageModule } from '../core/stage'
import { describeModifier, type Modifier } from '../model/modifiers'
import { holdingCounts } from '../model/gameState'
import { isUnlocked } from '../model/permanentUnlocks'
import { describeMove } from '../model/moves'
import { describeBuild } from '../model/vectors'
import { CHARACTER_CREATION_STAGE_ID, REGION_SELECT_STAGE_ID } from './ids'

/**
 * HOW MANY OF EACH VECTOR THE RUN DEALS OUT.
 *
 * The content lists are deliberately longer than this -- two dozen builds, a
 * dozen classes -- and the ring holds twelve cells in total
 * (`MAX_STAGE_CHOICES`). So creation SAMPLES, exactly as the trait and item
 * offers on the screens after it do, and exactly as the loot screen and the
 * omen do: what you may be is dealt, and a run is partly the hand it was
 * dealt. That is the game's standing idiom and the only one that lets the
 * catalogue grow without the dial growing with it.
 *
 * SIX rather than the full twelve, because six is a choice a player can read
 * in one pass and twelve is a list they scroll. Fixed rather than
 * `2 + Luck/2`: at creation there is no Luck, and a rule that resolves to two
 * on the one screen where it would apply is a rule pretending to be one.
 */
export const CREATION_OFFER_COUNT = 6

const STEPS = ['build', 'species', 'class', 'trait', 'item'] as const

type Step = (typeof STEPS)[number]

function stepOf(value: unknown): Step {
  return STEPS.includes(value as Step) ? (value as Step) : 'build'
}

/** What follows what. The last vector screen hands off to the trait offer. */
function nextStep(step: Step): Step | null {
  const index = STEPS.indexOf(step)
  return index >= 0 && index < STEPS.length - 1 ? STEPS[index + 1] : null
}

function offerPool(step: Step, context: StageContext): readonly Modifier[] {
  // Only what is not already held: a second copy of something is not a second
  // thing (model/gameState.ts's `acquireModifier`).
  const pool = step === 'trait' ? context.traits : step === 'item' ? context.items : []
  return pool.filter((modifier) => !context.held.some((row) => row.id === modifier.id))
}

/**
 * WHAT THIS RUN MAY BE, for one vector: a sample of the ones it is allowed.
 *
 * The unlock gate is applied BEFORE the sample, not after, so an earned
 * option competes for a place on the ring like any other rather than
 * displacing one -- and so a player who has earned nothing still sees six.
 */
function vectorPool(step: Step, context: StageContext): readonly { id: string; requiresUnlock?: string; playable?: boolean }[] {
  const unlocked = context.save.profile.unlocked
  const all = step === 'build' ? context.content.builds
    : step === 'species' ? context.content.species
    : step === 'class' ? context.content.combatClasses
    : []
  return all.filter((entry) => (
    // A species must SAY it is playable; a build or a class is playable
    // unless it says otherwise. Those defaults are the right way round: the
    // peoples are a short named list, and the other two vectors are shared
    // with monsters by default.
    (step === 'species' ? entry.playable === true : entry.playable !== false)
    && isUnlocked(unlocked, entry.requiresUnlock)
  ))
}

function rollOffers(step: Step, context: StageContext, rng: RngState): { offerIds: string[]; rng: RngState } {
  if (step === 'build' || step === 'species' || step === 'class') {
    const pool = vectorPool(step, context)
    if (pool.length === 0) return { offerIds: [], rng }
    const sample = nextSample(rng, pool, CREATION_OFFER_COUNT)
    return { offerIds: sample.value.map((entry) => entry.id), rng: sample.rng }
  }
  const pool = offerPool(step, context)
  if (pool.length === 0) return { offerIds: [], rng }
  const count = context.profile?.derived.offerChoices ?? 2
  const sample = nextSample(rng, pool, count)
  return { offerIds: sample.value.map((modifier) => modifier.id), rng: sample.rng }
}

/** The ids this screen dealt, as written by `enter`. */
function dealt(state: JsonObject): string[] {
  return Array.isArray(state.offerIds) ? state.offerIds.filter((id): id is string => typeof id === 'string') : []
}

const NARRATION: Readonly<Record<Step, string>> = {
  build: 'What shape are you? Something...',
  species: 'And what are you?',
  class: 'What do you do when it comes to blows?',
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
    const unlocked = context.save.profile.unlocked

    // A vector the player has not earned is not on the ring at all. The gate
    // is HERE rather than in content, the same way every other reachability
    // gate in this game lives in the stage that offers the choice: content
    // says what a thing requires, the screen decides whether to offer it.
    if (step === 'build') {
      const offered = new Set(dealt(state))
      return {
        screenKey: `build:${unlocked.length}`,
        choices: context.content.builds
          .filter((build) => offered.has(build.id))
          .map((build) => ({
            id: `build:${build.id}`,
            label: build.name,
            icon: build.icon,
            detail: {
              title: build.name,
              // THE WEIGHTS AND NOTHING ELSE. A build is a blueprint for
              // growth -- a set of proportions -- and the tier is how far the
              // run has got, which is a different quantity and belongs to a
              // different pill. Showing the stat points a build comes to at
              // the CURRENT tier put the two in one sentence and made the
              // ratio look like a consequence of the tier rather than the
              // thing being chosen.
              lines: describeBuild(build),
            },
          })),
      }
    }

    if (step === 'species') {
      const counts = holdingCounts(context.held)
      const offered = new Set(dealt(state))
      return {
        screenKey: `species:${unlocked.length}`,
        choices: context.content.species
          .filter((species) => offered.has(species.id))
          .map((species) => ({
            id: `species:${species.id}`,
            label: species.name,
            icon: species.icon,
            detail: {
              title: species.name,
              // Through the same describer an item's detail uses, which is
              // the whole point of a species carrying the modifier
              // vocabulary: "+25% hit points" needs no code here at all.
              lines: describeModifier(
                { id: species.id, kind: 'trait', name: species.name, icon: species.icon, effects: species.effects },
                counts,
                context.describe,
              ),
            },
          })),
      }
    }

    if (step === 'class') {
      const offered = new Set(dealt(state))
      return {
        screenKey: `class:${unlocked.length}`,
        choices: context.content.combatClasses
          .filter((combatClass) => offered.has(combatClass.id))
          .map((combatClass) => ({
            id: `class:${combatClass.id}`,
            label: combatClass.name,
            icon: combatClass.icon,
            detail: {
              title: combatClass.name,
              // Every move, named and spelled out. A class is the one vector
              // whose worth cannot be read off a number, so the detail is the
              // whole of what the player has to go on.
              lines: combatClass.moves.flatMap((move) => [`${move.name}`, ...describeMove(move, context.describe).map((line) => `  ${line}`)]),
            },
          })),
      }
    }

    const counts = holdingCounts(context.held)
    return {
      screenKey: step,
      choices: dealt(state).flatMap((id) => {
        const modifier = context.catalog.get(id)
        if (!modifier) return []
        return [
          {
            id: `offer:${modifier.id}`,
            label: modifier.name,
            icon: modifier.icon,
            detail: { title: modifier.name, lines: describeModifier(modifier, counts, context.describe) },
          },
        ]
      }),
    }
  },

  resolve: (state, choiceId, context, rng) => {
    const step = stepOf(state.step)

    // THE THREE VECTOR STEPS ARE ONE BRANCH, not three. They differ in which
    // list is searched and which word goes in the effect, and nothing else --
    // written out three times, the fourth would be written out a fourth.
    if (step === 'build' || step === 'species' || step === 'class') {
      const pool: readonly { id: string }[] =
        step === 'build' ? context.content.builds
        : step === 'species' ? context.content.species
        : context.content.combatClasses
      const offered = new Set(dealt(state))
      const chosen = pool.find((candidate) => `${step}:${candidate.id}` === choiceId && offered.has(candidate.id))
      if (!chosen) return { kind: 'stay', state, rng }
      const after = nextStep(step)
      if (!after) return { kind: 'stay', state, rng }
      return {
        kind: 'replace',
        stageId: CHARACTER_CREATION_STAGE_ID,
        input: { step: after },
        effects: [
          { kind: 'setVector', vector: step, id: chosen.id },
          { kind: 'recordOutcome', outcome: `${step}-chosen`, payload: { id: chosen.id } },
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
        // yet, and every point of it the build, the species and the opening
        // item grant raises the MAXIMUM without raising the current. A
        // warrior walked into their first fight at 50 of 80 until this.
        // Clamped to the max on apply, so the number here only has to be
        // large. It matters MORE now than it did: a tier-5 build is a bigger
        // opening stat block than an origin's two or three points ever was.
        { kind: 'adjustHitPoints', amount: Number.MAX_SAFE_INTEGER },
      ],
      rng,
    }
  },
}

export { CHARACTER_CREATION_STAGE_ID }
