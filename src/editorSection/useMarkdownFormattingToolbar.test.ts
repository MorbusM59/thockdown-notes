import { describe, expect, it } from 'vitest'
import { buildTableOfContentsInsertion, removeTableOfContentsAndAnchors } from './useMarkdownFormattingToolbar'

describe('buildTableOfContentsInsertion', () => {
  it('inserts a plain-text outline directly after the title, excluding the title and TOC heading from the list', () => {
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
      '## Table of Contents',
      '',
      '- Planning',
      '  - Flights',
      '- Logistics',
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

  it('never links the list to the headings, or the headings to anything -- repeated labels just repeat in the list', () => {
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

    expect(result.text).not.toContain('](')
    expect((result.text.match(/^- Planning$/gm) ?? []).length).toBe(2)
    expect(result.text).toContain('## Planning\nNeed flights.')
    expect(result.text).toContain('## Planning\nMore details.')
  })

  it('excludes a heading literally titled "Table of Contents" from the generated list', () => {
    const input = '# Travel Notes\n\n## Table of Contents\n\nStray heading.\n\n## Planning\nBody.'
    const result = buildTableOfContentsInsertion(input, {
      anchor: 0, focus: 0, start: 0, end: 0, isCollapsed: true,
    })
    expect((result.text.match(/Table of Contents/g) ?? []).length).toBe(2) // the inserted heading, and the stray one -- neither ever listed
    expect(result.text).not.toContain('- Table of Contents')
  })
})

describe('removeTableOfContentsAndAnchors', () => {
  it('removes the current plain-list TOC block, leaving every heading and the rest of the note untouched', () => {
    const input = [
      '# Travel Notes',
      '',
      '## Table of Contents',
      '',
      '- Planning',
      '  - Flights',
      '- Logistics',
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

  it('migrates a note written before this feature stopped linking -- removes the old linked TOC block and unwraps every anchor-linked heading', () => {
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

  it('leaves a heading\'s own bold/italic/code formatting alone when it was never anchor-wrapped (regression: used to get stripped as a side effect of removing an unrelated TOC block)', () => {
    const input = [
      '# Travel Notes',
      '',
      '## Table of Contents',
      '',
      '- Planning',
      '',
      '## **Planning** is `key`',
      'Need flights.',
      '',
    ].join('\n')

    const result = removeTableOfContentsAndAnchors(input)

    expect(result).toBe([
      '# Travel Notes',
      '',
      '## **Planning** is `key`',
      'Need flights.',
      '',
    ].join('\n'))
  })

  it('is a no-op when the note never had a TOC at all', () => {
    const input = '# Travel Notes\n\n## Planning\nBody.'
    expect(removeTableOfContentsAndAnchors(input)).toBe(input)
  })
})
