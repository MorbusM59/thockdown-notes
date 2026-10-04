import { describe, expect, it } from 'vitest'
import { resolveBoxDragSelection } from './boxPointer'

// Every box one character wide, no line ends in reach.
const oneCharBoxes = (pos: number) => pos + 1

describe('resolveBoxDragSelection', () => {
  it('is a caret on the pressed box for a plain click', () => {
    expect(resolveBoxDragSelection(5, 5, oneCharBoxes, null)).toEqual({ anchor: 5, head: 5 })
  })

  it('includes the box under the pointer when dragging forward', () => {
    expect(resolveBoxDragSelection(2, 5, oneCharBoxes, null)).toEqual({ anchor: 2, head: 6 })
  })

  it('includes the pressed box when dragging backward', () => {
    expect(resolveBoxDragSelection(5, 2, oneCharBoxes, null)).toEqual({ anchor: 6, head: 2 })
  })

  it('selects both boxes when dragging onto the neighbouring box', () => {
    expect(resolveBoxDragSelection(4, 5, oneCharBoxes, null)).toEqual({ anchor: 4, head: 6 })
    expect(resolveBoxDragSelection(5, 4, oneCharBoxes, null)).toEqual({ anchor: 6, head: 4 })
  })

  it('never runs on across a line break at the empty box past a line end', () => {
    // A line ending at 10: the box at 10 is the empty one past its last character.
    const lineEndingAt10 = (pos: number) => (pos === 10 ? 10 : pos + 1)
    expect(resolveBoxDragSelection(8, 10, lineEndingAt10, null)).toEqual({ anchor: 8, head: 10 })
    expect(resolveBoxDragSelection(10, 8, lineEndingAt10, null)).toEqual({ anchor: 10, head: 8 })
  })

  it('extends from the existing anchor through the box clicked', () => {
    expect(resolveBoxDragSelection(7, 7, oneCharBoxes, 3)).toEqual({ anchor: 3, head: 8 })
    expect(resolveBoxDragSelection(1, 1, oneCharBoxes, 3)).toEqual({ anchor: 3, head: 1 })
  })
})
