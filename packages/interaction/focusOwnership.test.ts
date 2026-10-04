// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mayHoldKeyboard, mayTakeFocusOnPress } from './focusOwnership'

function noteRow(): { row: HTMLElement; button: HTMLButtonElement; icon: HTMLElement } {
  document.body.innerHTML = `
    <div class="note-list-item" data-drag-source="" tabindex="0">
      <span class="title">A note</span>
      <button type="button"><span class="icon"></span></button>
    </div>`
  const row = document.querySelector('.note-list-item') as HTMLElement
  return { row, button: row.querySelector('button')!, icon: row.querySelector('.icon') as HTMLElement }
}

describe('a press', () => {
  it('does not hand the keyboard to a drag source, nor to a button inside one', () => {
    const { row, button, icon } = noteRow()
    expect(mayTakeFocusOnPress(row.querySelector('.title'))).toBe(false)
    expect(mayTakeFocusOnPress(button)).toBe(false)
    expect(mayTakeFocusOnPress(icon)).toBe(false)
  })

  it('lets read-only text take its native press, but not a button inside it', () => {
    document.body.innerHTML = '<div contenteditable="false"><span class="t">x</span><button><i></i></button></div>'
    expect(mayTakeFocusOnPress(document.querySelector('.t'))).toBe(true)
    expect(mayTakeFocusOnPress(document.querySelector('i'))).toBe(false)
  })

  it('always lets text entry take the keyboard', () => {
    document.body.innerHTML = '<div data-drag-source=""><input /></div>'
    expect(mayTakeFocusOnPress(document.querySelector('input'))).toBe(true)
  })
})

describe('who may hold the keyboard', () => {
  it('is the element that declares a tabindex, not a button inside it', () => {
    const { row, button } = noteRow()
    expect(mayHoldKeyboard(row)).toBe(true)
    expect(mayHoldKeyboard(button)).toBe(false)
  })
})
