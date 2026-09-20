// WHAT SURVIVES A RUN.
//
// Fame and stat points are both spent WITHIN a run and buy nothing that
// outlives it (model/famePurchases.ts). What crosses from one run to the next is
// this: a set of permanent unlocks, earned by what a run REACHED rather than
// carried over as currency. A player does not bank anything between runs; they
// widen what a run can start as.
//
// EARNED IS DERIVED, NEVER GRANTED. There is no effect that hands one out and
// no counter that could disagree with the run that produced it -- exactly the
// argument the milestone ladders already make for stat and fame points. The
// save's set is the UNION of what it already had with whatever the run now
// satisfies, recomputed after every effect, so:
//
//   - a new way to satisfy a condition is covered without its author knowing
//     this exists, because nothing has to remember to check;
//   - the set only ever grows, so an unlock cannot be lost by a later effect
//     making its condition false again (spend a point, drop an item);
//   - and there is no site to forget, which is the failure a hand-placed
//     check invites and this codebase's characteristic one.
//
// A CONDITION READS THE RUN, not the save. An unlock earned by two runs
// together would be a different kind of thing -- a tally, which is the
// currency model this deliberately replaced -- so the type cannot express one.

import { BASE_STAT_CAP, STAT_LABELS } from './stats'
import type { GameRecord } from './gameState'

export interface PermanentUnlock {
  id: string
  /** What the player reads when it lands. */
  name: string
  /** What they did to get it, in words, for the moment it is announced. */
  earnedFor: string
  isEarnedBy: (game: GameRecord) => boolean
}

const PAIR_UNLOCKS = [
  ['might', 'agility', 'Balanced'],
  ['might', 'perception', 'Measured'],
  ['might', 'intellect', 'Steadfast'],
  ['might', 'charisma', 'Commanding'],
  ['might', 'luck', 'Destined'],
  ['agility', 'perception', 'Nimble'],
  ['agility', 'intellect', 'Spry'],
  ['agility', 'charisma', 'Vivacious'],
  ['agility', 'luck', 'Cunning'],
  ['perception', 'intellect', 'Observant'],
  ['perception', 'charisma', 'Dignified'],
  ['perception', 'luck', 'Learned'],
  ['intellect', 'charisma', 'Mirthful'],
  ['intellect', 'luck', 'Incandescent'],
  ['charisma', 'luck', 'Glorious'],
] as const

export const PERMANENT_UNLOCKS: readonly PermanentUnlock[] = [
  {
    id: 'berserker',
    name: 'Berserker',
    earnedFor: `${STAT_LABELS.might} ${BASE_STAT_CAP}/${BASE_STAT_CAP} in one run`,
    // Base stats are what the player SPENT and nothing else now that origins
    // resolve with the modifiers, so reaching the cap is six points put into
    // Might -- which is the condition as the author stated it, with no
    // arithmetic in between that could drift from it.
    isEarnedBy: (game) => game.baseStats.might >= BASE_STAT_CAP,
  },
  ...PAIR_UNLOCKS.map(([left, right, name]) => ({
    id: `${left}-${right}`,
    name,
    earnedFor: `${STAT_LABELS[left]} and ${STAT_LABELS[right]} maxed in one run`,
    isEarnedBy: (game: GameRecord) => game.baseStats[left] >= BASE_STAT_CAP && game.baseStats[right] >= BASE_STAT_CAP,
  })),
]

export function permanentUnlockById(id: string): PermanentUnlock | undefined {
  return PERMANENT_UNLOCKS.find((unlock) => unlock.id === id)
}

/**
 * The set after this run's state is taken into account -- the same array back
 * when nothing changed, so a caller can tell whether to write.
 *
 * Identity rather than a boolean, because the only caller is a state update
 * and "did anything change" is the question it actually has.
 */
export function withUnlocksEarnedBy(
  earned: readonly string[],
  game: GameRecord | null | undefined,
): readonly string[] {
  if (!game) return earned
  const held = new Set(earned)
  const added = PERMANENT_UNLOCKS.filter((unlock) => !held.has(unlock.id) && unlock.isEarnedBy(game))
  return added.length === 0 ? earned : [...earned, ...added.map((unlock) => unlock.id)]
}

/** Whether a thing gated behind an unlock is available. Ungated things always are. */
export function isUnlocked(earned: readonly string[], requiresUnlock: string | undefined): boolean {
  return requiresUnlock === undefined || earned.includes(requiresUnlock)
}
