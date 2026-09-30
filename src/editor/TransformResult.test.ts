import { describe, expect, it } from 'vitest'
import type { EditorSelectionState, EditorTransformResult } from './EditorContract'
import { buildTransformResult, collapsedSelectionAt } from './TransformResult'
import { applyMarkdownEnter, indentSelectionByStep } from './MarkdownContext'
import { resolveMarkdownChecklistTypeoverTransform } from './ChecklistTypingTransformPolicy'
import { resolveMarkdownChecklistCaretClickToggleTransform } from './ChecklistCaretClickTogglePolicy'

function collapsedAt(offset: number): EditorSelectionState {
  return collapsedSelectionAt(offset)
}

/** Independently reapplies the reported edit -- the property every consumer relies on. */
function applyEdit(previousText: string, result: EditorTransformResult): string {
  return previousText.slice(0, result.edit.from) + result.edit.insert + previousText.slice(result.edit.to)
}

describe('buildTransformResult', () => {
  it('derives text from the edit rather than taking it on trust', () => {
    const result = buildTransformResult('abcdef', { from: 2, to: 4, insert: 'XY' }, collapsedAt(4))
    expect(result.text).toBe('abXYef')
    expect(applyEdit('abcdef', result)).toBe(result.text)
  })

  it('handles a pure insertion and a pure deletion', () => {
    expect(buildTransformResult('abc', { from: 1, to: 1, insert: 'Z' }, collapsedAt(2)).text).toBe('aZbc')
    expect(buildTransformResult('abc', { from: 1, to: 2, insert: '' }, collapsedAt(1)).text).toBe('ac')
  })
})

/**
 * The reason the contract carries an edit at all is that the edit is SMALL.
 * A transform that reported `{from: 0, to: text.length, insert: wholeNewText}`
 * would satisfy every text-level assertion in this codebase and silently put
 * back the O(document) cost the contract exists to remove -- CM6 would treat
 * the whole document as changed on every keystroke again. These tests fail on
 * that, which no other test in the suite does.
 */
describe('transform edits stay proportional to what changed', () => {
  const filler = Array.from({ length: 400 }, (_, index) => `line ${index} of surrounding prose`).join('\n')

  it('Enter reports an edit at the caret, not the whole document', () => {
    const text = `${filler}\n- item\n${filler}`
    const caret = text.indexOf('- item') + '- item'.length
    const result = applyMarkdownEnter(text, collapsedAt(caret))

    expect(result).not.toBeNull()
    expect(applyEdit(text, result!)).toBe(result!.text)
    expect(result!.edit.from).toBe(caret)
    expect(result!.edit.to - result!.edit.from).toBeLessThan(20)
    expect(result!.edit.insert.length).toBeLessThan(20)
  })

  it('Enter on an empty list item deletes just that line', () => {
    const text = `${filler}\n- \n${filler}`
    const caret = text.indexOf('- ') + 2
    const result = applyMarkdownEnter(text, collapsedAt(caret))

    expect(result).not.toBeNull()
    expect(applyEdit(text, result!)).toBe(result!.text)
    expect(result!.edit.insert).toBe('')
    expect(result!.edit.to - result!.edit.from).toBeLessThan(10)
  })

  it('Tab indent reports only the selected line block', () => {
    const text = `${filler}\n- item\n${filler}`
    const caret = text.indexOf('- item') + 2
    const result = indentSelectionByStep(text, collapsedAt(caret), 'indent', 3)

    expect(applyEdit(text, result)).toBe(result.text)
    expect(result.edit.from).toBeGreaterThan(0)
    expect(result.edit.to - result.edit.from).toBeLessThan(20)
  })

  it('checklist typeover reports a single-character edit', () => {
    const text = `${filler}\n- [ ] task\n${filler}`
    const caret = text.indexOf('- [ ] task') + 3
    const result = resolveMarkdownChecklistTypeoverTransform({ char: 'x', text, selection: collapsedAt(caret) })

    expect(result).not.toBeNull()
    expect(applyEdit(text, result!)).toBe(result!.text)
    expect(result!.edit).toEqual({ from: caret, to: caret + 1, insert: 'x' })
  })

  it('checklist caret-click toggle reports a single-character edit', () => {
    const text = `${filler}\n- [ ] task\n${filler}`
    const caret = text.indexOf('- [ ] task') + 3
    const result = resolveMarkdownChecklistCaretClickToggleTransform({ text, selection: collapsedAt(caret), clickOffset: caret })

    expect(result).not.toBeNull()
    expect(applyEdit(text, result!)).toBe(result!.text)
    expect(result!.edit).toEqual({ from: caret, to: caret + 1, insert: 'X' })
  })
})
