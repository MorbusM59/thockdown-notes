import { describe, expect, it } from 'vitest'
import {
  cellIndexAt,
  findTableAt,
  isTableDividerLine,
  parseTableRow,
  rowStretchesTable,
  tidyRowText,
  tidyTableText,
} from './MarkdownTable'

describe('parseTableRow', () => {
  it('splits cells on pipes and trims their content', () => {
    const row = parseTableRow('| a  | bb |', 0)
    expect(row.cells.map((cell) => cell.content)).toEqual(['a', 'bb'])
    expect(row.closed).toBe(true)
  })

  it('treats a trailing cell without a closing pipe as a cell', () => {
    const row = parseTableRow('| a | b', 0)
    expect(row.cells.map((cell) => cell.content)).toEqual(['a', 'b'])
    expect(row.closed).toBe(false)
  })

  it('keeps an escaped pipe inside its cell', () => {
    const row = parseTableRow('| a \\| b | c |', 0)
    expect(row.cells.map((cell) => cell.content)).toEqual(['a \\| b', 'c'])
  })

  it('places cells at absolute offsets', () => {
    const row = parseTableRow('|   |', 10)
    expect(row.cells).toHaveLength(1)
    expect(row.cells[0]).toMatchObject({ from: 11, to: 14, content: '' })
  })
})

describe('findTableAt', () => {
  const text = 'prose\n| a | b |\n|---|---|\n| c | d |\nmore prose'

  it('finds the block of pipe lines around the offset', () => {
    const table = findTableAt(text, text.indexOf('| c'))
    expect(table?.rows).toHaveLength(3)
    expect(table?.hasDivider).toBe(true)
    expect(table?.caretRow).toBe(2)
  })

  it('returns null off a table line', () => {
    expect(findTableAt(text, 2)).toBeNull()
  })

  it('does not call a block a table when its second line is not a divider', () => {
    const table = findTableAt('| a |\n| b |', 0)
    expect(table?.hasDivider).toBe(false)
  })

  it('does not call a block a table when the divider has a different cell count', () => {
    const table = findTableAt('| a | b |\n|---|', 0)
    expect(table?.hasDivider).toBe(false)
  })
})

describe('cellIndexAt', () => {
  const row = parseTableRow('| ab | cd |', 0)

  it('assigns a closing pipe to the cell it closes', () => {
    expect(cellIndexAt(row, 5)).toBe(0)
    expect(cellIndexAt(row, 6)).toBe(1)
  })

  it('assigns offsets before the leading pipe and past the last to the edge cells', () => {
    expect(cellIndexAt(row, 0)).toBe(0)
    expect(cellIndexAt(row, 11)).toBe(1)
  })
})

describe('isTableDividerLine', () => {
  it('accepts a divider directly under a header', () => {
    expect(isTableDividerLine('|:--|--:|', '| a | b |', null)).toBe(true)
  })

  it('rejects a divider under a body row', () => {
    expect(isTableDividerLine('|---|', '| b |', '| a |')).toBe(false)
  })
})

describe('tidying', () => {
  it('pads every column to its widest content and fits the divider to it, keeping alignment', () => {
    const table = findTableAt('| a | bbbb |\n|:-:|---|\n| cc | d |', 0)!
    expect(tidyTableText(table)).toBe([
      '| a  | bbbb |',
      '|:--:|------|',
      '| cc | d    |',
    ].join('\n'))
  })

  it('extends every row, the header and the divider to the widest cell count', () => {
    const table = findTableAt('| a |\n|---|\n| b | c |', 0)!
    expect(tidyTableText(table)).toBe([
      '| a |   |',
      '|---|---|',
      '| b | c |',
    ].join('\n'))
  })

  it('keeps a blank header as a blank header (a headless table)', () => {
    const table = findTableAt('|  |  |\n|---|---|\n| a | b |', 0)!
    expect(tidyTableText(table)).toBe([
      '|   |   |',
      '|---|---|',
      '| a | b |',
    ].join('\n'))
  })

  it('keeps each line\'s indentation', () => {
    const table = findTableAt('  | a |\n  |---|', 0)!
    expect(tidyTableText(table)).toBe('  | a |\n  |---|')
  })

  it('is a fixed point: tidying tidy text changes nothing', () => {
    const tables = [
      '| a | bbbb |\n|:-:|---|\n| cc | d |',
      '| x |\n|--:|\n| longer cell | y | z |\n|  |',
      '|  |  |\n|---|---|\n| a \\| b | c |',
      '| only a header |',
    ]
    for (const source of tables) {
      let text = source
      for (let round = 0; round < 3; round += 1) {
        const next = tidyTableText(findTableAt(text, 0)!)
        if (round > 0) expect(next).toBe(text)
        text = next
      }
    }
  })

  it('pads a row that fits to the existing column widths, adding missing cells', () => {
    const table = findTableAt('| aaa | b |\n|---|---|\n| c |', 0)!
    expect(rowStretchesTable(table, 2)).toBe(false)
    expect(tidyRowText(table, 2)).toBe('| c   |   |')
  })

  it('reports a row with a cell wider than its column as stretching the table', () => {
    const table = findTableAt('| a | b |\n|---|---|\n| wide | c |', 0)!
    expect(rowStretchesTable(table, 2)).toBe(true)
  })

  it('reports a row with more cells than columns as stretching the table', () => {
    const table = findTableAt('| a |\n|---|\n| b | c |', 0)!
    expect(rowStretchesTable(table, 2)).toBe(true)
  })
})
