// The four answers to an incoming attack.
//
// Its own module, and that is not tidying: `model/moves.ts` declares which
// choice a class move stands in for, and combat resolves the move -- so with
// these living in combat.ts the two would import each other. A list of four
// strings has no dependencies at all, which makes it the natural leaf.

export const DEFENCES = ['dodge', 'defend', 'flee', 'takeTheHit'] as const

export type Defence = (typeof DEFENCES)[number]

/** What the player may pick, this time. Dodge is the only one that has to be earned. */
export function defencesOffered(dodgeOffered: boolean): Defence[] {
  return DEFENCES.filter((defence) => defence !== 'dodge' || dodgeOffered)
}
