import { describe, expect, it } from 'vitest'

import {
  AUTO_ADVANCE_LABELS, AUTO_ADVANCE_MAX_MS, AUTO_ADVANCE_MIN_MS, AUTO_ADVANCE_SCOPES, AUTO_ADVANCE_STEP_MS,
  DEFAULT_AUTO_ADVANCE_MS, DEFAULT_AUTO_ADVANCE_SCOPE, boundaryKeyFor, clampAutoAdvanceMs, indexOfScope,
  isCombatOnly, scopeAtIndex, type AutoAdvanceScope,
} from './autoAdvance'

const IN_COMBAT = { stageId: 'combat', level: 1, encounter: 3, roundNumber: 2 }
const AT_THE_HUB = { stageId: 'encounterSelect', level: 1, encounter: 3, roundNumber: null }

describe('how far holding space carries', () => {
  it('is five choices, evenly spaced, with nothing first', () => {
    // The slider is an INDEX, so the five sit at equal distances on the
    // track -- the labels are words and words have no scale of their own.
    expect(AUTO_ADVANCE_SCOPES).toHaveLength(5)
    expect(AUTO_ADVANCE_SCOPES[0]).toBe('nothing')
    expect(DEFAULT_AUTO_ADVANCE_SCOPE).toBe('nothing')
    AUTO_ADVANCE_SCOPES.forEach((scope, index) => {
      expect(scopeAtIndex(index)).toBe(scope)
      expect(indexOfScope(scope)).toBe(index)
      expect(AUTO_ADVANCE_LABELS[scope].length).toBeGreaterThan(0)
    })
  })

  it('reads a position off the end, or off the rails, as one that exists', () => {
    for (const bad of [-4, 99, 1.4, Number.NaN, undefined, 'stage']) {
      expect(AUTO_ADVANCE_SCOPES).toContain(scopeAtIndex(bad as never))
    }
    // ...and rounds to the nearest notch rather than flooring, so dragging
    // past the middle of a gap lands on the choice under the thumb.
    expect(scopeAtIndex(1.6)).toBe('combat')
  })

  it('declines to start at all where the scope means nothing here', () => {
    // `nothing` never starts. A COMBAT scope never starts outside a fight --
    // an "action" is something you take in one, and there is nothing outside
    // for "until the end of the round" to mean.
    expect(boundaryKeyFor('nothing', IN_COMBAT)).toBeNull()
    expect(boundaryKeyFor('nothing', AT_THE_HUB)).toBeNull()
    for (const scope of ['round', 'combat'] as const) {
      expect(isCombatOnly(scope)).toBe(true)
      expect(boundaryKeyFor(scope, AT_THE_HUB)).toBeNull()
      expect(boundaryKeyFor(scope, IN_COMBAT)).not.toBeNull()
    }
    for (const scope of ['stage', 'level'] as const) {
      expect(isCombatOnly(scope)).toBe(false)
      expect(boundaryKeyFor(scope, AT_THE_HUB)).not.toBeNull()
    }
  })

  it('NESTS: every scope also ends at everything coarser than itself', () => {
    // The property the whole ladder rests on, and the reason each key names
    // the places above it rather than only its own. A hold scoped to the
    // round must end when the round ends -- and also when the fight does, and
    // also when the level does, without three comparisons saying so.
    const changesWhen = (scope: AutoAdvanceScope, after: Parameters<typeof boundaryKeyFor>[1]) =>
      boundaryKeyFor(scope, IN_COMBAT) !== boundaryKeyFor(scope, after)

    const nextRound = { ...IN_COMBAT, roundNumber: 3 }
    const fightOver = { ...IN_COMBAT, stageId: 'loot', roundNumber: null }
    const nextEncounter = { ...IN_COMBAT, encounter: 4 }
    const nextLevel = { ...IN_COMBAT, level: 2 }

    expect(changesWhen('round', nextRound)).toBe(true)
    expect(changesWhen('round', fightOver)).toBe(true)
    expect(changesWhen('round', nextLevel)).toBe(true)

    // A fight-scoped hold is NOT ended by a round turning over -- that is the
    // whole of what choosing the wider scope buys.
    expect(changesWhen('combat', nextRound)).toBe(false)
    expect(changesWhen('combat', fightOver)).toBe(true)
    expect(changesWhen('combat', nextEncounter)).toBe(true)

    expect(changesWhen('stage', nextRound)).toBe(false)
    expect(changesWhen('stage', fightOver)).toBe(true)

    // ...and the widest is ended by the level alone.
    expect(changesWhen('level', nextRound)).toBe(false)
    expect(changesWhen('level', fightOver)).toBe(false)
    expect(changesWhen('level', nextEncounter)).toBe(false)
    expect(changesWhen('level', nextLevel)).toBe(true)
  })
})

describe('how fast it carries', () => {
  it('lands on a notch, inside the range, whatever it is handed', () => {
    expect(clampAutoAdvanceMs(0)).toBe(AUTO_ADVANCE_MIN_MS)
    expect(clampAutoAdvanceMs(99999)).toBe(AUTO_ADVANCE_MAX_MS)
    expect(clampAutoAdvanceMs(174)).toBe(150)
    expect(clampAutoAdvanceMs(176)).toBe(200)
    for (const bad of [undefined, null, 'quick', Number.NaN]) {
      expect(clampAutoAdvanceMs(bad)).toBe(DEFAULT_AUTO_ADVANCE_MS)
    }
  })

  it('has a default a reader can actually follow', () => {
    // Fifty milliseconds is twenty presses a second, which is a fight over
    // before the bar has said what happened in it.
    expect(DEFAULT_AUTO_ADVANCE_MS).toBeGreaterThan(AUTO_ADVANCE_MIN_MS)
    expect(DEFAULT_AUTO_ADVANCE_MS % AUTO_ADVANCE_STEP_MS).toBe(0)
    expect(clampAutoAdvanceMs(DEFAULT_AUTO_ADVANCE_MS)).toBe(DEFAULT_AUTO_ADVANCE_MS)
  })
})
