import type { EditorSelectionState, EditorTransformResult } from './EditorContract'
import { buildTransformResult, collapsedSelectionAt } from './TransformResult'
import { resolveWordRange } from './ContractBridgeRangeUtils'
import {
  EMPTY_TABLE_ROW,
  alignmentOf,
  cellIndexAt,
  columnCountOf,
  columnWidthsOf,
  deleteGridColumn,
  findTableAt,
  gridOf,
  gridRowOfTableRow,
  isBlankRow,
  isContentRow,
  lineStartAt,
  moveGridColumn,
  moveGridRow,
  renderGrid,
  renderContentRow,
  renderDividerCell,
  renderDividerRow,
  rowStretchesTable,
  tableFrom,
  tableRowOfGridRow,
  tableTo,
  tidyRowText,
  tidyTableText,
  type MarkdownTable,
  type TableAlignment,
  type TableGrid,
  type TableCell,
} from './MarkdownTable'

/**
 * The edit view's table input rules. Each is a pure transform of the note
 * text and selection, like every other smart key in this editor, and each
 * returns null whenever its condition does not hold so that the key does
 * whatever it would do anywhere else.
 *
 * The standing rule these are written to: a keystroke is interpreted only
 * when a clear, visible, local condition holds (the caret is in a table
 * line, the cell is blank, ...), and the only rewriting of text the reader
 * did not type is the tidy that Enter and the toolbar button perform. The
 * caret is never moved or held anywhere it was not sent; plain Backspace
 * and Delete are never touched. See the User Guide's table chapter
 * (electron/help/helpGuideContent.ts) for the same rules as a reader sees
 * them.
 *
 * Every transform takes `isInFencedCodeBlock`, asked only once the cheaper
 * table checks have passed: a pipe line inside a code block is code, not a
 * table.
 */

type FenceCheck = (offset: number) => boolean

interface CellAddress {
  row: number
  column: number
}

/**
 * Where the caret goes when it is sent to a cell: onto the first content box
 * of a blank cell (the middle box of `|   |`), or just after the content of
 * a filled one, ready to add to it.
 */
function caretOffsetInCell(cell: TableCell): number {
  if (cell.content.length > 0) return cell.contentTo
  return firstContentBox(cell)
}

function firstContentBox(cell: TableCell): number {
  return cell.to - cell.from >= 2 ? cell.from + 1 : cell.from
}

function contentRowIndices(table: MarkdownTable): number[] {
  return table.rows.map((_, index) => index).filter((index) => isContentRow(table, index))
}

function previousCell(table: MarkdownTable, from: CellAddress): CellAddress | null {
  if (from.column > 0) return { row: from.row, column: from.column - 1 }
  const rows = contentRowIndices(table).filter((index) => index < from.row)
  if (rows.length === 0) return null
  const row = rows[rows.length - 1]
  return { row, column: table.rows[row].cells.length - 1 }
}

function nextContentRow(table: MarkdownTable, after: number): number | null {
  return contentRowIndices(table).find((index) => index > after) ?? null
}

function moveCaret(text: string, offset: number): EditorTransformResult {
  return buildTransformResult(text, { from: offset, to: offset, insert: '' }, collapsedSelectionAt(offset))
}

function caretTo(text: string, table: MarkdownTable, address: CellAddress): EditorTransformResult {
  return moveCaret(text, caretOffsetInCell(table.rows[address.row].cells[address.column]))
}

/** The table and the caret's place in it, or null when the caret is not in a table line outside code. */
function locate(text: string, selection: EditorSelectionState, isInFencedCodeBlock: FenceCheck) {
  if (!selection.isCollapsed) return null
  const table = findTableAt(text, selection.focus)
  if (!table || isInFencedCodeBlock(selection.focus)) return null
  const row = table.rows[table.caretRow]
  return { table, row, column: cellIndexAt(row, selection.focus) }
}

