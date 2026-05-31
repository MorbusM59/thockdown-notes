import { describe, expect, it } from 'vitest'
import type { EditorSelectionState } from './EditorContract'
import { applyMarkdownEnter, indentSelectionByStep, resolveMarkdownSelectionContext } from './MarkdownContext'
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

describe('resolveMarkdownSelectionContext', () => {
  it('distinguishes bold from italic for double-star spans', () => {
    const text = 'before **bold** after'
    const caret = text.indexOf('bold') + 2

    const context = resolveMarkdownSelectionContext(text, collapsedSelection(caret))

    expect(context.inline.inBold).toBe(true)
    expect(context.inline.inItalic).toBe(false)
    expect(context.inline.inStrikethrough).toBe(false)
  })

  it('detects italic for single-star spans', () => {
    const text = 'before *italic* after'
    const caret = text.indexOf('italic') + 2

    const context = resolveMarkdownSelectionContext(text, collapsedSelection(caret))

    expect(context.inline.inBold).toBe(false)
    expect(context.inline.inItalic).toBe(true)
  })

  it('disables inline formatting states inside inline code', () => {
    const text = 'before `**not bold** *not italic*` after'
    const caret = text.indexOf('not bold') + 1

    const context = resolveMarkdownSelectionContext(text, collapsedSelection(caret))

    expect(context.inline.inInlineCode).toBe(true)
    expect(context.inline.inBold).toBe(false)
    expect(context.inline.inItalic).toBe(false)
  })

  it('detects fenced code block context', () => {
    const text = ['```ts', 'const x = 1', '```', 'tail'].join('\n')
    const caret = text.indexOf('const') + 2

    const context = resolveMarkdownSelectionContext(text, collapsedSelection(caret))

    expect(context.inline.inFencedCodeBlock).toBe(true)
  })

  it('extracts line-level heading/list/blockquote metadata', () => {
    const text = '   > > ## heading'
    const caret = text.indexOf('heading') + 1

    const context = resolveMarkdownSelectionContext(text, collapsedSelection(caret))

    expect(context.line.headingLevel).toBe(2)
    expect(context.line.blockquoteDepth).toBe(2)
    expect(context.line.leadingWhitespaceCount).toBe(3)
    expect(context.line.listKind).toBe(null)
  })

  it('extracts ordered and unordered list metadata', () => {
    const unorderedText = '   - item'
    const unorderedContext = resolveMarkdownSelectionContext(unorderedText, collapsedSelection(unorderedText.length))
    expect(unorderedContext.line.listKind).toBe('unordered')
    expect(unorderedContext.line.listIndentLevel).toBe(1)

    const orderedText = '      42. item'
    const orderedContext = resolveMarkdownSelectionContext(orderedText, collapsedSelection(orderedText.length))
    expect(orderedContext.line.listKind).toBe('ordered')
    expect(orderedContext.line.orderedListNumber).toBe(42)
    expect(orderedContext.line.listIndentLevel).toBe(2)
  })

  it('extracts list metadata for quote-prefixed nested list lines', () => {
    const text = '>    * item'
    const context = resolveMarkdownSelectionContext(text, collapsedSelection(text.length))

    expect(context.line.blockquoteDepth).toBe(1)
    expect(context.line.listKind).toBe('unordered')
    expect(context.line.listIndentLevel).toBe(1)
    expect(context.line.listMarker).toBe('*')
  })
})

describe('indentSelectionByStep', () => {
  it('tab rounds indentation up to next multiple of 3', () => {
    const text = ' x'
    const caret = collapsedSelection(1)

    const result = indentSelectionByStep(text, caret, 'indent', 3)

    expect(result.text).toBe('   x')
    expect(result.selection.anchor).toBe(3)
    expect(result.selection.focus).toBe(3)
  })

  it('shift+tab rounds indentation down to previous multiple of 3', () => {
    const text = '    x'
    const caret = collapsedSelection(2)

    const result = indentSelectionByStep(text, caret, 'outdent', 3)

    expect(result.text).toBe('   x')
    expect(result.selection.anchor).toBe(1)
    expect(result.selection.focus).toBe(1)
  })

  it('applies indentation transform to all selected lines and remaps selection', () => {
    const text = [' a', '  b', '   c'].join('\n')
    const selection: EditorSelectionState = {
      anchor: 0,
      focus: text.length,
      start: 0,
      end: text.length,
      isCollapsed: false,
    }

    const result = indentSelectionByStep(text, selection, 'indent', 3)

    expect(result.text).toBe(['   a', '   b', '      c'].join('\n'))
    expect(result.selection.start).toBe(2)
    expect(result.selection.end).toBe(result.text.length)
  })
})

