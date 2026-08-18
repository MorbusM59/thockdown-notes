import { describe, expect, it } from 'vitest'
import {
  assembleOpenItemsText,
  buildOpenItemsGroupMarkdown,
  checklistStateChanged,
  collectUncheckedItemsByHeading,
  extractChecklistCheckedStates,
  findOpenItemSourceAtLine,
  parseOpenItemsGroups,
  toggleChecklistItemByText,
  toggleChecklistLineMark,
} from './openItemsText'

describe('extractChecklistCheckedStates', () => {
  it('extracts checked/unchecked states in document order, ignoring non-checklist lines', () => {
    const text = '# Title\n\n- [ ] first\n- not a checklist item\n- [x] second\n  - [X] third (nested)\n'
    expect(extractChecklistCheckedStates(text)).toEqual([false, true, true])
  })

  it('returns an empty array when there are no checklist lines', () => {
    expect(extractChecklistCheckedStates('# Title\n\nJust prose.')).toEqual([])
  })
})

describe('checklistStateChanged', () => {
  it('is false when nothing about the checklist changed, even if other text did', () => {
    const before = '# Title\n\n- [ ] task\n\nSome prose.'
    const after = '# Title\n\n- [ ] task\n\nSome different prose.'
    expect(checklistStateChanged(before, after)).toBe(false)
  })

  it('is false when only an unchecked item\'s own wording changed (deliberate boundary, not a bug)', () => {
    const before = '- [ ] buy milk'
    const after = '- [ ] buy oat milk'
    expect(checklistStateChanged(before, after)).toBe(false)
  })

  it('is true when a new checklist item is created', () => {
    const before = '- [ ] one'
    const after = '- [ ] one\n- [ ] two'
    expect(checklistStateChanged(before, after)).toBe(true)
  })

  it('is true when an item is removed', () => {
    const before = '- [ ] one\n- [ ] two'
    const after = '- [ ] one'
    expect(checklistStateChanged(before, after)).toBe(true)
  })

  it('is true when an existing item\'s checked state flips', () => {
    const before = '- [ ] one\n- [ ] two'
    const after = '- [ ] one\n- [x] two'
    expect(checklistStateChanged(before, after)).toBe(true)
  })
})

describe('collectUncheckedItemsByHeading', () => {
  it('attributes each unchecked item to the nearest preceding heading (plain, never-anchored source), dropping checked items and empty buckets', () => {
    const text = [
      '# Title',
      '',
      '- [ ] before any heading',
      '',
      '## Setting',
      '',
      '- [x] already done, skipped',
      '- [ ] world-building task',
      '',
      '## Empty Section',
      '',
      'Nothing to do here.',
      '',
      '## Plot',
      '',
      '- [ ] resolve the ending',
      '- [ ] fix the middle',
    ].join('\n')

    const buckets = collectUncheckedItemsByHeading(text)
    expect(buckets).toEqual([
      { anchorId: null, label: null, items: ['before any heading', 'world-building task', 'resolve the ending', 'fix the middle'] },
    ])
  })

  it('tolerates already-anchored H2 headings by ignoring them as nested buckets', () => {
    const text = '# Title\n\n## [Setting](#setting)\n\n- [ ] world-building task'
    expect(collectUncheckedItemsByHeading(text)).toEqual([
      { anchorId: null, label: null, items: ['world-building task'] },
    ])
  })

  it('ignores H2 section headings so their unchecked items stay directly under the title', () => {
    const text = [
      '# Title',
      '',
      '## Setting',
      '',
      '- [ ] world-building task',
      '',
      '- [ ] another task',
    ].join('\n')

    expect(collectUncheckedItemsByHeading(text)).toEqual([
      { anchorId: null, label: null, items: ['world-building task', 'another task'] },
    ])
  })

  it('keeps deeper headings as nested buckets when they are below the title', () => {
    const text = '# Title\n\n### Setting\n\n- [ ] world-building task'
    expect(collectUncheckedItemsByHeading(text)).toEqual([
      { anchorId: 'setting', label: 'Setting', items: ['world-building task'] },
    ])
  })

  it('returns an empty array when there are no unchecked items anywhere', () => {
    const text = '# Title\n\n## Setting\n\n- [x] done'
    expect(collectUncheckedItemsByHeading(text)).toEqual([])
  })

  it('ignores checklist-looking lines inside fenced code blocks', () => {
    const text = '# Title\n\n```\n- [ ] not real\n```\n\n- [ ] real one'
    expect(collectUncheckedItemsByHeading(text)).toEqual([
      { anchorId: null, label: null, items: ['real one'] },
    ])
  })
})