/**
 * The tidy done when the caret LEAVES a row of a real table -- by Enter, or
 * by Tab / Shift+Tab crossing into another row. One rule for all three: the
 * row alone is padded to the table's columns, unless it stretches the table
 * (more cells than it has columns, or a cell wider than its column), in which
 * case the whole table is re-laid out. Returns that step (null when it would
 * change nothing, so no empty undo entry is made) and the table read again
 * from the tidied text, since the tidy may have moved every line of it; a
 * tidy never adds or removes rows, so row indices carry across.
 *
 * Nothing is tidied in a block that is not yet a table (no divider): its
 * columns are not defined yet.
 */
function tidyRowBeingLeft(
  text: string,
  table: MarkdownTable,
  rowIndex: number,
): { prelude: EditorTransformResult | null; table: MarkdownTable } | null {
  if (!table.hasDivider || !isContentRow(table, rowIndex)) return { prelude: null, table }
  const row = table.rows[rowIndex]
  const prelude = rowStretchesTable(table, rowIndex)
    ? replaceIfChanged(text, tableFrom(table), tableTo(table), tidyTableText(table))
    : replaceIfChanged(text, row.lineFrom, row.lineTo, tidyRowText(table, rowIndex))
  if (!prelude) return { prelude: null, table }
  const tidied = findTableAt(prelude.text, tableFrom(table))
  return tidied ? { prelude, table: tidied } : null
}

/**
 * Tab moves to the next cell. In the last cell it adds a cell while the row
 * is still short of the table's columns (always, before the divider exists,
 * since the header row is what defines them); a full row instead goes on to
 * the next row, and past the last row a new one-cell row is started. Shift+Tab
 * moves to the previous cell. At the very first cell Shift+Tab is swallowed
 * rather than falling through to outdenting a table line.
 *
 * Crossing into another row, either way, tidies the row being left
 * (tidyRowBeingLeft) as its own undo step. Moves within a row tidy nothing.
 */
export function resolveTableTabTransform(
  event: { shiftKey: boolean; text: string; selection: EditorSelectionState },
  isInFencedCodeBlock: FenceCheck,
): EditorTransformResult | null {
  const { text, shiftKey } = event
  const located = locate(text, event.selection, isInFencedCodeBlock)
  if (!located) return null
  const { table, row, column } = located
  const rowIndex = table.caretRow

  if (!isContentRow(table, rowIndex)) {
    // On the divider: step to the header's last cell, or the first body row.
    if (shiftKey) return caretTo(text, table, { row: 0, column: table.rows[0].cells.length - 1 })
    const next = nextContentRow(table, rowIndex)
    return next === null ? moveCaret(text, event.selection.focus) : caretTo(text, table, { row: next, column: 0 })
  }

  if (shiftKey) {
    const previous = previousCell(table, { row: rowIndex, column })
    if (!previous) return moveCaret(text, event.selection.focus)
    if (previous.row === rowIndex) return caretTo(text, table, previous)
    const left = tidyRowBeingLeft(text, table, rowIndex)
    if (!left) return null
    // Read the target in the tidied table: a whole-table tidy may have given
    // the previous row more cells, and its last cell is where the caret goes.
    const target = previousCell(left.table, { row: rowIndex, column: 0 })!
    return withPrelude(left.prelude, caretTo(left.prelude?.text ?? text, left.table, target))
  }

  if (column < row.cells.length - 1) return caretTo(text, table, { row: rowIndex, column: column + 1 })

  const columnCount = table.hasDivider ? columnCountOf(table) : Number.POSITIVE_INFINITY
  if (row.cells.length < columnCount) {
    const lastCell = row.cells[row.cells.length - 1]
    if (row.closed) {
      const at = lastCell.to + 1
      return buildTransformResult(text, { from: at, to: at, insert: '   |' }, collapsedSelectionAt(at + 1))
    }
    const separator = row.text.endsWith(' ') ? '' : ' '
    const insert = `${separator}|   |`
    return buildTransformResult(
      text,
      { from: row.lineTo, to: row.lineTo, insert },
      collapsedSelectionAt(row.lineTo + separator.length + 2),
    )
  }

  const left = tidyRowBeingLeft(text, table, rowIndex)
  if (!left) return null
  const afterTidy = left.prelude?.text ?? text
  const next = nextContentRow(left.table, rowIndex)
  if (next !== null) return withPrelude(left.prelude, caretTo(afterTidy, left.table, { row: next, column: 0 }))
  const tidiedRow = left.table.rows[rowIndex]
  return withPrelude(left.prelude, appendRowAfter(afterTidy, tidiedRow.lineTo))
}

