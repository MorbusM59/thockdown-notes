// The four answers to an incoming attack.
//
// Its own module, and that is not tidying: `model/moves.ts` declares which
// choice a class move stands in for, and combat resolves the move -- so with
// these living in combat.ts the two would import each other. A list of four
// strings has no dependencies at all, which makes it the natural leaf.

export const DEFENCES = ['dodge', 'defend', 'flee', 'tradeBlows'] as const

export type Defence = (typeof DEFENCES)[number]

/** What the player may pick, this time. Dodge is the only one that has to be earned. */
export function defencesOffered(dodgeOffered: boolean): Defence[] {
  return DEFENCES.filter((defence) => defence !== 'dodge' || dodgeOffered)
}

/**
 * TRADE BLOWS: the attack lands for certain, armour counts as it does for
 * Defend, and the defender swings back with an ordinary attack at half
 * strength -- plus a fifth of that half for every point of Might they have
 * over the attacker, minus the same for every point under (60% at +1, 40% at
 * -1, nothing at -5 or below). The author's rule, adventure-game-design.md.
 *
 * It is the same Counter every other source adds into (model/tactics.ts), so
 * a class move on this cell swings back with this share AND its own.
 */
export const TRADE_BLOWS_SHARE = 0.5
export const TRADE_BLOWS_MIGHT_STEP = 0.2

/** What a defence swings back with, as a share of an ordinary attack. Only Trade Blows has any. */
export function defenceCounter(defence: Defence, defenderMight: number, attackerMight: number): number {
  if (defence !== 'tradeBlows') return 0
  return Math.max(0, TRADE_BLOWS_SHARE * (1 + TRADE_BLOWS_MIGHT_STEP * (defenderMight - attackerMight)))
}
