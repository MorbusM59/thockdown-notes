import { describe, expect, it } from 'vitest'
import { increaseHeadingLevels, normalizeChapterHeadings } from './markdownHeadings'

describe('increaseHeadingLevels', () => {
  it('bumps every heading level by one throughout the text', () => {
    const text = '# Title\n\nsome body\n\n## Section\n\nmore body\n\n### Subsection'
    expect(increaseHeadingLevels(text)).toBe(
      '## Title\n\nsome body\n\n### Section\n\nmore body\n\n#### Subsection',
    )
  })

  it('leaves a level-6 heading alone -- ATX headings never go deeper', () => {
    const text = '###### Deepest'
    expect(increaseHeadingLevels(text)).toBe('###### Deepest')
  })

  it('leaves non-heading lines and lines that merely start with a word untouched', () => {
    const text = 'not a #heading\n#neither, no space\nregular text'
    expect(increaseHeadingLevels(text)).toBe(text)
  })

  it('does not touch headings inside a fenced code block', () => {
    const text = 'before\n```\n# looks like a heading but is code\n```\n# real heading'
    expect(increaseHeadingLevels(text)).toBe(
      'before\n```\n# looks like a heading but is code\n```\n## real heading',
    )
  })

  it('handles an empty ATX heading (just the hashes, no text)', () => {
    expect(increaseHeadingLevels('#')).toBe('##')
  })
})

describe('normalizeChapterHeadings', () => {
  it('leaves an already-level-2 first-line heading alone (no-op shift)', () => {
    const text = '## Title\n\nbody\n\n### Sub'
    expect(normalizeChapterHeadings(text)).toBe(text)
  })

  it('forces a level-1 first-line heading down to level 2, shifting every other heading the same amount', () => {
    const text = '# Title\n\nbody\n\n## Sub\n\n### SubSub'
    expect(normalizeChapterHeadings(text)).toBe('## Title\n\nbody\n\n### Sub\n\n#### SubSub')
  })

  it('forces a deep first-line heading up to level 2, shifting every other heading the same amount', () => {
    const text = '#### Title\n\nbody\n\n##### Sub'
    expect(normalizeChapterHeadings(text)).toBe('## Title\n\nbody\n\n### Sub')
  })

  it('inserts "## Unnamed Chapter" and shifts the highest remaining heading to level 3 when the first line is not a heading', () => {
    const text = 'body text\n\n#### Sub\n\n##### SubSub'
    expect(normalizeChapterHeadings(text)).toBe('## Unnamed Chapter\n\nbody text\n\n### Sub\n\n#### SubSub')
  })

  it('inserts "## Unnamed Chapter" with no further shifting when there are no headings at all', () => {
    const text = 'just a paragraph\n\nanother one'
    expect(normalizeChapterHeadings(text)).toBe(`## Unnamed Chapter\n\n${text}`)
  })

  it('handles empty text by producing just the synthetic first line', () => {
    expect(normalizeChapterHeadings('')).toBe('## Unnamed Chapter\n\n')
  })

  it('shifts a highest-level heading that is already deeper than level 3 up (shallower)', () => {
    const text = 'intro\n\n##### Deep\n\n###### Deeper'
    expect(normalizeChapterHeadings(text)).toBe('## Unnamed Chapter\n\nintro\n\n### Deep\n\n#### Deeper')
  })

  it('clamps at level 6 rather than overflowing', () => {
    const text = '# Title\n\n###### AlreadyDeepest'
    expect(normalizeChapterHeadings(text)).toBe('## Title\n\n###### AlreadyDeepest')
  })

  it('does not treat headings inside a fenced code block as the highest heading', () => {
    const text = 'intro\n\n```\n# looks like a heading but is code\n```\n\n#### Real'
    expect(normalizeChapterHeadings(text)).toBe('## Unnamed Chapter\n\nintro\n\n```\n# looks like a heading but is code\n```\n\n### Real')
  })
})