function appendRowAfter(text: string, lineTo: number): EditorTransformResult {
  const insert = `\n${EMPTY_TABLE_ROW}`
  return buildTransformResult(
    text,
    { from: lineTo, to: lineTo, insert },
    collapsedSelectionAt(lineTo + 3),
  )
}

/** `main`, preceded by `prelude` as its own undo step when there is one. */
function withPrelude(prelude: EditorTransformResult | null, main: EditorTransformResult): EditorTransformResult {
  return prelude ? { ...main, prelude } : main
}

/** Null when the range already reads `insert`, so an unchanged tidy never becomes an undo step. */
function replaceIfChanged(text: string, from: number, to: number, insert: string): EditorTransformResult | null {
  if (text.slice(from, to) === insert) return null
  return buildTransformResult(text, { from, to, insert }, collapsedSelectionAt(from + insert.length))
}

/**
 * Enter in a table.
 *
 * On a header with no divider yet: a single blank cell cancels the table
 * (the line is emptied); anything else gets a divider sized to it and a new
 * one-cell row below, the caret in that cell. Two or more blank cells make a
 * headless table, which is simply a table whose header is blank.
 *
 * In a table that has its divider: a blank last row is emptied, which ends
 * the table. Any other row is tidied and a new one-cell row is started below
 * it (below the divider, from the header). The row is tidied as it is left
 * (tidyRowBeingLeft), as its own undo step, so undo first takes back the new
 * row and leaves the tidy.
 *
 * A block of pipe lines whose second line is not a divider is not a table,
 * and Enter there is an ordinary Enter.
 */
export function resolveTableEnterTransform(
  event: { text: string; selection: EditorSelectionState },
  isInFencedCodeBlock: FenceCheck,
): EditorTransformResult | null {
  const { text } = event
  const located = locate(text, event.selection, isInFencedCodeBlock)
  if (!located) return null
  const { table, row } = located
  const rowIndex = table.caretRow

  if (!table.hasDivider) {
    if (table.rows.length !== 1) return null
    if (row.cells.length === 1 && isBlankRow(row)) {
      return buildTransformResult(text, { from: row.lineFrom, to: row.lineTo, insert: '' }, collapsedSelectionAt(row.lineFrom))
    }
    const widths = columnWidthsOf(table, row.cells.length)
    const header = renderContentRow(row.cells.map((cell) => cell.content), widths)
    const prelude = replaceIfChanged(text, row.lineFrom, row.lineTo, header)
    const afterPrelude = prelude ? prelude.text : text
    const headerEnd = row.lineFrom + header.length
    const divider = renderDividerRow(row.cells.map((): TableAlignment => 'none'), widths)
    const insert = `\n${divider}\n${EMPTY_TABLE_ROW}`
    const main = buildTransformResult(
      afterPrelude,
      { from: headerEnd, to: headerEnd, insert },
      collapsedSelectionAt(headerEnd + insert.length - EMPTY_TABLE_ROW.length + 2),
    )
    return withPrelude(prelude, main)
  }

  const isLastRow = rowIndex === table.rows.length - 1
  if (isContentRow(table, rowIndex) && rowIndex >= 2 && isLastRow && isBlankRow(row)) {
    return buildTransformResult(text, { from: row.lineFrom, to: row.lineTo, insert: '' }, collapsedSelectionAt(row.lineFrom))
  }

  const left = tidyRowBeingLeft(text, table, rowIndex)
  if (!left) return null
  const anchorRow = left.table.rows[Math.max(rowIndex, 1)]
  return withPrelude(left.prelude, appendRowAfter(left.prelude?.text ?? text, anchorRow.lineTo))
}

