import { describe, expect, it } from 'vitest'
import type { EditorTransformResult } from './EditorContract'
import { collapsedSelectionAt } from './TransformResult'
import { isOffsetInFencedCodeBlock } from './MarkdownContext'
import {
  isTableCellDragStart,
  resolveTableCellDrop,
  resolveTableCharacterTransform,
  resolveTableDeleteTransform,
  resolveTableDeleteColumnTransform,
  resolveTableDividerPress,
  resolveTableMoveTransform,
  resolveTableSelectionStep,
  resolveTableEnterTransform,
  resolveTableTabTransform,
  resolveTableToolbarTransform,
} from './MarkdownTableTransforms'

// Tests are written as the note before and after, with `^` marking the
// caret: the caret sits BEFORE the character that follows the marker, which
// is the box the edit view's block caret covers.
const CARET = '^'

function parse(marked: string) {
  const offset = marked.indexOf(CARET)
  if (offset === -1) throw new Error('no caret marker')
  return { text: marked.slice(0, offset) + marked.slice(offset + 1), selection: collapsedSelectionAt(offset) }
}

function show(result: EditorTransformResult | null): string | null {
  if (!result) return null
  return result.text.slice(0, result.selection.focus) + CARET + result.text.slice(result.selection.focus)
}

const fence = (text: string) => (offset: number) => isOffsetInFencedCodeBlock(text, offset, null)

function tab(marked: string, shiftKey = false) {
  const { text, selection } = parse(marked)
  return show(resolveTableTabTransform({ shiftKey, text, selection }, fence(text)))
}

function enter(marked: string) {
  const { text, selection } = parse(marked)
  return resolveTableEnterTransform({ text, selection }, fence(text))
}

function type(marked: string, char: string) {
  const { text, selection } = parse(marked)
  return show(resolveTableCharacterTransform({ char, text, selection }, fence(text)))
}

function del(marked: string, modifier: 'shift' | 'ctrl') {
  const { text, selection } = parse(marked)
  return show(resolveTableDeleteTransform({ modifier, text, selection }, fence(text)))
}

function click(text: string, clickOffset: number) {
  return resolveTableDividerPress({ text, clickOffset }, fence(text))?.click.text ?? null
}

describe('typing into a blank cell', () => {
  it('puts the character on the middle box from any of the three spaces', () => {
    expect(type('|^   |', 'x')).toBe('| x^ |')
    expect(type('| ^  |', 'x')).toBe('| x^ |')
    expect(type('|  ^ |', 'x')).toBe('| x^ |')
  })

  it('keeps the width of a blank cell in a wider column', () => {
    expect(type('| a    |    ^  |', 'x')).toBe('| a    | x^    |')
  })

  it('leaves every other case to ordinary insertion', () => {
    expect(type('^|   |', 'x')).toBeNull() // before the leading pipe
    expect(type('|   ^|', 'x')).toBeNull() // on the closing pipe
    expect(type('| a^ |', 'x')).toBeNull() // a filled cell
    expect(type('|^  |', 'x')).toBeNull() // two spaces: the reader deleted one
    expect(type('prose ^ here', 'x')).toBeNull()
  })

  it('does nothing inside a code block', () => {
    expect(type('```\n| ^  |\n```', 'x')).toBeNull()
  })
})

