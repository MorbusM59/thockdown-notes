import { describe, expect, it } from 'vitest'
import type { EditorSelectionState } from './EditorContract'
import {
  applyMarkdownEnter,
  indentSelectionByStep,
  resolveMarkdownSelectionContext,
  resolveMarkdownSelectionContextIncremental,
  type InlineStateLineCache,
} from './MarkdownContext'
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

describe('resolveMarkdownSelectionContextIncremental', () => {
  // Ground truth is always resolveMarkdownSelectionContext's own full
  // O(document length) scan -- every assertion here is "the incremental
  // result must equal what a full scan would say," never a hand-transcribed
  // expectation, per this codebase's own established discipline for
  // incremental/caching logic (docs/document-scale-performance-philosophy.md).
  function expectMatchesFullScan(text: string, offset: number, context: ReturnType<typeof resolveMarkdownSelectionContext>) {
    const groundTruth = resolveMarkdownSelectionContext(text, collapsedSelection(offset))
    expect(context).toEqual(groundTruth)
  }

  it('matches a full scan with no previous cache (first call)', () => {
    const text = 'before **bold** after'
    const caret = text.indexOf('bold') + 2
    const { context } = resolveMarkdownSelectionContextIncremental(text, collapsedSelection(caret), null)
    expectMatchesFullScan(text, caret, context)
  })

  it('returns the same cache object, unchanged, when the text is identical', () => {
    const text = 'alpha\nbravo\ncharlie'
    const first = resolveMarkdownSelectionContextIncremental(text, collapsedSelection(0), null)
    const second = resolveMarkdownSelectionContextIncremental(text, collapsedSelection(text.length), first.cache)
    expect(second.cache).toBe(first.cache)
  })

  it('matches a full scan for a single-character edit past an open fence, in a document large enough to exercise the reuse path', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `paragraph number ${i}`)
    lines.splice(4, 0, '```')
    const before = lines.join('\n')
    const beforeResult = resolveMarkdownSelectionContextIncremental(before, collapsedSelection(0), null)

    const after = before.replace('paragraph number 9', 'paragraph NUMBER 9')
    const caret = after.indexOf('NUMBER')
    const afterResult = resolveMarkdownSelectionContextIncremental(after, collapsedSelection(caret), beforeResult.cache)

    expectMatchesFullScan(after, caret, afterResult.context)
    // Caret sits after the unclosed fence opened at line 4 -- confirms the
    // fast path actually threaded the propagated fence state through,
    // rather than something that happens to look right by accident.
    expect(afterResult.context.inline.inFencedCodeBlock).toBe(true)
  })

  function makeRng(seed: number) {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }
  }

  function buildFuzzCorpus(rng: () => number): string {
    const lines: string[] = []
    const kinds = [
      () => `Plain line ${Math.floor(rng() * 1000)} with some words.`,
      () => `## Heading ${Math.floor(rng() * 1000)}`,
      () => '- an unordered item',
      () => `${1 + Math.floor(rng() * 20)}. an ordered item`,
      () => '> a blockquote line',
      () => 'line with **bold** and *italic* and ~~strike~~ and `code`',
      () => '```',
      () => '~~~',
      () => 'a line with an unmatched ` backtick',
      () => 'a line with an unmatched * star',
      () => '   indented line',
    ]
    const lineCount = 20 + Math.floor(rng() * 15)
    for (let i = 0; i < lineCount; i += 1) {
      lines.push(kinds[Math.floor(rng() * kinds.length)]())
    }
    return lines.join('\n')
  }

  function applyFuzzEdit(text: string, rng: () => number): string {
    const lines = text.split('\n')
    const idx = Math.floor(rng() * lines.length)
    const choice = rng()

    if (choice < 0.3) {
      lines[idx] = `${lines[idx]}x`
    } else if (choice < 0.45) {
      lines.splice(idx, 1)
    } else if (choice < 0.55) {
      lines.splice(idx, 0, '')
    } else if (choice < 0.7) {
      const marker = ['```', '~~~', '`', '*', '**', '~~'][Math.floor(rng() * 6)]
      lines.splice(idx, 0, marker)
    } else if (choice < 0.85) {
      // Directly perturb a fence/delimiter-heavy line if this one has any
      // backtick/tilde/star content -- the exact class of edit that flips a
      // persistent open/closed toggle state forward through the document.
      if (/[`~*]/.test(lines[idx])) {
        lines[idx] = rng() < 0.5 ? `${lines[idx]}\`` : lines[idx].replace(/[`~*]/, '')
      } else {
        lines.splice(idx, 0, '```')
      }
    } else {
      lines.splice(idx, 0, `Inserted line ${Math.floor(rng() * 1000)} with *italic* text`)
    }

    return lines.join('\n')
  }

  function runFuzzSequence(seed: number, steps: number) {
    const rng = makeRng(seed)
    let text = buildFuzzCorpus(rng)
    let cache: InlineStateLineCache | null = null

    for (let step = 0; step < steps; step += 1) {
      text = applyFuzzEdit(text, rng)

      // Exercise several different caret positions per step (start, middle,
      // end, and a few random ones) -- resolveMarkdownSelectionContextIncremental's
      // correctness depends on *which* line the caret lands in, not just on
      // the edit itself, so a single fixed caret position per step wouldn't
      // exercise the line-index/entering-state lookup nearly as thoroughly.
      const offsetsToCheck = new Set<number>([0, text.length, Math.floor(text.length / 2)])
      for (let i = 0; i < 4; i += 1) {
        offsetsToCheck.add(Math.floor(rng() * (text.length + 1)))
      }

      for (const offset of offsetsToCheck) {
        const result = resolveMarkdownSelectionContextIncremental(text, collapsedSelection(offset), cache)
        cache = result.cache
        const groundTruth = resolveMarkdownSelectionContext(text, collapsedSelection(offset))
        expect(
          result.context,
          `seed ${seed}: mismatch after fuzz step ${step} at offset ${offset} on text:\n${JSON.stringify(text)}`,
        ).toEqual(groundTruth)
      }
    }
  }

  // Deterministic seeded fuzz test, run across several independent seeds:
  // generates a document mixing plain/heading/list/quote lines with bold,
  // italic, strikethrough, inline code, and both `` ``` `` and `~~~` fences
  // (including deliberately unmatched delimiters), then applies a long
  // random sequence of edits -- several specifically chosen to open/close a
  // fence or leave a delimiter run unmatched, exactly the forward-unbounded
  // hazard class this cache's doc comment calls out -- checking after every
  // edit, at several different caret positions, that the incrementally
  // cached result exactly equals a fresh full scan.
  it.each([20260730, 1, 424242])('matches a full scan after every step of a long randomized edit sequence (seed %i)', (seed) => {
    runFuzzSequence(seed, 200)
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

  it('continues checklist items with an unchecked marker', () => {
    const text = '- [ ] task'
    const selection = collapsedSelection(text.length)

    const result = applyMarkdownEnter(text, selection)

    expect(result).not.toBeNull()
    expect(result?.text).toBe('- [ ] task\n- [ ] ')
  })

  it('continues checklist items with a checked marker', () => {
    const text = '- [x] task'
    const selection = collapsedSelection(text.length)

    const result = applyMarkdownEnter(text, selection)

    expect(result).not.toBeNull()
    expect(result?.text).toBe('- [x] task\n- [ ] ')
  })

  it('continues checklist items with arbitrary single-char marker', () => {
    const text = '- [?] task'
    const selection = collapsedSelection(text.length)

    const result = applyMarkdownEnter(text, selection)

    expect(result).not.toBeNull()
    expect(result?.text).toBe('- [?] task\n- [ ] ')
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

  it('exits list continuation on empty checklist item', () => {
    const text = '- [ ] '
    const selection = collapsedSelection(text.length)

    const result = applyMarkdownEnter(text, selection)

    expect(result).not.toBeNull()
    expect(result?.text).toBe('')
    expect(result?.selection.anchor).toBe(0)
    expect(result?.selection.focus).toBe(0)
  })

  it('exits list continuation on empty checked checklist item', () => {
    const text = '- [x] '
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

  it('inserts a plain newline when no markdown-aware continuation applies', () => {
    const text = 'plain line'
    const selection = collapsedSelection(text.length)

    const result = applyMarkdownEnter(text, selection)

    expect(result).not.toBeNull()
    expect(result?.text).toBe('plain line\n')
    expect(result?.selection.anchor).toBe(result?.text.length)
    expect(result?.selection.focus).toBe(result?.text.length)
  })

  it('continues leading indentation on plain indented lines', () => {
    const text = '   indented line'
    const selection = collapsedSelection(text.length)

    const result = applyMarkdownEnter(text, selection)

    expect(result).not.toBeNull()
    expect(result?.text).toBe('   indented line\n   ')
    expect(result?.selection.anchor).toBe(result?.text.length)
    expect(result?.selection.focus).toBe(result?.text.length)
  })

  it('continues indentation for whitespace-only lines', () => {
    const text = '      '
    const selection = collapsedSelection(text.length)

    const result = applyMarkdownEnter(text, selection)

    expect(result).not.toBeNull()
    expect(result?.text).toBe('      \n      ')
    expect(result?.selection.anchor).toBe(result?.text.length)
    expect(result?.selection.focus).toBe(result?.text.length)
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
