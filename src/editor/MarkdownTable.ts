/**
 * The one reading of a markdown pipe table that every table feature in the
 * edit view shares: the Tab/Enter/typing/delete transforms in
 * MarkdownTableTransforms.ts, the toolbar's insert-or-tidy button, and the
 * edit view's line classification (MarkdownLineClassification.ts). Nothing
 * else splits a row on pipes, so a rule about what a cell is cannot be
 * stated one way here and another way there.
 *
 * Zero framework imports, like MarkdownLineClassification.ts: this is plain
 * string arithmetic over the note text.
 *
 * What counts as a table. A TABLE LINE is a line whose first non-space
 * character is `|`. A TABLE BLOCK is a maximal run of consecutive table lines.
 * A block is a real GFM table when its second line is a divider with the same
 * cell count as its first line; that is the only position in which a divider
 * means anything (a divider-shaped line anywhere else is an ordinary row whose
 * cells happen to contain dashes, and the render view shows it as such). Lines
 * without a leading pipe, which GFM also accepts, are deliberately not
 * recognised: the feature acts only on text that visibly looks like a table.
 *
 * Why widths are character counts. Every character in a note occupies exactly
 * one cell of the editor's monospace grid (src/shared/singleCellText.ts), so
 * a string's length IS its on-screen width, and padding with spaces aligns the
 * pipes exactly.
 *
 * The tidy layout. A tidied row is `| ` + each cell's content padded with
 * trailing spaces to its column width, joined by ` | `, + ` |`. A column's
 * width is the longest content in it, at least 1. The divider fills each
 * cell's whole segment (width + 2) with dashes, with a colon at the left end,
 * the right end, or both for left, right and centre alignment, so the divider
 * lines up with the rows and a minimum-width column still has room for `:-:`.
 * An empty cell in a width-1 column is therefore `|   |`, which is exactly
 * what the toolbar inserts.
 */

export type TableAlignment = 'none' | 'left' | 'center' | 'right'

export interface TableCell {
  /** Offset just after the pipe that opens this cell. */
  from: number
  /** Offset of the pipe that closes this cell, or the line end for an unclosed last cell. */
  to: number
  /** The cell's text with surrounding spaces removed. */
  content: string
  /** Offsets of `content` inside the note; both equal `from` when the cell is blank. */
  contentFrom: number
  contentTo: number
}

export interface TableRow {
  lineFrom: number
  /** Offset of the line's end (the newline, or the end of the text). */
  lineTo: number
  text: string
  /** Whitespace before the leading pipe, kept on every rewrite of the row. */
  indent: string
  cells: TableCell[]
  /** Whether the row ends with a pipe (trailing spaces after it allowed). */
  closed: boolean
}

export interface MarkdownTable {
  rows: TableRow[]
  /** True when rows[1] is a divider with as many cells as rows[0]: a table the renderer shows. */
  hasDivider: boolean
  /** The index of the row containing the offset the table was located from. */
  caretRow: number
}

export const EMPTY_TABLE_ROW = '|   |'

const TABLE_LINE = /^[ \t]*\|/
const DIVIDER_CELL = /^:?-+:?$/

/**
 * The offset where `offset`'s line starts. Not `lastIndexOf('\n', offset - 1)`
 * alone: at offset 0 that searches from -1, which JavaScript clamps to 0, and
 * so finds a newline AT 0 when the text begins with one.
 */
export function lineStartAt(text: string, offset: number): number {
  return offset <= 0 ? 0 : text.lastIndexOf('\n', offset - 1) + 1
}

export function isTableLine(line: string): boolean {
  return TABLE_LINE.test(line)
}

