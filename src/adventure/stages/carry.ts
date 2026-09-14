// Taking something when your hands are full.
//
// A run carries three of each kind (`carryLimit`). At the limit, taking
// something new is not refused -- it is a CHOICE about what to give up, made
// in the ring, because giving up a trait to make room for another is a step
// in the game rather than a standing preference (which is what the strip's
// keep marks are, and why those are pressed on the chrome instead).
//
// WHY THIS IS A HELPER AND NOT A STAGE. Every acquiring stage would like to
// push a "what do you drop" stage and carry on afterwards -- and a pushed
// stage cannot change its parent's state (core/stage.ts: `push` carries no
// `state`). So the parent could not have recorded that the offer was taken
// before handing over, and popping back would land on the same screen with
// the same offer still on it. The alternative is one SHARED STEP that each
// acquiring stage runs inside its own frame: the stage keeps `pendingId` in
// its own state, this module builds the screen and the effects, and the flow
// stays where the flow's state already lives.
//
// The whole rule is here rather than at each caller, which is the point: three
// stages acquire things (loot, the trader, the Oracle) and none of them should
// be able to disagree about what happens when the hands are full.

import type { Choice } from '../core/screen'
import type { Effect } from '../model/effects'
import type { StageContext } from '../core/stage'
import { carryLimit, holdingsOfKind } from '../model/gameState'
import { describeModifier, type ModifierKind } from '../model/modifiers'
import { holdingCounts } from '../model/gameState'

/** The cell id a drop choice carries, so a stage can recognise one. */
export const DROP_PREFIX = 'drop:'

export function readPendingId(state: { pendingId?: unknown }): string | null {
  return typeof state.pendingId === 'string' && state.pendingId.length > 0 ? state.pendingId : null
}

/** Whether taking one more of this kind means giving something up first. */
export function handsAreFull(context: StageContext, kind: ModifierKind): boolean {
  const game = context.game
  if (!game) return false
  return holdingsOfKind(context.save, game.id, kind).length >= carryLimit(game, kind)
}

/**
 * The screen: one cell per thing held of that kind, and nothing else. There
 * is deliberately no way back -- the choice was made on the previous screen
 * and this is the other half of it, so a cancel here would leave the offer
 * taken and nothing given up.
 */
export function dropChoices(context: StageContext, kind: ModifierKind, incomingId: string): Choice[] {
  const counts = holdingCounts(context.held)
  const incoming = context.catalog.get(incomingId)
  return context.held
    .filter((modifier) => modifier.kind === kind)
    .map((modifier) => ({
      id: `${DROP_PREFIX}${modifier.id}`,
      label: modifier.name,
      icon: modifier.icon,
      detail: {
        title: `Give up ${modifier.name}`,
        lines: [
          ...describeModifier(modifier, counts),
          ...(incoming ? [`Makes room for ${incoming.name}`] : []),
        ],
      },
    }))
}

/** What a drop choice is worth: the one given up, then the one taken. */
export function dropEffects(kind: ModifierKind, choiceId: string, incomingId: string): Effect[] | null {
  if (!choiceId.startsWith(DROP_PREFIX)) return null
  const droppedId = choiceId.slice(DROP_PREFIX.length)
  return [
    // RELEASE FIRST: the acquisition would otherwise be the fourth of three,
    // and `acquireModifier` has no opinion about the limit -- the limit is a
    // rule about what a player may CHOOSE to hold, enforced where the choice
    // is offered, not a guard buried in the effect that applies it.
    { kind: 'releaseModifier', modifierKind: kind, modifierId: droppedId },
    { kind: 'acquireModifier', modifierKind: kind, modifierId: incomingId },
  ]
}

/** What the bar says while the question is up. */
export function dropNarration(kind: ModifierKind, incomingName: string): string {
  const noun = kind === 'item' ? 'carry' : 'hold'
  return `**${incomingName}.** *Your hands are full. What do you ${noun} no longer?*`
}
