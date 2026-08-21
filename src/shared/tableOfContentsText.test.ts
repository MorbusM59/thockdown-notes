import { describe, expect, it } from 'vitest'
import {
  computeHeadingAnchors,
  findHeadingAnchorLine,
  formatHeadingAnchorFragment,
  formatOutlineEntryLine,
  formatOutlineRootTitleLine,
  headingsChanged,
  parseHeadingAnchorFragment,
} from './tableOfContentsText'

describe('formatOutlineEntryLine', () => {
  it('builds a plain [label](href) link at the given indent depth', () => {
    expect(formatOutlineEntryLine(0, 'Chapter One', '@ch1')).toBe('- [Chapter One](@ch1)')
    expect(formatOutlineEntryLine(2, 'Setting', '@ch1#heading:setting')).toBe('    - [Setting](@ch1#heading:setting)')
  })

  it('falls back to plain non-clickable text when href is null', () => {
    expect(formatOutlineEntryLine(0, 'Untitled', null)).toBe('- Untitled')
  })

  it('escapes literal [ and ] in the label so they can\'t break out of the link\'s own bracket span', () => {
    expect(formatOutlineEntryLine(0, 'Fix bug [WIP]', '@ch1')).toBe('- [Fix bug \\[WIP\\]](@ch1)')
  })
})

describe('formatOutlineRootTitleLine', () => {
  it('bolds a [label](href) link with no bullet or indent, unlike formatOutlineEntryLine', () => {
    expect(formatOutlineRootTitleLine('The Book', '@parent')).toBe('**[The Book](@parent)**')
  })

  it('falls back to plain bold text when href is null', () => {
    expect(formatOutlineRootTitleLine('Untitled', null)).toBe('**Untitled**')
  })

  it('escapes literal [ and ] in the label the same way formatOutlineEntryLine does', () => {
    expect(formatOutlineRootTitleLine('Fix bug [WIP]', '@parent')).toBe('**[Fix bug \\[WIP\\]](@parent)**')
  })
})

describe('headingsChanged', () => {
  it('is false when nothing changed', () => {
    const text = '# Title\n\n## Section One\n\nbody\n\n## Section Two'
    expect(headingsChanged(text, text)).toBe(false)
  })

  it('is false for a change that touches only non-heading text', () => {
    const oldText = '## Section\n\nold body'
    const newText = '## Section\n\nnew body, totally different'
    expect(headingsChanged(oldText, newText)).toBe(false)
  })

  it('is true when a heading is added', () => {
    const oldText = '## Section One'
    const newText = '## Section One\n\n## Section Two'
    expect(headingsChanged(oldText, newText)).toBe(true)
  })

  it('is true when a heading is removed', () => {
    const oldText = '## Section One\n\n## Section Two'
    const newText = '## Section One'
    expect(headingsChanged(oldText, newText)).toBe(true)
  })

  it('is true when a heading is relabeled', () => {
    const oldText = '## Old Label'
    const newText = '## New Label'
    expect(headingsChanged(oldText, newText)).toBe(true)
  })

  it('is true when a heading changes level', () => {
    const oldText = '## Section'
    const newText = '### Section'
    expect(headingsChanged(oldText, newText)).toBe(true)
  })

  it('ignores headings inside fenced code blocks on both sides', () => {
    const oldText = 'intro\n\n```\n# not a real heading\n```\n\n## Real'
    const newText = 'intro\n\n```\n# still not a real heading, edited\n```\n\n## Real'
    expect(headingsChanged(oldText, newText)).toBe(false)
  })
})

describe('computeHeadingAnchors', () => {
  it('derives a dedupe-suffixed anchor id for a repeated label, plus each heading\'s own source line, without rewriting anything', () => {
    const text = '# Title\n\n## Setting\n\nbody\n\n## Setting'
    const anchors = computeHeadingAnchors(text)
    expect(anchors).toEqual([
      { level: 2, label: 'Setting', anchorId: 'setting', lineIndex: 2 },
      { level: 2, label: 'Setting', anchorId: 'setting-1', lineIndex: 6 },
    ])
    expect(text).toBe('# Title\n\n## Setting\n\nbody\n\n## Setting') // unchanged -- never rewrites source
  })

  it('excludes the first H1 (the note\'s own title)', () => {
    expect(computeHeadingAnchors('# Title\n\nbody')).toEqual([])
  })

  it('correctly re-derives the anchor id of a heading that already looks manually anchor-linked', () => {
    const text = '# Title\n\n## [Setting](#setting)'
    expect(computeHeadingAnchors(text)).toEqual([{ level: 2, label: 'Setting', anchorId: 'setting', lineIndex: 2 }])
  })

  it('ignores headings inside fenced code blocks', () => {
    expect(computeHeadingAnchors('# Title\n\n```\n# not a real heading\n```')).toEqual([])
  })
})

describe('findHeadingAnchorLine', () => {
  it('finds the source line of the heading whose derived id matches', () => {
    const text = '# Title\n\nintro\n\n## Setting\n\nbody'
    expect(findHeadingAnchorLine(text, 'setting')).toBe(4)
  })

  it('returns null when no heading derives that id', () => {
    expect(findHeadingAnchorLine('# Title\n\n## Setting', 'plot')).toBeNull()
  })
})

describe('formatHeadingAnchorFragment / parseHeadingAnchorFragment', () => {
  it('round-trips a plain anchor id through the heading-anchor fragment format', () => {
    const fragment = formatHeadingAnchorFragment('setting')
    expect(fragment).toBe('heading:setting')
    expect(parseHeadingAnchorFragment(fragment)).toBe('setting')
  })

  it('returns null for a fragment that is not a heading-anchor one (a manual anchor id)', () => {
    expect(parseHeadingAnchorFragment('setting')).toBeNull()
  })
})