describe('buildOpenItemsGroupMarkdown', () => {
  it('builds a title link plus nested heading links for deeper H3+ headings while ignoring H2 section headings', () => {
    const text = '# Chapter One\n\n### Setting\n\n- [ ] world-building task'
    const markdown = buildOpenItemsGroupMarkdown(text, '$BOOK§ch1', 'Chapter One')
    expect(markdown).toBe([
      '- [Chapter One]($BOOK§ch1)',
      '  - [Setting]($BOOK§ch1#heading:setting)',
      '    - [ ] world-building task',
    ].join('\n'))
  })

  it('keeps H2-only bucket items directly under the title link instead of creating a duplicate nested title node', () => {
    const text = '# Chapter One\n\n## Setting\n\n- [ ] world-building task'
    const markdown = buildOpenItemsGroupMarkdown(text, '$BOOK§ch1', 'Chapter One')
    expect(markdown).toBe([
      '- [Chapter One]($BOOK§ch1)',
      '  - [ ] world-building task',
    ].join('\n'))
  })

  it('returns null when the note has no unchecked items', () => {
    expect(buildOpenItemsGroupMarkdown('# Title\n\n- [x] done', '$BOOK', 'Title')).toBeNull()
  })

  it('places headless items directly under the title link, one level shallower than headed ones', () => {
    const text = '# Title\n\n- [ ] headless task'
    expect(buildOpenItemsGroupMarkdown(text, '$BOOK', 'Title')).toBe('- [Title]($BOOK)\n  - [ ] headless task')
  })
})

describe('parseOpenItemsGroups / assembleOpenItemsText round trip', () => {
  it('reassembles exactly what was parsed, preserving order and content', () => {
    const groups = [
      { noteId: 'parent-1', markdown: '- [Book]($BOOK)\n  - [ ] intro task' },
      { noteId: 'chapter-1', markdown: '- [Chapter One]($BOOK§ch1)\n  - [ ] a task' },
    ]
    const assembled = assembleOpenItemsText(groups)
    expect(assembled).not.toBeNull()
    expect(parseOpenItemsGroups(assembled!)).toEqual(groups)
  })

  it('returns null for an empty group list', () => {
    expect(assembleOpenItemsText([])).toBeNull()
  })

  it('parses zero groups back out of a null-assembled (never-written) text', () => {
    expect(parseOpenItemsGroups('# Open Items\n')).toEqual([])
  })
})

describe('findOpenItemSourceAtLine', () => {
  const parentMarkdown = buildOpenItemsGroupMarkdown('# The Book\n\n- [ ] intro task', '@parent-1', 'The Book')!
  const chapterMarkdown = buildOpenItemsGroupMarkdown('# Chapter One\n\n## Setting\n\n- [ ] world-building task', '@chapter-1', 'Chapter One')!
  const text = assembleOpenItemsText([
    { noteId: 'parent-1', markdown: parentMarkdown },
    { noteId: 'chapter-1', markdown: chapterMarkdown },
  ])!
  const lines = text.split('\n')

  it("resolves a headless item's line to its own group noteId and item text", () => {
    const lineIndex = lines.indexOf('  - [ ] intro task')
    expect(findOpenItemSourceAtLine(text, lineIndex)).toEqual({ noteId: 'parent-1', itemText: 'intro task' })
  })

  it("resolves a deeper headed item's line to its own group noteId (a later group in the same document), not an earlier one", () => {
    const lineIndex = lines.indexOf('    - [ ] world-building task')
    expect(findOpenItemSourceAtLine(text, lineIndex)).toEqual({ noteId: 'chapter-1', itemText: 'world-building task' })
  })

  it('returns null for a non-checklist line (the marker or a heading-link line)', () => {
    expect(findOpenItemSourceAtLine(text, lines.indexOf('[open-items-group:parent-1]'))).toBeNull()
    expect(findOpenItemSourceAtLine(text, lines.indexOf('- [Chapter One](@chapter-1)'))).toBeNull()
  })

  it('returns null for an out-of-range line index', () => {
    expect(findOpenItemSourceAtLine(text, -1)).toBeNull()
    expect(findOpenItemSourceAtLine(text, lines.length)).toBeNull()
  })
})

describe('toggleChecklistLineMark', () => {
  it('flips an unchecked item to checked, preserving indentation and item text exactly', () => {
    expect(toggleChecklistLineMark('    - [ ] world-building task')).toBe('    - [x] world-building task')
  })

  it('flips a checked item back to unchecked, tolerating an uppercase X', () => {
    expect(toggleChecklistLineMark('- [X] done already')).toBe('- [ ] done already')
  })

  it('preserves a blockquote prefix and a non-hyphen list marker', () => {
    expect(toggleChecklistLineMark('> * [ ] quoted task')).toBe('> * [x] quoted task')
  })

  it('returns null for a line that is not a checklist item at all', () => {
    expect(toggleChecklistLineMark('- just a bullet, no checkbox')).toBeNull()
  })
})

describe('toggleChecklistItemByText', () => {
  it("flips the first checklist line whose own item text matches, regardless of its current checked state", () => {
    const source = '# Chapter One\n\n- [ ] buy milk\n- [ ] buy eggs'
    expect(toggleChecklistItemByText(source, 'buy eggs')).toBe('# Chapter One\n\n- [ ] buy milk\n- [x] buy eggs')
  })

  it('round-trips: toggling the same item text twice restores the original line', () => {
    const source = '- [ ] buy milk'
    const once = toggleChecklistItemByText(source, 'buy milk')!
    expect(toggleChecklistItemByText(once, 'buy milk')).toBe(source)
  })

  it('returns null when no checklist line matches the given item text', () => {
    expect(toggleChecklistItemByText('- [ ] buy milk', 'buy eggs')).toBeNull()
  })
})
