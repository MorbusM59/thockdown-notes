// HOW A CLASS'S MOVES READ on the screen that chooses one.
//
// A class is the only vector whose worth is prose rather than a figure, so
// this is the longest thing any choice screen asks a player to read. Read as a
// flat run of clauses there was no way to see where one move stopped and the
// next began: each move is its own detail line, so the pill's separator stands
// between moves and only commas stand inside one. It is a LAYOUT the eye
// depends on, so it is pinned here rather than left to drift.

import { describe, expect, it } from 'vitest'

import { THOCKQUEST } from '../content'
import { moveLines } from './characterCreation'
import { DETAIL_SEPARATOR, narrationText, parseNarration } from '../../escapeMenu/narrationMarkup'

const CLASSES = THOCKQUEST.combatClasses

describe('a class\'s moves, on the screen that chooses one', () => {
  it('is one detail line per move, so the pill\'s separator is what divides them', () => {
    for (const combatClass of CLASSES) {
      const lines = moveLines(combatClass, 'concise')
      expect(lines, combatClass.id).toHaveLength(combatClass.moves.length)
      // Nothing inside a move may look like the line between two.
      for (const line of lines) expect(narrationText(parseNarration(line))).not.toContain(DETAIL_SEPARATOR.trim())
    }
  })

  it('sets the move\'s NAME in bold right after its glyph, so the eye finds where each one starts', () => {
    for (const combatClass of CLASSES) {
      for (const [index, line] of moveLines(combatClass, 'concise').entries()) {
        const [glyph, ...rest] = parseNarration(line)
        const name = rest.find((span) => span.kind === 'icon' || span.text.trim().length > 0)
        expect(glyph.kind, line).toBe('icon')
        expect(name, line).toMatchObject({ kind: 'text', bold: true, text: combatClass.moves[index].name })
      }
    }
  })

  it('marks each move with the cell it STANDS IN FOR, in the fight\'s own glyphs', () => {
    // The one fact the prose never said, and the reason a player is reading
    // this at all: a move does not add a choice, it replaces one.
    const marks = new Set<string>()
    for (const combatClass of CLASSES) {
      for (const [index, line] of moveLines(combatClass, 'concise').entries()) {
        const move = combatClass.moves[index]
        const expected = move.replaces === 'attack' ? 'fa-solid fa-gavel' : 'fa-solid fa-shield'
        expect(line, `${combatClass.id}/${move.id}`).toMatch(new RegExp(`^\\[${expected}\\|`))
        marks.add(expected)
      }
    }
    // A guard on the guard: one mark used everywhere would pass every
    // assertion above and tell a player nothing.
    expect(marks).toEqual(new Set(['fa-solid fa-gavel', 'fa-solid fa-shield']))
  })
})
