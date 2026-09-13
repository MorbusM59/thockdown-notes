import { describe, expect, it } from 'vitest'

import { narrationText, parseNarration } from './narrationMarkup'

const text = (value: string, bold = false, italic = false) => ({ kind: 'text', text: value, bold, italic })

describe('narration markup', () => {
  it('reads the specified shape: action bold, outcome italic, figure both', () => {
    expect(parseNarration('**Attack:** *You land it for **8**.*')).toEqual([
      text('Attack:', true),
      text(' '),
      text('You land it for ', false, true),
      text('8', true, true),
      text('.', false, true),
    ])
  })

  it('NESTS, which a pair-matcher cannot', () => {
    // Read as pairs left to right, the outer italic closes on the first star
    // of the inner mark and everything after it is nonsense. The figure being
    // bold AND italic is the specification, so nesting is not optional.
    expect(parseNarration('*a **8** b*')).toEqual([
      text('a ', false, true),
      text('8', true, true),
      text(' b', false, true),
    ])
  })

  it('leaves an unmatched mark as text rather than swallowing the line', () => {
    expect(parseNarration('a * b')).toEqual([text('a * b')])
    expect(parseNarration('**unclosed')).toEqual([text('**unclosed')])
  })

  it('leaves plain narration entirely alone', () => {
    expect(parseNarration('You take a moment.')).toEqual([text('You take a moment.')])
  })

  it('reads an icon, with the word it stands for', () => {
    expect(parseNarration('[fa-solid fa-burst|hit] **8**')).toEqual([
      { kind: 'icon', icon: 'fa-solid fa-burst', label: 'hit' },
      text(' '),
      text('8', true),
    ])
  })

  it('will not open an icon without the pipe, so a glyph is never accidentally wordless', () => {
    expect(parseNarration('[fa-solid fa-burst]')).toEqual([text('[fa-solid fa-burst]')])
  })

  it('takes an empty word as a decision: the glyph is there, and it says nothing', () => {
    expect(parseNarration('[fa-solid fa-left-long|]')).toEqual([
      { kind: 'icon', icon: 'fa-solid fa-left-long', label: '' },
    ])
    expect(narrationText(parseNarration('[fa-solid fa-right-long|versus][fa-solid fa-left-long|]'))).toBe('versus')
  })

  it('leaves a bracket that is not an icon exactly where it is', () => {
    expect(parseNarration('a [b] c')).toEqual([text('a [b] c')])
    expect(parseNarration('unclosed [')).toEqual([text('unclosed [')])
  })

  it('reads back as words, which is what a screen reader is given', () => {
    expect(narrationText(parseNarration('[fa-solid fa-user-shield|you] [fa-solid fa-burst|hit] **8** [fa-solid fa-skull|it]')))
      .toBe('you hit 8 it')
  })
})
