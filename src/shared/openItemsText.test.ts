import { describe, expect, it } from 'vitest'
import {
  assembleOpenItemsText,
  buildOpenItemsGroupMarkdown,
  checklistStateChanged,
  collectUncheckedItemsByHeading,
  extractChecklistCheckedStates,
  parseOpenItemsGroups,
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
  it('attributes each unchecked item to the nearest preceding anchored heading, dropping checked items and empty buckets', () => {
    const text = [
      '# Title',
      '',
      '- [ ] before any heading',
      '',
      '## [Setting](#setting)',
      '',
      '- [x] already done, skipped',
      '- [ ] world-building task',
      '',
      '## [Empty Section](#empty-section)',
      '',
      'Nothing to do here.',
      '',
      '## [Plot](#plot)',
      '',
      '- [ ] resolve the ending',
      '- [ ] fix the middle',
    ].join('\n')

    const buckets = collectUncheckedItemsByHeading(text)
    expect(buckets).toEqual([
      { anchorId: null, label: null, items: ['before any heading'] },
      { anchorId: 'setting', label: 'Setting', items: ['world-building task'] },
      { anchorId: 'plot', label: 'Plot', items: ['resolve the ending', 'fix the middle'] },
    ])
  })

  it('returns an empty array when there are no unchecked items anywhere', () => {
    const text = '# Title\n\n## [Setting](#setting)\n\n- [x] done'
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
  it('builds a title link plus nested heading links and plain item text, never minting new anchors', () => {
    const text = '# Chapter One\n\n## [Setting](#setting)\n\n- [ ] world-building task'
    const markdown = buildOpenItemsGroupMarkdown(text, '$BOOK§ch1', 'Chapter One')
    expect(markdown).toBe([
      '- [Chapter One]($BOOK§ch1)',
      '  - [Setting]($BOOK§ch1#setting)',
      '    - [ ] world-building task',
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