describe('Tab', () => {
  it('adds a cell to a header that has no divider yet, caret on its middle box', () => {
    expect(tab('| a^ |')).toBe('| a |' + ' ^  |')
  })

  it('adds a cell to an unclosed row', () => {
    expect(tab('| a^')).toBe('| a |' + ' ^  |')
  })

  it('moves to the next cell when there is one', () => {
    expect(tab('| a^ | bc |')).toBe('| a | bc^ |')
    expect(tab('| a^ |   |')).toBe('| a | ^  |')
  })

  it('adds cells to a body row until it has as many as the header', () => {
    expect(tab('| a | b |\n|---|---|\n| c^ |')).toBe('| a | b |\n|---|---|\n| c |' + ' ^  |')
  })

  it('goes on to the next row once the row is full, creating one at the end', () => {
    expect(tab('| a | b^ |\n|---|---|\n| c | d |')).toBe('| a | b |\n|---|---|\n| c^ | d |')
    expect(tab('| a | b |\n|---|---|\n| c | d^ |')).toBe('| a | b |\n|---|---|\n| c | d |\n| ^  |')
  })

  it('Shift+Tab moves to the previous cell, skipping the divider', () => {
    expect(tab('| a | b |\n|---|---|\n| c^ | d |', true)).toBe('| a | b^ |\n|---|---|\n| c | d |')
    expect(tab('| a | b^ |', true)).toBe('| a^ | b |')
  })

  it('Shift+Tab at the very first cell is swallowed rather than outdenting', () => {
    expect(tab('| a^ |', true)).toBe('| a^ |')
  })

  it('tidies the row it leaves when going on to the next row, as its own undo step', () => {
    const { text, selection } = parse('| name | age |\n|------|-----|\n| al | 3^ |\n| b | c |')
    const result = resolveTableTabTransform({ shiftKey: false, text, selection }, fence(text))!
    expect(result.prelude?.text).toBe('| name | age |\n|------|-----|\n| al   | 3   |\n| b | c |')
    expect(show(result)).toBe('| name | age |\n|------|-----|\n| al   | 3   |\n| b^ | c |')
  })

  it('tidies the whole table when the row it leaves stretches it, then starts a new row', () => {
    expect(tab('| a | b |\n|---|---|\n| wide | c^ |')).toBe('| a    | b |\n|------|---|\n| wide | c |\n| ^  |')
  })

  it('Shift+Tab tidies the row it leaves when going back to the previous row', () => {
    const { text, selection } = parse('| a | b |\n|---|---|\n| c | d |\n| ^x |')
    const result = resolveTableTabTransform({ shiftKey: true, text, selection }, fence(text))!
    expect(result.prelude?.text).toBe('| a | b |\n|---|---|\n| c | d |\n| x |   |')
    expect(show(result)).toBe('| a | b |\n|---|---|\n| c | d^ |\n| x |   |')
  })

  it('Shift+Tab lands on the previous row\'s last cell as the tidy leaves it', () => {
    // Leaving a row with a third cell stretches the table, which gives the
    // row above a third cell too; the caret goes to that one.
    expect(tab('| a | b |\n|---|---|\n| c | d |\n| ^x | y | z |', true))
      .toBe('| a | b |   |\n|---|---|---|\n| c | d | ^  |\n| x | y | z |')
  })

  it('tidies nothing for a move within a row', () => {
    const { text, selection } = parse('| a | b |\n|---|---|\n| c^ |  d |')
    expect(resolveTableTabTransform({ shiftKey: false, text, selection }, fence(text))!.prelude).toBeUndefined()
  })

  it('is not a table rule outside a table line or inside code', () => {
    expect(tab('prose^')).toBeNull()
    expect(tab('```\n| a^ |\n```')).toBeNull()
  })
})

