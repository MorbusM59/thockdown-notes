import { describe, expect, it } from 'vitest'
import type { EditorSelectionState } from './EditorContract'
import {
  resolveMarkdownChecklistTypeoverTransform,
  type ChecklistTypingTransformEvent,
} from './ChecklistTypingTransformPolicy'

function collapsedSelection(offset: number): EditorSelectionState {
  return {
    anchor: offset,
    focus: offset,
    start: offset,
    end: offset,
    isCollapsed: true,
  }
}

function buildEvent(
  text: string,
  char: string,
  selectionOffset: number,
): ChecklistTypingTransformEvent {
  return {
    char,
    text,
    selection: collapsedSelection(selectionOffset),
  }
}

describe('resolveMarkdownChecklistTypeoverTransform', () => {
  it('replaces checklist spacer with typed character in unordered list item', () => {
    const text = '- [ ] task'
    const selectionOffset = text.indexOf('[') + 1

    const result = resolveMarkdownChecklistTypeoverTransform(
      buildEvent(text, 'x', selectionOffset),
    )

    expect(result).not.toBeNull()
    expect(result?.text).toBe('- [x] task')
    expect(result?.selection.anchor).toBe(selectionOffset + 1)
    expect(result?.selection.focus).toBe(selectionOffset + 1)
  })

  it('works with quote-prefixed unordered checklist items', () => {
    const text = '>   * [ ] task'
    const selectionOffset = text.indexOf('[') + 1

    const result = resolveMarkdownChecklistTypeoverTransform(
      buildEvent(text, '?', selectionOffset),
    )

    expect(result).not.toBeNull()
    expect(result?.text).toBe('>   * [?] task')
  })

  it('returns null when caret is not exactly after opening bracket', () => {
    const text = '- [ ] task'
    const selectionOffset = text.indexOf('[')

    const result = resolveMarkdownChecklistTypeoverTransform(
      buildEvent(text, 'x', selectionOffset),
    )

    expect(result).toBeNull()
  })

  it('returns null when checkbox is not after unordered bullet marker', () => {
    const text = 'plain [ ] text'
    const selectionOffset = text.indexOf('[') + 1

    const result = resolveMarkdownChecklistTypeoverTransform(
      buildEvent(text, 'x', selectionOffset),
    )

    expect(result).toBeNull()
  })

  it('returns null for space character inserts', () => {
    const text = '- [ ] task'
    const selectionOffset = text.indexOf('[') + 1

    const result = resolveMarkdownChecklistTypeoverTransform(
      buildEvent(text, ' ', selectionOffset),
    )

    expect(result).toBeNull()
  })
})
