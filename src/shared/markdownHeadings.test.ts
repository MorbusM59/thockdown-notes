import { describe, expect, it } from 'vitest'
import {
  CHAPTER_HEADLINE_LEVEL_RULE,
  NOTE_HEADLINE_LEVEL_RULE,
  clampHeadlineLevels,
  normalizeChapterHeadings,
  remapOffsetThroughHeadingLevelEdits,
} from './markdownHeadings'

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

describe('clampHeadlineLevels (CHAPTER_HEADLINE_LEVEL_RULE)', () => {
  it('is a no-op on already-valid text (idempotency)', () => {
    const text = '## Title\n\nbody\n\n### Sub\n\n#### SubSub'
    const result = clampHeadlineLevels(text, CHAPTER_HEADLINE_LEVEL_RULE)
    expect(result.text).toBe(text)
    expect(result.edits).toEqual([])
  })

  it('clamps a shallower first-line heading up to level 2', () => {
    const result = clampHeadlineLevels('# Title\n\nbody', CHAPTER_HEADLINE_LEVEL_RULE)
    expect(result.text).toBe('## Title\n\nbody')
    expect(result.edits).toEqual([{ lineStart: 0, markerStart: 0, oldLevel: 1, newLevel: 2 }])
  })

  it('clamps a deeper first-line heading down to level 2', () => {
    const result = clampHeadlineLevels('#### Title\n\nbody', CHAPTER_HEADLINE_LEVEL_RULE)
    expect(result.text).toBe('## Title\n\nbody')
    expect(result.edits).toEqual([{ lineStart: 0, markerStart: 0, oldLevel: 4, newLevel: 2 }])
  })

  it('leaves a non-heading first line alone (does not synthesize a heading there)', () => {
    const text = 'not a heading\n\n### Sub'
    const result = clampHeadlineLevels(text, CHAPTER_HEADLINE_LEVEL_RULE)
    expect(result.text).toBe(text)
    expect(result.edits).toEqual([])
  })

  it('clamps a level-1 or level-2 heading elsewhere in the document up to level 3', () => {
    const text = '## Title\n\n# TooShallow\n\n## AlsoTooShallow'
    const result = clampHeadlineLevels(text, CHAPTER_HEADLINE_LEVEL_RULE)
    expect(result.text).toBe('## Title\n\n### TooShallow\n\n### AlsoTooShallow')
    expect(result.edits.length).toBe(2)
  })

  it('leaves headings already at level 3 or deeper elsewhere untouched', () => {
    const text = '## Title\n\n### Sub\n\n###### Deepest'
    const result = clampHeadlineLevels(text, CHAPTER_HEADLINE_LEVEL_RULE)
    expect(result.text).toBe(text)
    expect(result.edits).toEqual([])
  })

  it('ignores headings inside a fenced code block', () => {
    const text = '## Title\n\n```\n# not a real heading\n```'
    const result = clampHeadlineLevels(text, CHAPTER_HEADLINE_LEVEL_RULE)
    expect(result.text).toBe(text)
    expect(result.edits).toEqual([])
  })

  it('leaves a violating heading alone when it is the exempted skipLineIndex, mid-edit', () => {
    // Simulates backspacing '### Sub' down to '# Sub' one '#' at a time --
    // each intermediate state (here, level 1, well under the level-3 floor)
    // would normally get force-corrected right back, fighting the backspace.
    const text = '## Title\n\n# Sub'
    const result = clampHeadlineLevels(text, CHAPTER_HEADLINE_LEVEL_RULE, 2)
    expect(result.text).toBe(text)
    expect(result.edits).toEqual([])
  })

  it('still exempts the skipped line even down to a bare, textless heading marker', () => {
    const text = '## Title\n\n#'
    const result = clampHeadlineLevels(text, CHAPTER_HEADLINE_LEVEL_RULE, 2)
    expect(result.text).toBe(text)
    expect(result.edits).toEqual([])
  })

  it('corrects the previously-exempted line normally once it is no longer skipped', () => {
    const text = '## Title\n\n# Sub'
    const result = clampHeadlineLevels(text, CHAPTER_HEADLINE_LEVEL_RULE, null)
    expect(result.text).toBe('## Title\n\n### Sub')
    expect(result.edits.length).toBe(1)
  })

  it('exempting one line does not stop other violating lines from being corrected', () => {
    const text = '## Title\n\n# Sub\n\n## AlsoTooShallow'
    const result = clampHeadlineLevels(text, CHAPTER_HEADLINE_LEVEL_RULE, 2)
    expect(result.text).toBe('## Title\n\n# Sub\n\n### AlsoTooShallow')
    expect(result.edits.length).toBe(1)
  })

  it('the exempted first line is left alone even when it violates the level-2 rule', () => {
    const text = '# Title\n\n### Sub'
    const result = clampHeadlineLevels(text, CHAPTER_HEADLINE_LEVEL_RULE, 0)
    expect(result.text).toBe(text)
    expect(result.edits).toEqual([])
  })
})

