// Where in the level we are: one number, read off the game record.
//
// A level is ten encounters. The count lives on the record
// (`GameRecord.encounterIndex`) and advances by an EFFECT, emitted by
// whatever stage spent the encounter:
//
//   encounterSelect -> hunt -> combat -> loot -(advanceEncounter)-> encounterSelect
//
// It used to be threaded from stage to stage as INPUT instead, because a
// stage cannot update its own state while pushing a child and every stage in
// the chain replaces the last at the same depth, so there was no parent frame
// to keep it in. Both of those are facts about the STACK, and the counter
// turned out not to be a fact about the stack at all: it is a property of the
// run, which is why the chrome's identity line (`V-3`) has to read it from
// outside the stack entirely. See gameState.ts's `encounterIndex`.
//
// The count advances exactly once per encounter, and on the way OUT rather
// than on the way in -- which is what makes a fled encounter still spend one
// (the player took the branch), and what makes the display read as the
// encounter you are PREPARING for the moment the spoils screen is behind you.

import type { GameRecord } from '../model/gameState'
import { LEVEL_ENCOUNTER_COUNT } from '../model/encounterOffers'

/** Which encounter the run is on, or the first when there is no run. */
export function currentEncounter(game: GameRecord | null): number {
  if (!game) return 1
  const parsed = Math.floor(game.encounterIndex)
  return parsed >= 1 ? parsed : 1
}

/** True once every one of the level's encounters has been spent. */
export function isLevelComplete(encounter: number): boolean {
  return encounter > LEVEL_ENCOUNTER_COUNT
}

/**
 * What the chrome shows beside the level: 1..10 and never eleven.
 *
 * The counter runs one past the last encounter so the hub can tell the level
 * is over, and that eleventh value is a sequencing fact rather than a place
 * -- a reader looking at `V-11` in a level of ten would read a bug. Standing
 * on the last one is what being finished looks like from outside.
 */
export function displayEncounter(game: GameRecord | null): number {
  return Math.min(LEVEL_ENCOUNTER_COUNT, currentEncounter(game))
}

export { LEVEL_ENCOUNTER_COUNT }
