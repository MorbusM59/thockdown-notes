import { describe, expect, it } from 'vitest'
import { collapseSurgerySite, trimBlankLines } from './chapterExtraction'

describe('collapseSurgerySite', () => {
  it('collapses a blank line on both sides down to a single blank line', () => {
    // "Paragraph A\n\nParagraph B\n\nParagraph C" with "Paragraph B" cut out.
    const before = 'Paragraph A\n\n'
    const after = '\n\nParagraph C'
    const { text, seamPos } = collapseSurgerySite(before, after)
    expect(text).toBe('Paragraph A\n\nParagraph C')
    expect(text.slice(0, seamPos)).toBe('Paragraph A\n\n')
  })

  it('leaves a single pre-existing blank line untouched', () => {
    const before = 'Paragraph A\n\n'
    const after = 'Paragraph C'
    const { text } = collapseSurgerySite(before, after)
    expect(text).toBe('Paragraph A\n\nParagraph C')
  })

  it('does not invent a separator when the cut was mid-paragraph', () => {
    const before = 'Hello '
    const after = 'world'
    const { text, seamPos } = collapseSurgerySite(before, after)
    expect(text).toBe('Hello world')
    expect(seamPos).toBe('Hello '.length)
  })

  it('drops trailing blank lines when cutting to the very end of the document', () => {
    const before = 'Paragraph A\n\n'
    const after = ''
    const { text, seamPos } = collapseSurgerySite(before, after)
    expect(text).toBe('Paragraph A')
    expect(seamPos).toBe(text.length)
  })

  it('drops leading blank lines when cutting from the very start of the document', () => {
    const before = ''
    const after = '\n\nParagraph C'
    const { text, seamPos } = collapseSurgerySite(before, after)
    expect(text).toBe('Paragraph C')
    expect(seamPos).toBe(0)
  })

  it('collapses a lopsided run of extra blank lines down to one', () => {
    const before = 'Paragraph A\n\n\n\n'
    const after = 'Paragraph C'
    const { text } = collapseSurgerySite(before, after)
    expect(text).toBe('Paragraph A\n\nParagraph C')
  })

  it('collapsing an empty selection (both sides empty) yields an empty result', () => {
    const { text, seamPos } = collapseSurgerySite('', '')
    expect(text).toBe('')
    expect(seamPos).toBe(0)
  })
})

describe('trimBlankLines', () => {
  it('strips leading and trailing blank lines swept up in the selection', () => {
    expect(trimBlankLines('\n\nParagraph B\n\n')).toBe('Paragraph B')
  })

  it('strips only a leading run', () => {
    expect(trimBlankLines('\n\nParagraph B')).toBe('Paragraph B')
  })

  it('strips only a trailing run', () => {
    expect(trimBlankLines('Paragraph B\n\n')).toBe('Paragraph B')
  })

  it('leaves internal blank lines (multi-paragraph extraction) untouched', () => {
    expect(trimBlankLines('\nParagraph B\n\nParagraph C\n')).toBe('Paragraph B\n\nParagraph C')
  })

  it('is a no-op when there are no surrounding blank lines', () => {
    expect(trimBlankLines('Paragraph B')).toBe('Paragraph B')
  })

  it('reduces an all-blank-lines selection to an empty string', () => {
    expect(trimBlankLines('\n\n\n')).toBe('')
  })
})
