import { describe, expect, it } from 'vitest'
import type { EditorSelectionState } from './EditorContract'
import {
  resolveMarkdownChecklistCaretClickToggleTransform,
  type ChecklistCaretClickToggleEvent,
} from './ChecklistCaretClickTogglePolicy'

function collapsedSelection(offset: number): EditorSelectionState {
  return {
    anchor: offset,
    focus: offset,
    start: offset,
    end: offset,
    isCollapsed: true,
  }
}

function buildEvent(text: string, selectionOffset: number): ChecklistCaretClickToggleEvent {
  return {
    text,
    selection: collapsedSelection(selectionOffset),
  }
}

describe('resolveMarkdownChecklistCaretClickToggleTransform', () => {
  it('checks an unchecked box, replacing the space with X', () => {
    const text = '- [ ] task'
    const selectionOffset = text.indexOf('[') + 1

    const result = resolveMarkdownChecklistCaretClickToggleTransform(buildEvent(text, selectionOffset))

    expect(result).not.toBeNull()
    expect(result?.text).toBe('- [X] task')
    expect(result?.selection.anchor).toBe(selectionOffset)
    expect(result?.selection.focus).toBe(selectionOffset)
  })

  it('unchecks a checked box, replacing the state char with a space', () => {
    const text = '- [x] task'
    const selectionOffset = text.indexOf('[') + 1

    const result = resolveMarkdownChecklistCaretClickToggleTransform(buildEvent(text, selectionOffset))

    expect(result).not.toBeNull()
    expect(result?.text).toBe('- [ ] task')
  })

  it('works with quote-prefixed unordered checklist items', () => {
    const text = '>   * [ ] task'
    const selectionOffset = text.indexOf('[') + 1

    const result = resolveMarkdownChecklistCaretClickToggleTransform(buildEvent(text, selectionOffset))

    expect(result).not.toBeNull()
    expect(result?.text).toBe('>   * [X] task')
  })

  it('returns null when caret is not exactly after opening bracket', () => {
    const text = '- [ ] task'
    const selectionOffset = text.indexOf('[')

    const result = resolveMarkdownChecklistCaretClickToggleTransform(buildEvent(text, selectionOffset))

    expect(result).toBeNull()
  })

  it('returns null when checkbox is not after unordered bullet marker', () => {
    const text = 'plain [ ] text'
    const selectionOffset = text.indexOf('[') + 1

    const result = resolveMarkdownChecklistCaretClickToggleTransform(buildEvent(text, selectionOffset))

    expect(result).toBeNull()
  })

  it('returns null when selection is not collapsed', () => {
    const text = '- [ ] task'
    const offset = text.indexOf('[') + 1

    const result = resolveMarkdownChecklistCaretClickToggleTransform({
      text,
      selection: {
        anchor: offset,
        focus: offset + 1,
        start: offset,
        end: offset + 1,
        isCollapsed: false,
      },
    })

    expect(result).toBeNull()
  })
})
