import { describe, expect, it } from 'vitest'
import { buildTableOfContentsInsertion, removeTableOfContentsAndAnchors } from './useMarkdownFormattingToolbar'

describe('buildTableOfContentsInsertion', () => {
  it('deduplicates repeated headings by appending an incrementing suffix', () => {
    const input = [
      '# Travel Notes',
      '',
      '## Planning',
      'Need flights.',
      '',
      '## Planning',
      'More details.',
      '',
    ].join('\n')

    const result = buildTableOfContentsInsertion(input, {
      anchor: 0,
      focus: 0,
      start: 0,
      end: 0,
      isCollapsed: true,
    })

    expect(result.text).toContain('## [Planning](#planning)')
    expect(result.text).toContain('## [Planning](#planning-1)')
    expect(result.text).toContain('- [Planning]($#planning)')
    expect(result.text).toContain('- [Planning]($#planning-1)')
  })

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
      '# Travel Notes',
      '',
      '## [Table of Contents](#toc)',
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

  it('removes the generated TOC block and heading anchors while leaving the title intact', () => {
    const input = [
      '# Travel Notes',
      '',
      '## [Table of Contents](#toc)',
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
    ].join('\n')

    const result = removeTableOfContentsAndAnchors(input)

    expect(result).toBe([
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
    ].join('\n'))
  })
})
