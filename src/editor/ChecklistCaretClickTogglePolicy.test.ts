import { describe, expect, it } from 'vitest'
import type { EditorSelectionState } from './EditorContract'
import {
  resolveMarkdownChecklistCaretClickToggleTransform,
  resolveMarkdownChecklistLineToggleTransform,
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

describe('resolveMarkdownChecklistLineToggleTransform', () => {
  it('checks an unchecked box on the given line', () => {
    const text = 'intro\n- [ ] task\nmore text'

    const result = resolveMarkdownChecklistLineToggleTransform(text, 1)

    expect(result).not.toBeNull()
    expect(result?.text).toBe('intro\n- [X] task\nmore text')
  })

  it('unchecks a checked box on the given line', () => {
    const text = 'intro\n- [x] task\nmore text'

    const result = resolveMarkdownChecklistLineToggleTransform(text, 1)

    expect(result).not.toBeNull()
    expect(result?.text).toBe('intro\n- [ ] task\nmore text')
  })

  it('only touches the targeted line, not other checkboxes', () => {
    const text = '- [ ] first\n- [ ] second\n- [ ] third'

    const result = resolveMarkdownChecklistLineToggleTransform(text, 1)

    expect(result?.text).toBe('- [ ] first\n- [X] second\n- [ ] third')
  })

  it('works with quote-prefixed unordered checklist items', () => {
    const text = '>   * [ ] task'

    const result = resolveMarkdownChecklistLineToggleTransform(text, 0)

    expect(result?.text).toBe('>   * [X] task')
  })

  it('returns null when the line has no checkbox', () => {
    const text = 'just a plain line'

    const result = resolveMarkdownChecklistLineToggleTransform(text, 0)

    expect(result).toBeNull()
  })

  it('returns null for an out-of-range line', () => {
    const text = '- [ ] task'

    expect(resolveMarkdownChecklistLineToggleTransform(text, -1)).toBeNull()
    expect(resolveMarkdownChecklistLineToggleTransform(text, 5)).toBeNull()
  })
})
