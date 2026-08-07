import { describe, expect, it } from 'vitest'
import { increaseHeadingLevels } from './markdownHeadings'

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