describe('Enter', () => {
  it('turns a header into a table: divider, a new one-cell row, caret in it', () => {
    const result = enter('| name | age^ |')
    expect(show(result)).toBe('| name | age |\n|------|-----|\n| ^  |')
  })

  it('tidies the header first, as its own undo step', () => {
    const result = enter('|name|  age^|')!
    expect(result.prelude?.text).toBe('| name | age |')
    expect(show(result)).toBe('| name | age |\n|------|-----|\n| ^  |')
  })

  it('cancels a table that is one blank cell', () => {
    expect(show(enter('| ^  |'))).toBe('^')
  })

  it('makes a headless table from a blank header of two or more cells', () => {
    expect(show(enter('|   | ^  |'))).toBe('|   |   |\n|---|---|\n| ^  |')
  })

  it('tidies the row just typed to the table, adding its missing cells, then starts a new row', () => {
    const result = enter('| name | age |\n|------|-----|\n| al^ |')!
    expect(result.prelude?.text).toBe('| name | age |\n|------|-----|\n| al   |     |')
    expect(show(result)).toBe('| name | age |\n|------|-----|\n| al   |     |\n| ^  |')
  })

  it('tidies the whole table when the row stretches it', () => {
    const result = enter('| a | b |\n|---|---|\n| wide | c^ |')!
    expect(result.prelude?.text).toBe('| a    | b |\n|------|---|\n| wide | c |')
    expect(show(result)).toBe('| a    | b |\n|------|---|\n| wide | c |\n| ^  |')
  })

  it('drops the leading spaces of the row it tidies, and starts the new row unindented', () => {
    expect(show(enter('| a |\n|---|\n   | b^ |'))).toBe('| a |\n|---|\n| b |\n| ^  |')
  })

  it('makes no undo step for a row that is already tidy', () => {
    const result = enter('| a | b |\n|---|---|\n| c | d^ |')!
    expect(result.prelude).toBeUndefined()
    expect(show(result)).toBe('| a | b |\n|---|---|\n| c | d |\n| ^  |')
  })

  it('starts a new row below the divider from the header', () => {
    expect(show(enter('| a^ |\n|---|\n| b |'))).toBe('| a |\n|---|\n| ^  |\n| b |')
  })

  it('ends the table from a blank last row, without tidying', () => {
    expect(show(enter('| a  |\n|---|\n| ^  |'))).toBe('| a  |\n|---|\n^')
  })

  it('leaves a block of pipe lines that is not a table to ordinary Enter', () => {
    expect(enter('| a |\n| b^ |')).toBeNull()
  })

  it('is not a table rule inside code', () => {
    expect(enter('```\n| a^ |\n```')).toBeNull()
  })
})

describe('Shift+Backspace', () => {
  it('clears the cell and keeps its width', () => {
    expect(del('| a | bcd^ |', 'shift')).toBe('| a | ^    |')
  })

  it('moves to the previous cell from a blank one', () => {
    expect(del('| a |  ^ |', 'shift')).toBe('| a^ |   |')
  })

  it('is left alone on the divider', () => {
    expect(del('| a |\n|-^--|', 'shift')).toBeNull()
  })
})

describe('Ctrl+Backspace', () => {
  it('is ordinary word delete inside a cell\'s content', () => {
    expect(del('| one two^ |', 'ctrl')).toBeNull()
  })

  it('deletes the previous cell\'s last word from the start of a cell', () => {
    expect(del('| one two | ^three |', 'ctrl')).toBe('| one ^ | three |')
  })

  it('deletes the previous cell\'s last word from a blank cell', () => {
    expect(del('| one two |  ^ |', 'ctrl')).toBe('| one ^ |   |')
  })

  it('crosses rows, skipping the divider', () => {
    expect(del('| a | bc |\n|---|---|\n| ^d |', 'ctrl')).toBe('| a | ^ |\n|---|---|\n| d |')
  })

  it('does what it does anywhere else when there is no previous cell', () => {
    expect(del('| ^a |', 'ctrl')).toBeNull()
  })
})

describe('divider clicks', () => {
  const table = '| aaaaa |\n|-------|\n| b     |'
  const cellFrom = table.indexOf('\n') + 2

  it('aligns left, centre or right from the part of the cell clicked', () => {
    expect(click(table, cellFrom)).toContain('|:------|')
    expect(click(table, cellFrom + 3)).toContain('|:-----:|')
    expect(click(table, cellFrom + 6)).toContain('|------:|')
  })

  it('resets when the clicked part matches the current alignment', () => {
    const centred = '| aaaaa |\n|:-----:|'
    expect(click(centred, cellFrom + 3)).toContain('|-------|')
    expect(click(centred, cellFrom)).toContain('|:------|')
  })

  it('fits the narrowest column: `---` becomes `:-:` from the middle', () => {
    const narrow = '| a |\n|---|'
    expect(click(narrow, narrow.indexOf('\n') + 3)).toBe('| a |\n|:-:|')
  })

  it('ignores the divider\'s pipes and dividers that are not a table\'s second line', () => {
    expect(click(table, cellFrom - 1)).toBeNull()
    expect(click('| a |\n| b |\n|---|', 13)).toBeNull()
    expect(click('prose\n|---|', 8)).toBeNull()
  })
})