/**
 * Typing into a blank cell puts the character on the cell's first content
 * box, replacing the space there, wherever in the cell the caret was: so
 * `|   |` becomes `| x |` from any of its three spaces, and a blank cell in a
 * wider column keeps its width. Only a cell of nothing but spaces, at least
 * three of them, and only with the caret on one of those spaces (not on a
 * pipe). Anywhere else a character is inserted where the caret is.
 */
export function resolveTableCharacterTransform(
  event: { char: string; text: string; selection: EditorSelectionState },
  isInFencedCodeBlock: FenceCheck,
): EditorTransformResult | null {
  const { text, selection } = event
  if (!selection.isCollapsed) return null
  // Cheapest test first: this runs on every character typed anywhere.
  if (text.charCodeAt(selection.focus) !== 32 && text.charCodeAt(selection.focus - 1) !== 32) return null
  const located = locate(text, selection, isInFencedCodeBlock)
  if (!located) return null
  const cell = located.row.cells[located.column]
  if (selection.focus < cell.from || selection.focus >= cell.to) return null
  if (cell.to - cell.from < 3 || /[^ ]/.test(text.slice(cell.from, cell.to))) return null
  return buildTransformResult(
    text,
    { from: cell.from + 1, to: cell.from + 2, insert: event.char },
    collapsedSelectionAt(cell.from + 1 + event.char.length),
  )
}

/**
 * The two modified Backspaces in a table. Plain Backspace and Delete are not
 * handled here and stay one character at a time.
 *
 * Shift+Backspace clears the caret's cell, keeping its width; in a cell that
 * is already blank it moves to the previous cell instead.
 *
 * Ctrl+Backspace is still word delete. Only at the start of a cell (or in a
 * blank one), where word delete would otherwise eat the pipe, it deletes the
 * last word of the previous cell instead and leaves the caret there. With no
 * previous cell it does what it does anywhere else.
 */
export function resolveTableDeleteTransform(
  event: { modifier: 'shift' | 'ctrl'; text: string; selection: EditorSelectionState },
  isInFencedCodeBlock: FenceCheck,
): EditorTransformResult | null {
  const { text } = event
  const located = locate(text, event.selection, isInFencedCodeBlock)
  if (!located) return null
  const { table, row, column } = located
  if (!isContentRow(table, table.caretRow)) return null
  const cell = row.cells[column]
  const focus = event.selection.focus

  if (event.modifier === 'shift') {
    if (cell.content.length > 0) {
      const blank = ' '.repeat(cell.to - cell.from)
      return buildTransformResult(
        text,
        { from: cell.from, to: cell.to, insert: blank },
        collapsedSelectionAt(firstContentBox(cell)),
      )
    }
    const previous = previousCell(table, { row: table.caretRow, column })
    return previous ? caretTo(text, table, previous) : moveCaret(text, focus)
  }

  if (cell.content.length > 0 && focus > cell.contentFrom) return null
  const previous = previousCell(table, { row: table.caretRow, column })
  if (!previous) return null
  const target = table.rows[previous.row].cells[previous.column]
  const lastWord = /\S+$/.exec(target.content)
  if (!lastWord) return caretTo(text, table, previous)
  const from = target.contentTo - lastWord[0].length
  return buildTransformResult(text, { from, to: target.contentTo, insert: '' }, collapsedSelectionAt(from))
}

