import { describe, expect, it } from 'vitest'
import { findAnchorDefinitionLine } from './PreviewMarkdown'

describe('findAnchorDefinitionLine', () => {
  it('returns null when the anchor definition is absent', () => {
    expect(findAnchorDefinitionLine('no anchors here', 'todo')).toBeNull()
  })

  it('resolves a definition on the first line to line 0', () => {
    const text = '[Todo](#todo)\nsome other content'
    expect(findAnchorDefinitionLine(text, 'todo')).toBe(0)
  })

  it('counts newlines before the match to resolve a later line', () => {
    const text = 'line zero\nline one\n[Todo](#todo)\nline three'
    expect(findAnchorDefinitionLine(text, 'todo')).toBe(2)
  })

  it('requires an exact anchor id match, not a prefix', () => {
    const text = '[Todo List](#todo-list)\n[Todo](#todo)'
    expect(findAnchorDefinitionLine(text, 'todo')).toBe(1)
  })
})
