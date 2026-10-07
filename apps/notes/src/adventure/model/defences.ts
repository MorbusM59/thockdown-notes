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

/**
 * WHAT EACH DEFENCE SWINGS BACK WITH, as a share of an ordinary attack --
 * the same Counter every other source adds into (model/tactics.ts).
 *
 * TAKE THE HIT IS THE ONLY ONE WITH ANY, and that is what makes it a choice.
 * As written it was Defend with the miss chance and the armour removed: the
 * attack lands for certain and in full, and nothing came back for it, so a
 * player who could see the numbers never pressed it (2% of the times a
 * lookahead player was offered it). Planting your feet and answering is the
 * reading the classes already had -- every move authored onto this cell
 * (Backdraft, Brace, Absolve) is a counter -- so the plain cell now says the
 * same thing plainly. Sources of Counter add (the author's rule, adventure-game-
 * design.md), so a move on this cell swings back with this AND its own. It pays when armour is spent, the attacker rarely misses
 * anyway, and the race is closer than the damage.
 */
export const DEFENCE_COUNTER: Readonly<Record<Defence, number>> = {
  dodge: 0,
  defend: 0,
  flee: 0,
  takeTheHit: 1,
}
