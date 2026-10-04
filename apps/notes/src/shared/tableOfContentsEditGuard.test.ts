import { describe, expect, it } from 'vitest'
import { editCouldChangeTableOfContents } from './tableOfContentsEditGuard'

function applyEdit(text: string, edit: { from: number; to: number; insert: string }): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
}

function check(text: string, edit: { from: number; to: number; insert: string }): boolean {
  return editCouldChangeTableOfContents(text, applyEdit(text, edit), edit)
}

const DOC = [
  '## Table of Contents',
  '',
  '- [Alpha](#alpha)',
  '',
  '## Alpha',
  '',
  'Some prose in the alpha section.',
  '- a list item',
  '',
  '## Beta',
  'More prose.',
].join('\n')

describe('editCouldChangeTableOfContents', () => {
  it('says no for ordinary prose edits', () => {
    const at = DOC.indexOf('Some prose')
    expect(check(DOC, { from: at, to: at, insert: 'X' })).toBe(false)
    expect(check(DOC, { from: at, to: at + 4, insert: '' })).toBe(false)
  })

  it('says no for edits to a list item', () => {
    const at = DOC.indexOf('- a list item') + 5
    expect(check(DOC, { from: at, to: at, insert: 'more ' })).toBe(false)
  })

  it('says yes when a heading is edited', () => {
    const at = DOC.indexOf('## Alpha') + 4
    expect(check(DOC, { from: at, to: at, insert: 'X' })).toBe(true)
  })

  it('says yes when a plain line becomes a heading', () => {
    const at = DOC.indexOf('More prose.')
    expect(check(DOC, { from: at, to: at, insert: '## ' })).toBe(true)
  })

  it('says yes when a heading marker is deleted', () => {
    const at = DOC.indexOf('## Beta')
    expect(check(DOC, { from: at, to: at + 3, insert: '' })).toBe(true)
  })

  it('says yes when the table-of-contents heading itself is touched', () => {
    const at = DOC.indexOf('## Table of Contents') + 3
    expect(check(DOC, { from: at, to: at, insert: 'x' })).toBe(true)
  })

  it('says yes for a multi-line edit that spans a heading', () => {
    const from = DOC.indexOf('Some prose')
    const to = DOC.indexOf('More prose.')
    expect(check(DOC, { from, to, insert: 'replaced' })).toBe(true)
  })

  it('says yes when a newline is inserted immediately before a heading', () => {
    const at = DOC.indexOf('## Beta')
    expect(check(DOC, { from: at, to: at, insert: '\n' })).toBe(true)
  })

  /**
   * The failure that matters is a MISSED regeneration -- the guard saying "no
   * change" when the set of heading lines actually did change. Anything else
   * costs only a redundant pass. So the property is checked directly against
   * ground truth: the note's heading lines, before and after, compared for
   * real.
   */
  it('never says no when the document heading lines actually changed', () => {
    const headingLines = (text: string) =>
      text.split('\n').filter((line) => /^[ ]{0,3}#{1,6}(?:\s|$)/.test(line)).join(' ')

    let state = 20260907
    const random = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }
    const fragments = ['a', '#', '##', '## ', '###', '\n', '\n## New heading', ' ', 'word ', '', '#\n', '\n\n']

    let text = DOC
    for (let step = 0; step < 3000; step += 1) {
      const from = Math.floor(random() * (text.length + 1))
      const to = Math.min(text.length, from + Math.floor(random() * 8))
      const insert = fragments[Math.floor(random() * fragments.length)]
      const edit = { from, to, insert }
      const nextText = applyEdit(text, edit)

      const headingsChanged = headingLines(text) !== headingLines(nextText)
      if (headingsChanged) {
        expect(
          editCouldChangeTableOfContents(text, nextText, edit),
          `missed a heading change at step ${step}`,
        ).toBe(true)
      }

      text = nextText
      if (text.length > 4000) text = DOC
    }
  })
})
