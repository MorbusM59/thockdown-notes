// One constant, alone, because of who needs it.
//
// `NO_SPELLS` is part of the round's shape (`RoundState.spellReach` in
// model/combat.ts) and part of the spell table's vocabulary
// (model/spells.ts) -- and spells.ts imports combat.ts for the exchange, so
// combat.ts cannot import spells.ts back. A shared leaf is the cheapest
// honest answer: the alternative is the same -1 written down twice, which is
// the drift this codebase is made of.
//
// MINUS ONE rather than zero, because zero is a real level: it is Singe.

export const NO_SPELLS = -1