/**
 * A click on a table's divider sets that column's alignment from where in
 * the divider cell the click landed: the left part aligns left, the middle
 * centres, the right part aligns right. Clicking the part matching the
 * column's current alignment resets it. Decided from the divider's state,
 * not from click history, so the same click always does the same thing.
 * Clicks on the divider's pipes, and on dividers that are not a table's
 * second line, are ordinary clicks.
 */
export function resolveTableDividerPress(
  event: { text: string; clickOffset: number },
  isInFencedCodeBlock: FenceCheck,
): { click: EditorTransformResult; hold: EditorTransformResult } | null {
  const { text, clickOffset } = event
  const table = findTableAt(text, clickOffset)
  if (!table || !table.hasDivider || table.caretRow !== 1) return null
  const row = table.rows[1]
  const cell = row.cells[cellIndexAt(row, clickOffset)]
  if (clickOffset < cell.from || clickOffset >= cell.to) return null
  if (isInFencedCodeBlock(clickOffset)) return null

  const length = cell.to - cell.from
  const position = clickOffset - cell.from
  const side = Math.max(1, Math.floor(length / 3))
  const target: TableAlignment = position < side ? 'left' : position >= length - side ? 'right' : 'center'
  const next = alignmentOf(cell) === target ? 'none' : target
  const insert = renderDividerCell(next, length)
  const click = {
    ...buildTransformResult(
      text,
      { from: cell.from, to: cell.to, insert },
      collapsedSelectionAt(Math.min(clickOffset, cell.from + insert.length - 1)),
    ),
    isolated: true,
  }
  return { click, hold: deleteColumn(text, table, cellIndexAt(row, clickOffset), 0) }
}

/**
 * The table re-laid out from `grid`, with the caret (or, when `selectCell`,
 * the cell's content selected) in the cell at `gridRow`/`column` of the
 * result. Every structural edit ends here, so all of them leave a tidy table
 * and none of them has its own idea of where the caret goes.
 */
function replaceTableWithGrid(
  text: string,
  table: MarkdownTable,
  grid: TableGrid,
  gridRow: number,
  column: number,
  selectCell: boolean,
): EditorTransformResult {
  const from = tableFrom(table)
  const insert = renderGrid(grid)
  const nextText = text.slice(0, from) + insert + text.slice(tableTo(table))
  const next = findTableAt(nextText, from)!
  const row = next.rows[tableRowOfGridRow(next, gridRow)]
  const cell = row.cells[Math.min(column, row.cells.length - 1)]
  const selection = selectCell && cell.content.length > 0
    ? { anchor: cell.contentFrom, focus: cell.contentTo, start: cell.contentFrom, end: cell.contentTo, isCollapsed: false }
    : collapsedSelectionAt(caretOffsetInCell(cell))
  return { ...buildTransformResult(text, { from, to: tableTo(table), insert }, selection), isolated: true }
}

/**
 * Deletes a column from every row, the header and the divider included, and
 * tidies what is left. Deleting a table's only column deletes the table,
 * together with the line break that separated it from what follows (or,
 * at the end of the note, from what precedes it).
 */
function deleteColumn(text: string, table: MarkdownTable, column: number, gridRow: number): EditorTransformResult {
  const grid = deleteGridColumn(gridOf(table), column)
  if (grid) return replaceTableWithGrid(text, table, grid, gridRow, column, false)
  const from = tableFrom(table)
  const to = tableTo(table)
  if (to < text.length) {
    return { ...buildTransformResult(text, { from, to: to + 1, insert: '' }, collapsedSelectionAt(from)), isolated: true }
  }
  const start = Math.max(0, from - 1)
  return { ...buildTransformResult(text, { from: start, to, insert: '' }, collapsedSelectionAt(start)), isolated: true }
}

/**
 * Ctrl+Shift+Backspace in a table: deletes the caret's column (see
 * deleteColumn). The column-wide step of the Backspace ladder -- a
 * character, Shift a cell, Ctrl+Shift the column.
 */
