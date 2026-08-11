import { describe, expect, it } from 'vitest'
import { buildTableOfContentsInsertion } from './useMarkdownFormattingToolbar'

describe('buildTableOfContentsInsertion', () => {
  it('inserts a TOC directly after the title and excludes the title and TOC heading from the list', () => {
    const input = [
      '# Travel Notes',
      '',
      '## Planning',
      'Need flights.',
      '',
      '### Flights',
      'Book early.',
      '',
      '## Logistics',
      'Hotel and train.',
      '',
    ].join('\n')

    const result = buildTableOfContentsInsertion(input, {
      anchor: 0,
      focus: 0,
      start: 0,
      end: 0,
      isCollapsed: true,
    })

    expect(result.text).toBe([
      '# [Travel Notes](#travel-notes)',
      '',
      '## [Table of Contents](#table-of-contents)',
      '',
      '- [Planning]($#planning)',
      '  - [Flights]($#flights)',
      '- [Logistics]($#logistics)',
      '',
      '## [Planning](#planning)',
      'Need flights.',
      '',
      '### [Flights](#flights)',
      'Book early.',
      '',
      '## [Logistics](#logistics)',
      'Hotel and train.',
      '',
    ].join('\n'))
  })
})
