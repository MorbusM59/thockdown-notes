// Where in the level we are, threaded through the stages that make up one
// encounter.
//
// The index is passed from stage to stage as INPUT rather than kept on the
// game record or in a parent frame. Two reasons, and the second is the real
// one: a stage cannot update its own state while pushing a child, so a
// parent holding the count could never advance it; and every stage in the
// chain replaces the last at the same depth, so there is no parent to hold
// it in the first place.
//
//   encounterSelect -> hunt -> combat -> loot -> encounterSelect(+1)
//
// The count advances exactly once per encounter, on the way back, which is
// what makes a fled encounter still spend one: the player took the branch.

import { LEVEL_ENCOUNTER_COUNT } from '../model/encounterOffers'

export function encounterIndexOf(value: unknown): number {
  const parsed = typeof value === 'number' ? Math.floor(value) : 1
  return parsed >= 1 ? parsed : 1
}

/** True once every one of the level's encounters has been spent. */
export function isLevelComplete(encounter: number): boolean {
  return encounter > LEVEL_ENCOUNTER_COUNT
}