export function resolveTableDeleteColumnTransform(
  event: { text: string; selection: EditorSelectionState },
  isInFencedCodeBlock: FenceCheck,
): EditorTransformResult | null {
  const table = findTableAt(event.text, event.selection.start)
  if (!table || !table.hasDivider || isInFencedCodeBlock(event.selection.start)) return null
  const row = table.rows[table.caretRow]
  const gridRow = isContentRow(table, table.caretRow) ? gridRowOfTableRow(table, table.caretRow) : 0
  return deleteColumn(event.text, table, cellIndexAt(row, event.selection.start), gridRow)
}

export type TableMoveDirection = 'left' | 'right' | 'up' | 'down'

/**
 * Ctrl+Shift+Arrow in a table moves the caret's column (left/right) or row
 * (up/down) one step, and the caret goes with it. When the whole content of
 * a cell is selected -- which is what the right-click ladder's second step
 * gives -- the selection travels with the cell, so a cell can be walked to
 * where it belongs one arrow at a time.
 *
 * A row moves among the content rows, the divider staying where it is: a
 * row moved to the top becomes the header. A column takes its alignment
 * with it. The whole table is re-laid out (renderGrid), as a tidy would.
 * At the table's edge the key is swallowed rather than falling through to
 * its ordinary meaning, which would extend a selection out of the table.
 */
export function resolveTableMoveTransform(
  event: { direction: TableMoveDirection; text: string; selection: EditorSelectionState },
  isInFencedCodeBlock: FenceCheck,
): EditorTransformResult | null {
  const { text, selection, direction } = event
  const table = findTableAt(text, selection.start)
  if (!table || !table.hasDivider || isInFencedCodeBlock(selection.start)) return null
  if (selection.end > tableTo(table)) return null
  const row = table.rows[table.caretRow]
  const column = cellIndexAt(row, selection.start)
  const unchanged = buildTransformResult(text, { from: selection.start, to: selection.start, insert: '' }, selection)
  const grid = gridOf(table)
  const cell = row.cells[column]
  const selectCell = !selection.isCollapsed && selection.start === cell.contentFrom && selection.end === cell.contentTo

  if (direction === 'left' || direction === 'right') {
    const columnCount = grid.rows.reduce((count, cells) => Math.max(count, cells.length), 0)
    const target = column + (direction === 'left' ? -1 : 1)
    if (target < 0 || target >= columnCount) return unchanged
    const gridRow = isContentRow(table, table.caretRow) ? gridRowOfTableRow(table, table.caretRow) : 0
    return replaceTableWithGrid(text, table, moveGridColumn(grid, column, target), gridRow, target, selectCell)
  }

  if (!isContentRow(table, table.caretRow)) return unchanged
  const gridRow = gridRowOfTableRow(table, table.caretRow)
  const target = gridRow + (direction === 'up' ? -1 : 1)
  if (target < 0 || target >= grid.rows.length) return unchanged
  return replaceTableWithGrid(text, table, moveGridRow(grid, gridRow, target), target, column, selectCell)
}

/**
 * The right-click ladder inside a table: word, cell, row, table. Replaces
 * the prose ladder (word, clause, sentence, line, block) there, whose steps
 * run straight across the pipes. Stateless: a right-click inside the current
 * selection takes the next step that strictly contains it; any other
 * right-click starts from the smallest step at the click. The word step is
 * clipped to the cell and skipped where the click is not on a word; a
 * cell's step is its content, or the spaces between its pipes when it is
 * empty. Null when the click is not in a table line outside code, so the
 * prose ladder runs.
 */