/** Splits one table line into cells. Pipes escaped with a backslash are content. */
export function parseTableRow(text: string, lineFrom: number): TableRow {
  const indentLength = text.length - text.trimStart().length
  const indent = text.slice(0, indentLength)
  const pipePositions: number[] = []
  for (let index = indentLength + 1; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code === 92 /* \ */) {
      index += 1
      continue
    }
    if (code === 124 /* | */) pipePositions.push(index)
  }

  const boundaries = [indentLength, ...pipePositions]
  let closed = false
  let segmentCount = boundaries.length
  // Whatever follows the last pipe is a cell of its own unless it is only
  // whitespace, in which case the row is closed and that remainder is not a cell.
  const lastPipe = boundaries[boundaries.length - 1]
  if (pipePositions.length > 0 && text.slice(lastPipe + 1).trim() === '') {
    closed = true
    segmentCount -= 1
  }

  const cells: TableCell[] = []
  for (let index = 0; index < segmentCount; index += 1) {
    const start = boundaries[index] + 1
    const end = index + 1 < boundaries.length ? boundaries[index + 1] : text.length
    const segment = text.slice(start, end)
    const leading = segment.length - segment.trimStart().length
    const content = segment.trim()
    const contentFrom = content.length > 0 ? lineFrom + start + leading : lineFrom + start
    cells.push({
      from: lineFrom + start,
      to: lineFrom + end,
      content,
      contentFrom,
      contentTo: contentFrom + content.length,
    })
  }

  return { lineFrom, lineTo: lineFrom + text.length, text, indent, cells, closed }
}

export function isDividerRow(row: TableRow): boolean {
  return row.cells.length > 0 && row.cells.every((cell) => DIVIDER_CELL.test(cell.content))
}

export function isBlankRow(row: TableRow): boolean {
  return row.cells.every((cell) => cell.content.length === 0)
}

export function alignmentOf(cell: TableCell): TableAlignment {
  const starts = cell.content.startsWith(':')
  const ends = cell.content.length > 1 && cell.content.endsWith(':')
  if (starts && ends) return 'center'
  if (starts) return 'left'
  if (ends) return 'right'
  return 'none'
}

/**
 * Whether the line is a real table's divider, given the two lines above it:
 * the table's header must be directly above and must not itself be preceded
 * by a table line (it would then be a body row, not the header).
 */
export function isTableDividerLine(line: string, previous: string | null, beforePrevious: string | null): boolean {
  if (!isTableLine(line) || previous === null || !isTableLine(previous)) return false
  if (beforePrevious !== null && isTableLine(beforePrevious)) return false
  const divider = parseTableRow(line, 0)
  return isDividerRow(divider) && divider.cells.length === parseTableRow(previous, 0).cells.length
}

/**
 * The table block around `offset`, or null when that offset's line is not a
 * table line. Walks outwards line by line, so it costs the size of the table,
 * not the size of the note.
 */
export function findTableAt(text: string, offset: number): MarkdownTable | null {
  const caretLineFrom = lineStartAt(text, offset)
  const lineEndAt = (from: number) => {
    const end = text.indexOf('\n', from)
    return end === -1 ? text.length : end
  }
  if (!isTableLine(text.slice(caretLineFrom, lineEndAt(caretLineFrom)))) return null

  let firstFrom = caretLineFrom
  while (firstFrom > 0) {
    const previousFrom = lineStartAt(text, firstFrom - 1)
    if (!isTableLine(text.slice(previousFrom, firstFrom - 1))) break
    firstFrom = previousFrom
  }

  const rows: TableRow[] = []
  let caretRow = 0
  let from = firstFrom
  for (;;) {
    const to = lineEndAt(from)
    const lineText = text.slice(from, to)
    if (!isTableLine(lineText)) break
    if (from === caretLineFrom) caretRow = rows.length
    rows.push(parseTableRow(lineText, from))
    if (to >= text.length) break
    from = to + 1
  }

  const hasDivider = rows.length >= 2
    && isDividerRow(rows[1])
    && rows[1].cells.length === rows[0].cells.length
  return { rows, hasDivider, caretRow }
}

/**
 * The cell an offset on the row belongs to. An offset on a pipe belongs to the
 * cell that pipe closes; one before the leading pipe to the first cell; one
 * past the closing pipe to the last.
 */
export function cellIndexAt(row: TableRow, offset: number): number {
  for (let index = 0; index < row.cells.length; index += 1) {
    if (offset <= row.cells[index].to) return index
  }
  return Math.max(0, row.cells.length - 1)
}

/** Whether a row index holds content (every row but a real table's divider). */
export function isContentRow(table: MarkdownTable, rowIndex: number): boolean {
  return !(table.hasDivider && rowIndex === 1)
}