describe('clampHeadlineLevels (NOTE_HEADLINE_LEVEL_RULE)', () => {
  it('is a no-op on already-valid text (idempotency)', () => {
    const text = '# Title\n\nbody\n\n## Sub\n\n### SubSub'
    const result = clampHeadlineLevels(text, NOTE_HEADLINE_LEVEL_RULE)
    expect(result.text).toBe(text)
    expect(result.edits).toEqual([])
  })

  it('clamps a deeper first-line heading up to level 1', () => {
    const result = clampHeadlineLevels('### Title\n\nbody', NOTE_HEADLINE_LEVEL_RULE)
    expect(result.text).toBe('# Title\n\nbody')
    expect(result.edits).toEqual([{ lineStart: 0, markerStart: 0, oldLevel: 3, newLevel: 1 }])
  })

  it('clamps a level-1 heading elsewhere in the document up to level 2', () => {
    const text = '# Title\n\n# TooShallow'
    const result = clampHeadlineLevels(text, NOTE_HEADLINE_LEVEL_RULE)
    expect(result.text).toBe('# Title\n\n## TooShallow')
    expect(result.edits.length).toBe(1)
  })

  it('leaves headings already at level 2 or deeper elsewhere untouched', () => {
    const text = '# Title\n\n## Sub\n\n###### Deepest'
    const result = clampHeadlineLevels(text, NOTE_HEADLINE_LEVEL_RULE)
    expect(result.text).toBe(text)
    expect(result.edits).toEqual([])
  })

  it('exempts the caret\'s current line, same as the chapter rule does', () => {
    const text = '# Title\n\n# Sub'
    const result = clampHeadlineLevels(text, NOTE_HEADLINE_LEVEL_RULE, 2)
    expect(result.text).toBe(text)
    expect(result.edits).toEqual([])
  })
})

describe('remapOffsetThroughHeadingLevelEdits', () => {
  it('leaves an offset before the marker untouched', () => {
    const { edits } = clampHeadlineLevels('# Title', CHAPTER_HEADLINE_LEVEL_RULE)
    expect(remapOffsetThroughHeadingLevelEdits(0, edits)).toBe(0)
  })

  it('clamps an offset that was inside the old marker into the same relative position in the new one', () => {
    // '# Title' -> '## Title': old marker is just '#' (length 1). Offset 1
    // sits right at the old marker's end (1 char in) -- same convention as
    // useEditorSectionMount.ts's onTabIndentTransform remap: min(relative, newLevel).
    const { edits } = clampHeadlineLevels('# Title', CHAPTER_HEADLINE_LEVEL_RULE)
    expect(remapOffsetThroughHeadingLevelEdits(1, edits)).toBe(1)
  })

  it('shifts an offset after the marker by the level delta', () => {
    // '# Title' -> '## Title', delta = +1. Offset 2 is the space before "Title".
    const { edits } = clampHeadlineLevels('# Title', CHAPTER_HEADLINE_LEVEL_RULE)
    expect(remapOffsetThroughHeadingLevelEdits(2, edits)).toBe(3)
    // Offset at the very end of the line shifts by the same delta.
    expect(remapOffsetThroughHeadingLevelEdits(7, edits)).toBe(8)
  })

  it('shifts an offset by a negative delta when a heading gets shallower', () => {
    // '#### Title' -> '## Title', delta = -2.
    const { edits } = clampHeadlineLevels('#### Title\n\nbody', CHAPTER_HEADLINE_LEVEL_RULE)
    expect(remapOffsetThroughHeadingLevelEdits(10, edits)).toBe(8)
  })

  it('accumulates deltas across multiple corrected lines', () => {
    const text = '# Title\n\n## Sub'
    const { edits } = clampHeadlineLevels(text, CHAPTER_HEADLINE_LEVEL_RULE)
    expect(edits.length).toBe(2)
    // Offset at the very end of the (uncorrected) text.
    const endOffset = text.length
    // First line: '#'->'##' is +1. Second line: '##'->'###' is +1. Total +2.
    expect(remapOffsetThroughHeadingLevelEdits(endOffset, edits)).toBe(endOffset + 2)
  })
})