describe('applyMarkdownEnter', () => {
  it('continues unordered list item indentation', () => {
    const text = '- item'
    const selection = collapsedSelection(text.length)

    const result = applyMarkdownEnter(text, selection)

    expect(result).not.toBeNull()
    expect(result?.text).toBe('- item\n- ')
  })

  it('preserves unordered marker style during continuation', () => {
    const text = '* item'
    const selection = collapsedSelection(text.length)

    const result = applyMarkdownEnter(text, selection)

    expect(result).not.toBeNull()
    expect(result?.text).toBe('* item\n* ')
  })

  it('continues ordered list item with incremented number', () => {
    const text = '3. item'
    const selection = collapsedSelection(text.length)

    const result = applyMarkdownEnter(text, selection)

    expect(result).not.toBeNull()
    expect(result?.text).toBe('3. item\n4. ')
  })

  it('continues ordered list item while preserving parenthesis delimiter', () => {
    const text = '7) item'
    const selection = collapsedSelection(text.length)

    const result = applyMarkdownEnter(text, selection)

    expect(result).not.toBeNull()
    expect(result?.text).toBe('7) item\n8) ')
  })

  it('exits list continuation on empty list item', () => {
    const text = '- '
    const selection = collapsedSelection(text.length)

    const result = applyMarkdownEnter(text, selection)

    expect(result).not.toBeNull()
    expect(result?.text).toBe('')
    expect(result?.selection.anchor).toBe(0)
    expect(result?.selection.focus).toBe(0)
  })

  it('exits ordered continuation on empty ordered list item', () => {
    const text = '12. '
    const selection = collapsedSelection(text.length)

    const result = applyMarkdownEnter(text, selection)

    expect(result).not.toBeNull()
    expect(result?.text).toBe('')
    expect(result?.selection.anchor).toBe(0)
    expect(result?.selection.focus).toBe(0)
  })

  it('continues quote prefix when inside blockquote', () => {
    const text = '> quoted line'
    const selection = collapsedSelection(text.length)

    const result = applyMarkdownEnter(text, selection)

    expect(result).not.toBeNull()
    expect(result?.text).toBe('> quoted line\n> ')
  })

  it('continues quote-prefixed nested list with preserved indentation and marker', () => {
    const text = '>    * item'
    const selection = collapsedSelection(text.length)

    const result = applyMarkdownEnter(text, selection)

    expect(result).not.toBeNull()
    expect(result?.text).toBe('>    * item\n>    * ')
  })

  it('continues quote-prefixed ordered list with incremented number', () => {
    const text = '> >   4) item'
    const selection = collapsedSelection(text.length)

    const result = applyMarkdownEnter(text, selection)

    expect(result).not.toBeNull()
    expect(result?.text).toBe('> >   4) item\n> >   5) ')
  })

  it('exits quote-prefixed empty ordered list item to quote indentation', () => {
    const text = '> >   9. '
    const selection = collapsedSelection(text.length)

    const result = applyMarkdownEnter(text, selection)

    expect(result).not.toBeNull()
    expect(result?.text).toBe('')
    expect(result?.selection.anchor).toBe(0)
    expect(result?.selection.focus).toBe(0)
  })

  it('exits quote-prefixed empty list item to quote indentation', () => {
    const text = '>    * '
    const selection = collapsedSelection(text.length)

    const result = applyMarkdownEnter(text, selection)

    expect(result).not.toBeNull()
    expect(result?.text).toBe('')
    expect(result?.selection.anchor).toBe(0)
    expect(result?.selection.focus).toBe(0)
  })

  it('returns null when no markdown-aware continuation applies', () => {
    const text = 'plain line'
    const selection = collapsedSelection(text.length)

    const result = applyMarkdownEnter(text, selection)

    expect(result).toBeNull()
  })

  it('returns null for non-collapsed selections', () => {
    const text = '- item'
    const selection: EditorSelectionState = {
      anchor: 0,
      focus: text.length,
      start: 0,
      end: text.length,
      isCollapsed: false,
    }

    const result = applyMarkdownEnter(text, selection)

    expect(result).toBeNull()
  })

  it('returns null for cross-line non-collapsed selections', () => {
    const text = ['- first', '- second'].join('\n')
    const selection: EditorSelectionState = {
      anchor: 1,
      focus: text.length - 1,
      start: 1,
      end: text.length - 1,
      isCollapsed: false,
    }

    const result = applyMarkdownEnter(text, selection)

    expect(result).toBeNull()
  })

  it('returns null inside fenced code blocks', () => {
    const text = ['```md', '- item', '```'].join('\n')
    const selection = collapsedSelection(text.indexOf('item'))

    const result = applyMarkdownEnter(text, selection)

    expect(result).toBeNull()
  })

  it('normalizes mixed tabs/spaces before list continuation logic', () => {
    const raw = '\t  - item'
    const text = normalizeInternalText(raw)
    const selection = collapsedSelection(text.length)

    const result = applyMarkdownEnter(text, selection)

    expect(text).toBe('     - item')
    expect(result).not.toBeNull()
    expect(result?.text).toBe('     - item\n     - ')
  })

  it('normalizes tabs before empty-list Enter termination logic', () => {
    const raw = '\t- '
    const text = normalizeInternalText(raw)
    const selection = collapsedSelection(text.length)

    const result = applyMarkdownEnter(text, selection)

    expect(text).toBe('   - ')
    expect(result).not.toBeNull()
    expect(result?.text).toBe('')
    expect(result?.selection.anchor).toBe(0)
    expect(result?.selection.focus).toBe(0)
  })
})
