// HOLDING SPACE TO PLAY ON, and how far that is allowed to carry.
//
// The reader holds the space bar and the ring presses the cell it is sitting
// on, over and over, until the boundary they chose is crossed. What makes
// this safe to offer at all is the rule the ring was already built around:
// the first cell IS the recommendation (the strongest spell, then the
// attack), and a fresh screen puts the dial back on it -- so "press the
// first cell repeatedly" is playing well rather than playing at random.
//
// FIVE SCOPES, NESTED. Each includes everything to its left, which is why
// this is an ordered list and not a set of flags: the choice is HOW FAR, and
// a reader who picked "until the end of a level" wants the round and the
// fight carried too.
//
//   nothing  -- the space bar does what it always did, and no more
//   round    -- actions, until this round closes
//   combat   -- actions, until this fight ends
//   stage    -- choices, until this screen's stage hands off
//   level    -- choices, until the level is behind you
//
// THE FIRST TWO ARE COMBAT-ONLY and the last two are not, which is not an
// inconsistency: an ACTION is a thing you take in a fight, and outside one
// there is nothing for "until the end of the round" to mean. The words in
// the design are the words here.
//
// WHAT COUNTS AS THE BOUNDARY IS THE GAME'S TO SAY, not the ring's. The ring
// is handed a `boundaryKey` -- an opaque string that changes exactly when
// the chosen scope has been crossed -- and its whole rule is "stop when the
// string I started with is not the string I see". That keeps rounds, fights,
// stages and levels out of a component whose business is a dial, and it
// means a sixth scope is a line in this file rather than a change there.

export const AUTO_ADVANCE_SCOPES = ['nothing', 'round', 'combat', 'stage', 'level'] as const

export type AutoAdvanceScope = (typeof AUTO_ADVANCE_SCOPES)[number]

/** What the slider's tooltip says at each of its five positions. */
export const AUTO_ADVANCE_LABELS: Readonly<Record<AutoAdvanceScope, string>> = {
  nothing: 'nothing',
  round: 'actions until the end of the round',
  combat: 'actions until the end of combat',
  stage: 'choices until the end of the stage',
  level: 'choices until the end of the level',
}

export const DEFAULT_AUTO_ADVANCE_SCOPE: AutoAdvanceScope = 'nothing'

/** The slider is an INDEX into the list, so the five positions are evenly spaced. */
export function scopeAtIndex(index: unknown): AutoAdvanceScope {
  if (typeof index !== 'number' || !Number.isFinite(index)) return DEFAULT_AUTO_ADVANCE_SCOPE
  const clamped = Math.min(AUTO_ADVANCE_SCOPES.length - 1, Math.max(0, Math.round(index)))
  return AUTO_ADVANCE_SCOPES[clamped]
}

export function indexOfScope(scope: AutoAdvanceScope): number {
  return Math.max(0, AUTO_ADVANCE_SCOPES.indexOf(scope))
}

/** Whether this scope only means anything inside a fight. */
export function isCombatOnly(scope: AutoAdvanceScope): boolean {
  return scope === 'round' || scope === 'combat'
}

// --- How fast ---------------------------------------------------------------

export const AUTO_ADVANCE_MIN_MS = 50
export const AUTO_ADVANCE_MAX_MS = 1000
export const AUTO_ADVANCE_STEP_MS = 50

/**
 * THE MIDDLE, not the fastest.
 *
 * Fifty milliseconds is twenty presses a second, which is a fight over
 * before the bar has said what happened in it -- readable as a result rather
 * than as a fight. The default is somewhere a reader can actually follow,
 * and the slider is right there for anybody who wants the result.
 */
export const DEFAULT_AUTO_ADVANCE_MS = 300

export function clampAutoAdvanceMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_AUTO_ADVANCE_MS
  const stepped = Math.round(value / AUTO_ADVANCE_STEP_MS) * AUTO_ADVANCE_STEP_MS
  return Math.min(AUTO_ADVANCE_MAX_MS, Math.max(AUTO_ADVANCE_MIN_MS, stepped))
}

/**
 * THE KEY THAT STOPS THE HOLD, for one scope, read off where the run is.
 *
 * Every scope's key names everything coarser than itself as well, which is
 * what makes the nesting fall out of the strings rather than out of five
 * comparisons: a round's key carries the encounter and the level, so a hold
 * scoped to the round also ends when the fight does, and when the level
 * does. Written once, here, because "the round changed" and "the fight
 * changed" are the same question asked at two depths.
 *
 * Null means the hold may not start at all -- the scope is `nothing`, or it
 * is a combat scope and this is not a fight.
 */
export function boundaryKeyFor(scope: AutoAdvanceScope, where: {
  stageId: string
  level: number
  encounter: number
  /** The combat round, where a fight is what is on screen. */
  roundNumber: number | null
}): string | null {
  const inCombat = where.roundNumber !== null
  if (scope === 'nothing') return null
  if (isCombatOnly(scope) && !inCombat) return null
  const place = `${where.level}:${where.encounter}`
  switch (scope) {
    case 'round': return `round:${place}:${where.stageId}:${where.roundNumber}`
    case 'combat': return `combat:${place}:${where.stageId}`
    case 'stage': return `stage:${place}:${where.stageId}`
    case 'level': return `level:${where.level}`
  }
}
