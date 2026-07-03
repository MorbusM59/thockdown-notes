import { describe, expect, it } from 'vitest'
import type { EditorSelectionState } from './EditorContract'
import { resolveMarkdownEnterTransform, type EnterTransformEvent } from './EnterTransformPolicy'
import { normalizeInternalText } from './TextPolicy'

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
  selection: EditorSelectionState,
  overrides: Partial<EnterTransformEvent> = {},
): EnterTransformEvent {
  return {
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    text,
    selection,
    ...overrides,
  }
}

describe('resolveMarkdownEnterTransform', () => {
  it('returns null when a modifier key is active', () => {
    const text = '- item'
    const selection = collapsedSelection(text.length)

    const result = resolveMarkdownEnterTransform(
      buildEvent(text, selection, { ctrlKey: true }),
    )

    expect(result).toBeNull()
  })

  it('continues markdown list items for plain Enter', () => {
    const text = '- item'
    const selection = collapsedSelection(text.length)

    const result = resolveMarkdownEnterTransform(buildEvent(text, selection))

    expect(result).not.toBeNull()
    expect(result?.text).toBe('- item\n- ')
    expect(result?.selection.anchor).toBe(result?.text.length)
    expect(result?.selection.focus).toBe(result?.text.length)
  })

  it('continues markdown checklist items for plain Enter', () => {
    const text = '- [ ] task'
    const selection = collapsedSelection(text.length)

    const result = resolveMarkdownEnterTransform(buildEvent(text, selection))

    expect(result).not.toBeNull()
    expect(result?.text).toBe('- [ ] task\n- [ ] ')
    expect(result?.selection.anchor).toBe(result?.text.length)
    expect(result?.selection.focus).toBe(result?.text.length)
  })

  it('continues markdown checked checklist items for plain Enter', () => {
    const text = '- [x] task'
    const selection = collapsedSelection(text.length)

    const result = resolveMarkdownEnterTransform(buildEvent(text, selection))

    expect(result).not.toBeNull()
    expect(result?.text).toBe('- [x] task\n- [ ] ')
    expect(result?.selection.anchor).toBe(result?.text.length)
    expect(result?.selection.focus).toBe(result?.text.length)
  })

  it('continues leading indentation on plain indented lines', () => {
    const text = '   indented line'
    const selection = collapsedSelection(text.length)

    const result = resolveMarkdownEnterTransform(buildEvent(text, selection))

    expect(result).not.toBeNull()
    expect(result?.text).toBe('   indented line\n   ')
  })

  it('continues leading indentation on whitespace-only lines without inflating trailing spaces', () => {
    const text = '  '
    const selection = collapsedSelection(1)

    const result = resolveMarkdownEnterTransform(buildEvent(text, selection))

    expect(result).not.toBeNull()
    expect(result?.text).toBe(' \n  ')
    expect(result?.selection.anchor).toBe(3)
    expect(result?.selection.focus).toBe(3)
  })

  it('terminates empty markdown list items in place', () => {
    const text = '- '
    const selection = collapsedSelection(text.length)

    const result = resolveMarkdownEnterTransform(buildEvent(text, selection))

    expect(result).not.toBeNull()
    expect(result?.text).toBe('')
    expect(result?.selection.anchor).toBe(0)
    expect(result?.selection.focus).toBe(0)
  })

  it('normalizes tabs before applying enter continuation semantics', () => {
    const raw = '\t  - item'
    const normalized = normalizeInternalText(raw)
    const selection = collapsedSelection(normalized.length)

    const result = resolveMarkdownEnterTransform(buildEvent(raw, selection))

    expect(normalized).toBe('     - item')
    expect(result).not.toBeNull()
    expect(result?.text).toBe('     - item\n     - ')
  })

  it('inserts a plain newline when no markdown-aware continuation applies', () => {
    const text = 'plain line'
    const selection = collapsedSelection(text.length)

    const result = resolveMarkdownEnterTransform(buildEvent(text, selection))

    expect(result).not.toBeNull()
    expect(result?.text).toBe('plain line\n')
    expect(result?.selection.anchor).toBe(result?.text.length)
    expect(result?.selection.focus).toBe(result?.text.length)
  })
})