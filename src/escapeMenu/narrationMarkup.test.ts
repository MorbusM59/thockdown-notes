import { describe, expect, it } from 'vitest'

import { parseNarration } from './narrationMarkup'

describe('narration markup', () => {
  it('reads the specified shape: action bold, outcome italic, figure both', () => {
    expect(parseNarration('**Attack:** *You land it for **8**.*')).toEqual([
      { text: 'Attack:', bold: true, italic: false },
      { text: ' ', bold: false, italic: false },
      { text: 'You land it for ', bold: false, italic: true },
      { text: '8', bold: true, italic: true },
      { text: '.', bold: false, italic: true },
    ])
  })

  it('NESTS, which a pair-matcher cannot', () => {
    // Read as pairs left to right, the outer italic closes on the first star
    // of the inner mark and everything after it is nonsense. The figure being
    // bold AND italic is the specification, so nesting is not optional.
    const spans = parseNarration('*a **8** b*')
    expect(spans).toEqual([
      { text: 'a ', bold: false, italic: true },
      { text: '8', bold: true, italic: true },
      { text: ' b', bold: false, italic: true },
    ])
  })

  it('leaves an unmatched mark as text rather than swallowing the line', () => {
    expect(parseNarration('a * b')).toEqual([{ text: 'a * b', bold: false, italic: false }])
    expect(parseNarration('**unclosed')).toEqual([{ text: '**unclosed', bold: false, italic: false }])
  })

  it('leaves plain narration entirely alone', () => {
    expect(parseNarration('You take a moment.')).toEqual([
      { text: 'You take a moment.', bold: false, italic: false },
    ])
  })
})