/** The number of columns the table currently renders with: the header's cell count. */
export function columnCountOf(table: MarkdownTable): number {
  return table.rows[0].cells.length
}

/**
 * Column widths over the content rows, for `columnCount` columns: the longest
 * content in each, at least 1.
 */
export function columnWidthsOf(table: MarkdownTable, columnCount: number): number[] {
  const widths = new Array<number>(columnCount).fill(1)
  table.rows.forEach((row, rowIndex) => {
    if (!isContentRow(table, rowIndex)) return
    row.cells.forEach((cell, column) => {
      if (column < columnCount) widths[column] = Math.max(widths[column], cell.content.length)
    })
  })
  return widths
}

export function renderContentRow(indent: string, contents: readonly string[], widths: readonly number[]): string {
  const cells = widths.map((width, column) => (contents[column] ?? '').padEnd(width))
  return `${indent}| ${cells.join(' | ')} |`
}

/** One divider cell filling a segment of `length` characters. */
export function renderDividerCell(alignment: TableAlignment, length: number): string {
  // A colon needs a dash beside it, and centring needs one between two
  // colons, so a segment too short for the alignment grows to fit it.
  if (alignment === 'none') return '-'.repeat(Math.max(1, length))
  if (alignment === 'left') return `:${'-'.repeat(Math.max(1, length - 1))}`
  if (alignment === 'right') return `${'-'.repeat(Math.max(1, length - 1))}:`
  return `:${'-'.repeat(Math.max(1, length - 2))}:`
}

export function renderDividerRow(indent: string, alignments: readonly TableAlignment[], widths: readonly number[]): string {
  return `${indent}|${widths.map((width, column) => renderDividerCell(alignments[column] ?? 'none', width + 2)).join('|')}|`
}

/**
 * Whether the content row at `rowIndex` stretches the table: more cells than
 * the table has columns, or a cell wider than its column is without this row.
 * Only then does tidying the row have to re-lay out the whole table.
 */
export function rowStretchesTable(table: MarkdownTable, rowIndex: number): boolean {
  const columnCount = columnCountOf(table)
  const row = table.rows[rowIndex]
  if (row.cells.length > columnCount) return true
  const widthsWithout = new Array<number>(columnCount).fill(1)
  table.rows.forEach((other, index) => {
    if (index === rowIndex || !isContentRow(table, index)) return
    other.cells.forEach((cell, column) => {
      if (column < columnCount) widthsWithout[column] = Math.max(widthsWithout[column], cell.content.length)
    })
  })
  return row.cells.some((cell, column) => cell.content.length > widthsWithout[column])
}

/**
 * The row at `rowIndex` padded to the table's columns and widths, with missing
 * cells added. Only for a row that does not stretch the table
 * (rowStretchesTable), whose cells therefore all fit the existing columns.
 */
export function tidyRowText(table: MarkdownTable, rowIndex: number): string {
  const columnCount = columnCountOf(table)
  const widths = columnWidthsOf(table, columnCount)
  const row = table.rows[rowIndex]
  return renderContentRow(row.indent, row.cells.map((cell) => cell.content), widths)
}

/**
 * Every line of the table re-laid out: each row given the widest cell count
 * in the table, every column padded to its widest content, the divider (when
 * there is one) rewritten to fit with its alignments kept. Joined with `\n`,
 * to replace the text from the first row's start to the last row's end.
 */
export function tidyTableText(table: MarkdownTable): string {
  const columnCount = table.rows.reduce(
    (count, row, rowIndex) => (isContentRow(table, rowIndex) ? Math.max(count, row.cells.length) : count),
    0,
  )
  const widths = columnWidthsOf(table, columnCount)
  const alignments = table.hasDivider ? table.rows[1].cells.map(alignmentOf) : []
  return table.rows.map((row, rowIndex) => (
    isContentRow(table, rowIndex)
      ? renderContentRow(row.indent, row.cells.map((cell) => cell.content), widths)
      : renderDividerRow(row.indent, alignments, widths)
  )).join('\n')
}

export function tableFrom(table: MarkdownTable): number {
  return table.rows[0].lineFrom
}

export function tableTo(table: MarkdownTable): number {
  return table.rows[table.rows.length - 1].lineTo
}
