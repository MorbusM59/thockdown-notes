// THE GUARDIAN ANGEL: a hidden floor under the run's luckiness, for as long
// as a character is too new to carry themselves.
//
// A run starts at tier 0 now (model/vectors.ts): every point of tier is
// earned, one per stat point awarded, so a first-level character is materially
// weaker than the tier-5 one that preceded this. That is the intended shape --
// advancement should be felt -- but the first level is also where a run has
// the least to work with and the least reason to keep going.
//
// So the first levels come with a thumb already on the scale, and it lifts
// off by itself:
//
//   level 1   60%      level 3   20%
//   level 2   40%      level 4+   0%
//
// It is a FLOOR, not a setting and not an addend: it supersedes the reader's
// own Luckiness slider only while it is higher, so a player who has turned
// theirs up past it never notices this exists, and one who has left it at
// zero gets a soft landing they were never told about. Adding to the slider
// instead would make the early game harder for somebody who deliberately set a
// high number, which is the opposite of what a floor is for.
//
// INVISIBLE, deliberately. It is not a mechanic to play around; it is the
// game declining to be brutal before a player has anything to be brutal with.
// The two numbers are named so they can be tuned without reading this.

/** What the floor is worth on the first level, as a percentage. */
export const LUCKINESS_INITIAL = 60

/** How much of it is given back at the end of each level, as a percentage. */
export const LUCKINESS_INITIAL_DECAY = 20

/**
 * The floor for this level, as a FRACTION (0..1), which is the unit
 * `successAdjust` is in everywhere else (model/chance.ts).
 *
 * Floored at zero rather than allowed to go negative: past the fourth level
 * there is no floor at all, and a negative one would be a penalty nobody
 * asked for. Levels below the first read as the first, the same way
 * `monsterTier` treats them.
 */
export function guardianLuckiness(level: number): number {
  const levelsPast = Math.max(0, Math.floor(level) - 1)
  const percent = LUCKINESS_INITIAL - (LUCKINESS_INITIAL_DECAY * levelsPast)
  return Math.max(0, percent) / 100
}
