// HOW A CLASS'S MOVES READ on the screen that chooses one.
//
// A class is the only vector whose worth is prose rather than a figure, so
// this is the longest thing any choice screen asks a player to read. Read as a
// flat run of clauses there was no way to see where one move stopped and the
// next began, and the format that fixes it does the grouping with spacing and
// enclosure rather than with punctuation anybody has to interpret. It is a
// LAYOUT the eye depends on, so it is pinned here rather than left to drift.

import { describe, expect, it } from 'vitest'

import { THOCKQUEST } from '../content'
import { movesLine } from './characterCreation'
import { parseNarration, narrationText } from '../../escapeMenu/narrationMarkup'

const CLASSES = THOCKQUEST.combatClasses

describe('a class\'s moves, on the screen that chooses one', () => {
  it('encloses each move and separates them by more space than anything inside one', () => {
    for (const combatClass of CLASSES) {
      const line = movesLine(combatClass, 'concise')
      // One bracketed group per move, and nothing outside them but the gaps.
      const groups = line.split('   ')
      expect(groups, combatClass.id).toHaveLength(combatClass.moves.length)
      for (const group of groups) {
        expect(group.startsWith('[ '), group).toBe(true)
        expect(group.endsWith(' ]'), group).toBe(true)
      }
    }
  })

  it('shouts the move\'s NAME, so the eye finds where each one starts', () => {
    for (const combatClass of CLASSES) {
      const words = narrationText(parseNarration(movesLine(combatClass, 'concise')))
      for (const move of combatClass.moves) {
        expect(words, `${combatClass.id}/${move.id}`).toContain(move.name.toUpperCase())
      }
    }
  })

  it('marks each move with the cell it STANDS IN FOR, in the fight\'s own glyphs', () => {
    // The one fact the prose never said, and the reason a player is reading
    // this at all: a move does not add a choice, it replaces one.
    const marks = new Set<string>()
    for (const combatClass of CLASSES) {
      const line = movesLine(combatClass, 'concise')
      for (const [index, move] of combatClass.moves.entries()) {
        const group = line.split('   ')[index]
        const expected = move.replaces === 'attack' ? 'fa-solid fa-gavel' : 'fa-solid fa-shield'
        expect(group, `${combatClass.id}/${move.id}`).toContain(`[${expected}|`)
        marks.add(expected)
      }
    }
    // A guard on the guard: one mark used everywhere would pass every
    // assertion above and tell a player nothing.
    expect(marks).toEqual(new Set(['fa-solid fa-gavel', 'fa-solid fa-shield']))
  })

  it('is one detail line, so the pill\'s own separator never lands between moves', () => {
    // `DETAIL_SEPARATOR` is the app's rule for what goes between two detail
    // lines; the spacing above is this screen's. Handing the pill a single
    // line is what keeps the two from arguing.
    for (const combatClass of CLASSES) {
      expect(movesLine(combatClass, 'concise')).not.toContain('  |  ')
    }
  })
})
