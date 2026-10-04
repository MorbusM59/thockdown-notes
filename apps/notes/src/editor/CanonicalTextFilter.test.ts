import { describe, expect, it } from 'vitest'
import { Annotation, EditorState, Transaction } from '@codemirror/state'
import { createCanonicalTextFilter } from './CanonicalTextFilter'
import { isCanonicalInternalText, normalizeInternalText } from './TextPolicy'

const HydrationAnnotation = Annotation.define<true>()

function createState(doc = ''): EditorState {
  return EditorState.create({ doc, extensions: [createCanonicalTextFilter(HydrationAnnotation)] })
}

describe('isCanonicalInternalText', () => {
  const cases = [
    '',
    'plain',
    'a\nb\nc',
    '   indented',
    'trailing\n',
  ]
  for (const text of cases) {
    it(`accepts canonical text ${JSON.stringify(text)}`, () => {
      expect(isCanonicalInternalText(text)).toBe(true)
    })
  }

  const nonCanonical = ['a\r\nb', 'a\rb', 'a\tb', 'a b', 'a b', '﻿a']
  for (const text of nonCanonical) {
    it(`rejects non-canonical text ${JSON.stringify(text)}`, () => {
      expect(isCanonicalInternalText(text)).toBe(false)
    })
  }

  it('agrees with normalizeInternalText on what counts as canonical', () => {
    const samples = [...cases, ...nonCanonical, 'mixed\ttext\r\nhere', '﻿\tboth']
    for (const text of samples) {
      expect(isCanonicalInternalText(text)).toBe(normalizeInternalText(text) === text)
    }
  })

  it('treats a BOM as non-canonical wherever it stands', () => {
    // A BOM is a zero-width character, so the single-cell rule removes it
    // anywhere -- it used to be stripped only at the start of the text.
    expect(isCanonicalInternalText('﻿a')).toBe(false)
    expect(isCanonicalInternalText('a﻿b')).toBe(false)
    expect(normalizeInternalText('a﻿b')).toBe('ab')
  })
})

describe('createCanonicalTextFilter', () => {
  it('leaves a canonical insertion untouched', () => {
    const state = createState('hello')
    const next = state.update({ changes: { from: 5, insert: ' world' } }).state
    expect(next.doc.toString()).toBe('hello world')
  })

  it('normalizes CRLF, CR, tabs and separators arriving through any transaction', () => {
    const state = createState('')
    const next = state.update({ changes: { from: 0, insert: 'a\r\nb\rc\td e' } }).state
    expect(next.doc.toString()).toBe('a\nb\nc   d\ne')
    expect(isCanonicalInternalText(next.doc.toString())).toBe(true)
  })

  it('strips a BOM inserted at the start of the document', () => {
    const state = createState('')
    const next = state.update({ changes: { from: 0, insert: '﻿hello' } }).state
    expect(next.doc.toString()).toBe('hello')
  })

  it('places the caret after the normalized insert, not the raw one', () => {
    const state = createState('xy')
    // Raw insert is 2 chars; normalized is 6 ('\t' -> three spaces, twice).
    const tr = state.update({ changes: { from: 1, insert: '\t\t' }, selection: { anchor: 3 } })
    expect(tr.state.doc.toString()).toBe('x      y')
    expect(tr.state.selection.main.head).toBe(7)
  })

  it('normalizes every range of a multi-range transaction and keeps them aligned', () => {
    const state = createState('abcdef')
    const next = state.update({
      changes: [
        { from: 1, to: 2, insert: '\t' },
        { from: 4, to: 5, insert: '\r\n' },
      ],
    }).state
    expect(next.doc.toString()).toBe('a   cd\nf')
  })

  it('forwards the userEvent annotation through a rewrite', () => {
    const state = createState('')
    const tr = state.update({ changes: { from: 0, insert: '\ttabbed' }, userEvent: 'input.drop' })
    expect(tr.annotation(Transaction.userEvent)).toBe('input.drop')
    expect(tr.state.doc.toString()).toBe('   tabbed')
  })

  it('forwards the hydration annotation through a rewrite', () => {
    const state = createState('')
    const tr = state.update({
      changes: { from: 0, insert: 'a\rb' },
      annotations: HydrationAnnotation.of(true),
    })
    expect(tr.annotation(HydrationAnnotation)).toBe(true)
    expect(tr.state.doc.toString()).toBe('a\nb')
  })

  it('leaves a pure selection change alone', () => {
    const state = createState('hello')
    const next = state.update({ selection: { anchor: 3 } }).state
    expect(next.doc.toString()).toBe('hello')
    expect(next.selection.main.head).toBe(3)
  })

  it('keeps the document canonical across a randomized sequence of inserts and deletes', () => {
    // Ground-truth fuzz rather than reasoning, per this codebase's rule for
    // anything that rewrites text on the way in.
    const fragments = ['a', 'b\n', '\t', '\r\n', 'x y', '﻿', 'word ', '', '\r']
    let seed = 20260907
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    let state = createState('')
    for (let step = 0; step < 400; step += 1) {
      const length = state.doc.length
      const from = Math.floor(random() * (length + 1))
      const to = Math.min(length, from + Math.floor(random() * 3))
      const insert = fragments[Math.floor(random() * fragments.length)]
      state = state.update({ changes: { from, to, insert } }).state
      expect(isCanonicalInternalText(state.doc.toString())).toBe(true)
    }
    expect(state.doc.length).toBeGreaterThan(0)
  })
})
