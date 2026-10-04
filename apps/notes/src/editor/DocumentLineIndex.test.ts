import { describe, expect, it } from 'vitest'
import {
  applyEditToDocumentLineIndex,
  buildDocumentLineIndex,
  lineIndexAtOffset,
  type DocumentLineIndex,
} from './DocumentLineIndex'

function expectMatchesFullRebuild(index: DocumentLineIndex, text: string) {
  const truth = buildDocumentLineIndex(text)
  expect(index.text).toBe(text)
  expect(index.lines).toEqual(truth.lines)
  expect(index.lineStartOffsets).toEqual(truth.lineStartOffsets)
}

describe('buildDocumentLineIndex', () => {
  it('matches split semantics exactly, trailing newline included', () => {
    expect(buildDocumentLineIndex('').lines).toEqual([''])
    expect(buildDocumentLineIndex('a').lines).toEqual(['a'])
    expect(buildDocumentLineIndex('a\n').lines).toEqual(['a', ''])
    expect(buildDocumentLineIndex('\n').lines).toEqual(['', ''])
    expect(buildDocumentLineIndex('a\nb').lineStartOffsets).toEqual([0, 2])
    expect(buildDocumentLineIndex('a\n\nb').lineStartOffsets).toEqual([0, 2, 3])
  })
})

describe('lineIndexAtOffset', () => {
  const index = buildDocumentLineIndex('abc\nde\n\nfghi')
  it('maps every offset in the document to the line containing it', () => {
    const expected = [0, 0, 0, 0, 1, 1, 1, 2, 3, 3, 3, 3, 3]
    for (let offset = 0; offset <= index.text.length; offset += 1) {
      expect(lineIndexAtOffset(index, offset)).toBe(expected[offset])
    }
  })
})

describe('applyEditToDocumentLineIndex', () => {
  function applyAndCheck(text: string, edit: { from: number; to: number; insert: string }) {
    const nextText = text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
    const index = applyEditToDocumentLineIndex(buildDocumentLineIndex(text), nextText, edit)
    expectMatchesFullRebuild(index, nextText)
    return index
  }

  it('handles an insert inside one line', () => {
    applyAndCheck('abc\ndef\nghi', { from: 5, to: 5, insert: 'XY' })
  })

  it('handles a delete inside one line', () => {
    applyAndCheck('abc\ndef\nghi', { from: 5, to: 6, insert: '' })
  })

  it('handles inserting a newline (a line split)', () => {
    applyAndCheck('abc\ndef\nghi', { from: 5, to: 5, insert: '\n' })
  })

  it('handles deleting a newline (a line join)', () => {
    applyAndCheck('abc\ndef\nghi', { from: 3, to: 4, insert: '' })
  })

  it('handles an edit spanning several lines', () => {
    applyAndCheck('a\nb\nc\nd\ne', { from: 2, to: 7, insert: 'ZZ' })
  })

  it('handles an insert containing several newlines', () => {
    applyAndCheck('a\nb', { from: 1, to: 1, insert: '\n1\n2\n3' })
  })

  it('handles edits at the very start and very end', () => {
    applyAndCheck('abc\ndef', { from: 0, to: 0, insert: 'Z\n' })
    applyAndCheck('abc\ndef', { from: 7, to: 7, insert: '\nZ' })
    applyAndCheck('abc\ndef', { from: 0, to: 7, insert: '' })
  })

  it('handles a trailing newline appearing and disappearing', () => {
    applyAndCheck('abc', { from: 3, to: 3, insert: '\n' })
    applyAndCheck('abc\n', { from: 3, to: 4, insert: '' })
  })

  it('rebuilds rather than guessing when there is no previous index', () => {
    const index = applyEditToDocumentLineIndex(null, 'a\nb', { from: 0, to: 0, insert: 'a\nb' })
    expectMatchesFullRebuild(index, 'a\nb')
  })

  it('rebuilds rather than corrupting when the edit does not fit the previous text', () => {
    const previous = buildDocumentLineIndex('short')
    const index = applyEditToDocumentLineIndex(previous, 'whatever', { from: 0, to: 999, insert: 'whatever' })
    expectMatchesFullRebuild(index, 'whatever')
  })

  // The property that matters: the spliced index is indistinguishable from a
  // full rebuild after EVERY step of a long randomized sequence, not just
  // after one edit. Same discipline as PreviewBlockSplit's and
  // MarkdownContext's own fuzz tests -- both of those caches passed careful
  // reasoning and failed against real output.
  for (const seed of [20260907, 1, 424242, 7]) {
    it(`matches a full rebuild after every step of a randomized edit sequence (seed ${seed})`, () => {
      let state = seed
      const random = () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff
        return state / 0x7fffffff
      }
      const fragments = ['a', 'bc', '\n', '\n\n', 'x\ny', 'word ', '', '\nheading\n', 'z']

      let text = 'first line\nsecond line\n\nfourth line\n'
      let index: DocumentLineIndex | null = buildDocumentLineIndex(text)

      for (let step = 0; step < 600; step += 1) {
        const from = Math.floor(random() * (text.length + 1))
        const to = Math.min(text.length, from + Math.floor(random() * 6))
        const insert = fragments[Math.floor(random() * fragments.length)]
        const nextText = text.slice(0, from) + insert + text.slice(to)

        index = applyEditToDocumentLineIndex(index, nextText, { from, to, insert })
        expectMatchesFullRebuild(index, nextText)
        text = nextText
      }
    })
  }
})