export function resolveTableSelectionStep(
  event: { text: string; clickOffset: number; selection: EditorSelectionState },
  isInFencedCodeBlock: FenceCheck,
): { start: number; end: number } | null {
  const { text, clickOffset, selection } = event
  const table = findTableAt(text, clickOffset)
  if (!table || isInFencedCodeBlock(clickOffset)) return null
  const row = table.rows[table.caretRow]
  const cell = row.cells[cellIndexAt(row, clickOffset)]

  const steps: Array<{ start: number; end: number }> = []
  const cellStep = cell.content.length > 0
    ? { start: cell.contentFrom, end: cell.contentTo }
    : { start: cell.from, end: cell.to }
  if (cell.content.length > 0 && clickOffset >= cell.contentFrom && clickOffset < cell.contentTo) {
    const word = resolveWordRange(text, clickOffset)
    const start = Math.max(word.start, cell.contentFrom)
    const end = Math.min(word.end, cell.contentTo)
    if (end > start) steps.push({ start, end })
  }
  steps.push(cellStep)
  // The row and the table start at their leading pipe, past any indentation.
  steps.push({ start: row.cells[0].from - 1, end: row.lineTo })
  steps.push({ start: table.rows[0].cells[0].from - 1, end: tableTo(table) })

  const inside = !selection.isCollapsed && clickOffset >= selection.start && clickOffset < selection.end
  if (inside) {
    const larger = steps.find((step) => (
      step.start <= selection.start && step.end >= selection.end
      && (step.start !== selection.start || step.end !== selection.end)
    ))
    return larger ?? { start: selection.start, end: selection.end }
  }
  return steps[0]
}

/**
 * The toolbar's table button. Inside a table it tidies the whole table and
 * keeps the caret in the same cell. Anywhere else it starts a table: `|   |`
 * on the caret's line if that line is empty, otherwise on a new line below
 * it, with the caret in the cell. A table swallows a text line directly
 * below it as a row, so when the next line has text a blank line is left
 * between them. (A text line directly ABOVE a table does not join it, so no
 * blank line is needed there.)
 */
export function resolveTableToolbarTransform(
  event: { text: string; selection: EditorSelectionState },
  isInFencedCodeBlock: FenceCheck,
): EditorTransformResult | null {
  const { text, selection } = event
  const caret = selection.focus
  const table = findTableAt(text, caret)
  if (table && !isInFencedCodeBlock(caret)) {
    const row = table.rows[table.caretRow]
    const column = cellIndexAt(row, caret)
    const tidiedText = tidyTableText(table)
    const from = tableFrom(table)
    const result = replaceIfChanged(text, from, tableTo(table), tidiedText)
    if (!result) return moveCaret(text, caret)
    const tidied = findTableAt(result.text, from)
    const tidiedRow = tidied?.rows[table.caretRow]
    if (!tidied || !tidiedRow) return result
    const cell = tidiedRow.cells[Math.min(column, tidiedRow.cells.length - 1)]
    const offset = isContentRow(tidied, table.caretRow) ? caretOffsetInCell(cell) : cell.from
    return { ...result, selection: collapsedSelectionAt(offset) }
  }

  const lineFrom = lineStartAt(text, caret)
  const newline = text.indexOf('\n', caret)
  const lineTo = newline === -1 ? text.length : newline
  const lineIsEmpty = text.slice(lineFrom, lineTo).trim() === ''
  const followingLineFrom = lineTo + 1
  const followingNewline = text.indexOf('\n', followingLineFrom)
  const followingLine = followingLineFrom > text.length
    ? ''
    : text.slice(followingLineFrom, followingNewline === -1 ? text.length : followingNewline)
  const trailing = followingLine.trim() !== '' ? '\n' : ''

  if (lineIsEmpty) {
    return buildTransformResult(
      text,
      { from: lineFrom, to: lineTo, insert: `${EMPTY_TABLE_ROW}${trailing}` },
      collapsedSelectionAt(lineFrom + 2),
    )
  }
  return buildTransformResult(
    text,
    { from: lineTo, to: lineTo, insert: `\n${EMPTY_TABLE_ROW}${trailing}` },
    collapsedSelectionAt(lineTo + 3),
  )
}
