import { describe, expect, it } from 'vitest'
import { nextFieldSelection } from './fieldRightClickSelection'

describe('nextFieldSelection', () => {
  const value = 'hello brave world'
  it('selects the word at a collapsed caret', () => {
    expect(nextFieldSelection(value, 8, 8)).toEqual({ start: 6, end: 11 })
  })
  it('grows a selected word to the whole value', () => {
    expect(nextFieldSelection(value, 6, 11)).toEqual({ start: 0, end: value.length })
  })
  it('stops at the whole value', () => {
    expect(nextFieldSelection(value, 0, value.length)).toBeNull()
  })
  it('goes straight to the whole value from a partial selection', () => {
    expect(nextFieldSelection(value, 7, 9)).toEqual({ start: 6, end: 11 })
    expect(nextFieldSelection(value, 3, 9)).toEqual({ start: 0, end: value.length })
  })
})
