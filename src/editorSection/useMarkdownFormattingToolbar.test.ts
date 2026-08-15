import { describe, expect, it } from 'vitest'
import { buildTableOfContentsInsertion, removeTableOfContentsAndAnchors } from './useMarkdownFormattingToolbar'
import { CHAPTER_HEADLINE_LEVEL_RULE } from '../shared/markdownHeadings'

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

// Regression coverage for the chapter/TOC-button collision: a chapter's own
// title is forced to level 2 by useHeadlineLevelGuard.ts's
// CHAPTER_HEADLINE_LEVEL_RULE, and every OTHER heading (including a
// generated TOC block) must be level 3 or deeper -- so on a chapter, this
// feature has to build/recognize a `### Table of Contents` block, not the
// regular note's hardcoded `##`, or the guard immediately reclamps it out
// from under the toolbar on the very next render (the button would then
// never recognize its own output as active, so it could never be toggled
// off, and every click would insert yet another orphaned block).
describe('buildTableOfContentsInsertion / removeTableOfContentsAndAnchors on a chapter (CHAPTER_HEADLINE_LEVEL_RULE)', () => {
  const { firstLineLevel: titleLevel, minOtherLevel: tocLevel } = CHAPTER_HEADLINE_LEVEL_RULE

  it('inserts a level-3 TOC block right after the chapter\'s own level-2 title, matching the guard\'s own invariant', () => {
    const input = [
      '## Arrival',
      '',
      '### Setting',
      'World-building.',
      '',
      '### Logistics',
      'Hotel and train.',
      '',
    ].join('\n')

    const result = buildTableOfContentsInsertion(input, {
      anchor: 0, focus: 0, start: 0, end: 0, isCollapsed: true,
    }, titleLevel, tocLevel)

    expect(result.text).toBe([
      '## Arrival',
      '',
      '### Table of Contents',
      '',
      '- Setting',
      '- Logistics',
      '',
      '### Setting',
      'World-building.',
      '',
      '### Logistics',
      'Hotel and train.',
      '',
    ].join('\n'))
  })

  it('does not mistake the chapter\'s own level-2 title for a stray TOC heading (title detection is level-aware, not "first heading of any level")', () => {
    const input = '## Table of Contents\n\nThis chapter is actually just named that.\n\n### Real Heading\nBody.'
    const result = buildTableOfContentsInsertion(input, {
      anchor: 0, focus: 0, start: 0, end: 0, isCollapsed: true,
    }, titleLevel, tocLevel)

    // The chapter's own title (level 2) is never listed or duplicated --
    // only the inserted level-3 block and the one real level-3 heading below it.
    expect(result.text).toBe([
      '## Table of Contents',
      '',
      '### Table of Contents',
      '',
      '- Real Heading',
      '',
      'This chapter is actually just named that.',
      '',
      '### Real Heading',
      'Body.',
    ].join('\n'))
  })

  it('recognizes and removes a level-3 TOC block, leaving the level-2 chapter title untouched', () => {
    const input = [
      '## Arrival',
      '',
      '### Table of Contents',
      '',
      '- Setting',
      '',
      '### Setting',
      'World-building.',
      '',
    ].join('\n')

    const result = removeTableOfContentsAndAnchors(input, tocLevel)

    expect(result).toBe([
      '## Arrival',
      '',
      '### Setting',
      'World-building.',
      '',
    ].join('\n'))
  })

  it('a regular note\'s level-2 TOC block is NOT recognized against the chapter\'s level-3 rule (and vice versa) -- the level has to match, not just the heading text', () => {
    const chapterText = '## Arrival\n\n## Table of Contents\n\n- Setting\n\n### Setting\nBody.'
    // The TOC block here is level 2, but this chapter's own invariant
    // requires level 3 -- so it must NOT be recognized as this feature's
    // own block (it's indistinguishable from a heading the user happened
    // to title "Table of Contents" at the wrong level).
    expect(removeTableOfContentsAndAnchors(chapterText, tocLevel)).toBe(chapterText)
  })
})