describe('toolbar button', () => {
  function press(marked: string) {
    const { text, selection } = parse(marked)
    return show(resolveTableToolbarTransform({ text, selection }, fence(text)))
  }

  it('starts a table on an empty line', () => {
    expect(press('prose\n^')).toBe('prose\n| ^  |')
  })

  it('starts a table on a new line below a line with text', () => {
    expect(press('pro^se')).toBe('prose\n| ^  |')
  })

  it('leaves a blank line before text that follows, which would otherwise join the table', () => {
    expect(press('pro^se\nnext')).toBe('prose\n| ^  |\n\nnext')
    expect(press('^\nnext')).toBe('| ^  |\n\nnext')
    expect(press('pro^se\n\nnext')).toBe('prose\n| ^  |\n\nnext')
  })

  it('tidies the table the caret is in and keeps the caret in its cell', () => {
    expect(press('|a|bb^|\n|---|---|\n|ccc|d|')).toBe('| a   | bb^ |\n|-----|----|\n| ccc | d  |')
  })
})

// A selection written with `[` and `]` around it, for the move and ladder tests.
function parseRange(marked: string) {
  const start = marked.indexOf('[')
  const end = marked.indexOf(']') - 1
  const text = marked.replace('[', '').replace(']', '')
  return { text, selection: { anchor: start, focus: end, start, end, isCollapsed: start === end } }
}

function showRange(text: string, range: { start: number; end: number }) {
  return `${text.slice(0, range.start)}[${text.slice(range.start, range.end)}]${text.slice(range.end)}`
}

describe('deleting a column', () => {
  const table = '| a | bb | c |\n|---|:--:|---|\n| d | ee | f |'

  it('Ctrl+Shift+Backspace deletes the caret\'s column from every row, alignment included', () => {
    const { text, selection } = parse('| a | bb | c |\n|---|:--:|---|\n| d | e^e | f |')
    expect(show(resolveTableDeleteColumnTransform({ text, selection }, fence(text))))
      .toBe('| a | c |\n|---|---|\n| d | f^ |')
  })

  it('holding a divider cell deletes that column', () => {
    const dividerCell = table.indexOf(':--:')
    expect(resolveTableDividerPress({ text: table, clickOffset: dividerCell }, fence(table))?.hold.text)
      .toBe('| a | c |\n|---|---|\n| d | f |')
  })

  it('deleting the only column deletes the table and its line break', () => {
    const { text, selection } = parse('before\n| a^ |\n|---|\nafter')
    expect(show(resolveTableDeleteColumnTransform({ text, selection }, fence(text)))).toBe('before\n^after')
    const atEnd = parse('before\n| a^ |\n|---|')
    expect(show(resolveTableDeleteColumnTransform(atEnd, fence(atEnd.text)))).toBe('before^')
  })
})

describe('moving rows and columns', () => {
  function move(marked: string, direction: 'left' | 'right' | 'up' | 'down') {
    const { text, selection } = marked.includes('^') ? parse(marked) : parseRange(marked)
    const result = resolveTableMoveTransform({ direction, text, selection }, fence(text))
    if (!result) return null
    return result.selection.isCollapsed ? show(result) : showRange(result.text, result.selection)
  }
  it('moves a column with its alignment, the caret going with it', () => {
    expect(move('| a | b |\n|:--|---|\n| c^ | d |\n| e | f |', 'right')).toBe('| b | a |\n|---|:--|\n| d | c^ |\n| f | e |')
  })

  it('moves a row among the content rows, the divider staying put', () => {
    expect(move('| a | b |\n|:--|---|\n| c | d |\n| e^ | f |', 'up')).toBe('| a | b |\n|:--|---|\n| e^ | f |\n| c | d |')
    expect(move('| a | b |\n|:--|---|\n| c^ | d |\n| e | f |', 'up')).toBe('| c^ | d |\n|:--|---|\n| a | b |\n| e | f |')
  })

  it('carries a selected cell with it', () => {
    expect(move('| a | b |\n|:--|---|\n| [c] | d |\n| e | f |', 'down')).toBe('| a | b |\n|:--|---|\n| e | f |\n| [c] | d |')
  })

  it('is swallowed at the table\'s edge', () => {
    expect(move('| a^ | b |\n|:--|---|\n| c | d |', 'left')).toBe('| a^ | b |\n|:--|---|\n| c | d |')
    expect(move('| a | b |\n|:--|---|\n| c^ | d |', 'down')).toBe('| a | b |\n|:--|---|\n| c^ | d |')
  })

  it('is not a table rule outside a table', () => {
    expect(move('prose^', 'left')).toBeNull()
  })
})

describe('the right-click ladder in a table', () => {
  function step(marked: string, clickOffsetIn: string) {
    const { text, selection } = marked.includes('[') ? parseRange(marked) : { text: marked, selection: collapsedSelectionAt(0) }
    const clickOffset = text.indexOf(clickOffsetIn)
    const range = resolveTableSelectionStep({ text, clickOffset, selection }, fence(text))
    return range ? showRange(text, range) : null
  }
  const table = '| one two | x |\n|---|---|\n| y | z |'

  it('goes word, cell, row, table', () => {
    expect(step(table, 'two')).toBe('| one [two] | x |\n|---|---|\n| y | z |')
    expect(step('| one [two] | x |\n|---|---|\n| y | z |', 'two')).toBe('| [one two] | x |\n|---|---|\n| y | z |')
    expect(step('| [one two] | x |\n|---|---|\n| y | z |', 'two')).toBe('[| one two | x |]\n|---|---|\n| y | z |')
    expect(step('[| one two | x |]\n|---|---|\n| y | z |', 'two')).toBe('[| one two | x |\n|---|---|\n| y | z |]')
  })

  it('selects the spaces between the pipes of an empty cell', () => {
    expect(step('|   | x |', '  ')).toBe('|[   ]| x |')
  })

  it('leaves prose to the prose ladder', () => {
    expect(step('just prose', 'prose')).toBeNull()
  })
})

describe('dragging a selected cell', () => {
  const marked = '| a | b |\n|---|:--|\n| [c] | d |\n| e | f |'
  const { text, selection } = parseRange(marked)

  it('starts only from a press inside a selection that is exactly one cell\'s content', () => {
    expect(isTableCellDragStart({ text, selection, pressOffset: selection.start }, fence(text))).toBe(true)
    expect(isTableCellDragStart({ text, selection, pressOffset: 0 }, fence(text))).toBe(false)
    const word = parseRange('| a | b |\n|---|---|\n| [c] d | e |')
    const partial = { ...word.selection }
    expect(isTableCellDragStart({ text: word.text, selection: partial, pressOffset: partial.start }, fence(word.text))).toBe(false)
  })

  it('moves the cell\'s row and column so its content lands in the target cell, still selected', () => {
    const drop = resolveTableCellDrop({ text, selection, targetOffset: text.indexOf('b') }, fence(text))!
    expect(showRange(drop.result.text, drop.result.selection)).toBe('| d | [c] |\n|:--|---|\n| b | a |\n| f | e |')
    expect(text.slice(drop.target.from, drop.target.to)).toBe(' b ')
  })

  it('has no target on the divider, on its own cell, or outside the table', () => {
    expect(resolveTableCellDrop({ text, selection, targetOffset: text.indexOf(':--') }, fence(text))).toBeNull()
    expect(resolveTableCellDrop({ text, selection, targetOffset: selection.start }, fence(text))).toBeNull()
    const withProse = `${text}\n\nprose`
    expect(resolveTableCellDrop({ text: withProse, selection, targetOffset: withProse.indexOf('prose') }, fence(withProse))).toBeNull()
  })
})
