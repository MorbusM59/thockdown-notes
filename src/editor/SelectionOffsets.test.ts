/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'
import { applySelectionStateToDom, readSelectionStateFromDom } from './SelectionOffsets'

describe('selection offset mapping', () => {
  it('maps selections into the second paragraph without drifting to earlier paragraphs', () => {
    const rootEl = document.createElement('div')
    rootEl.innerHTML = '<p>alpha</p><p>beta</p>'
    document.body.appendChild(rootEl)

    const text = 'alpha\nbeta'
    const selection = {
      anchor: 6,
      focus: 6,
      start: 6,
      end: 6,
      isCollapsed: true,
    }

    const applied = applySelectionStateToDom(rootEl, text, selection)
    expect(applied).toBe(true)

    const readBack = readSelectionStateFromDom(rootEl, window.getSelection(), text.length)
    expect(readBack.anchor).toBe(6)
    expect(readBack.focus).toBe(6)
    expect(readBack.start).toBe(6)
    expect(readBack.end).toBe(6)

    rootEl.remove()
  })

  it('maps selections correctly after an empty paragraph separator', () => {
    const rootEl = document.createElement('div')
    rootEl.innerHTML = '<p>alpha</p><p></p><p>gamma</p>'
    document.body.appendChild(rootEl)

    const text = 'alpha\n\ngamma'
    const selection = {
      anchor: 8,
      focus: 8,
      start: 8,
      end: 8,
      isCollapsed: true,
    }

    const applied = applySelectionStateToDom(rootEl, text, selection)
    expect(applied).toBe(true)

    const readBack = readSelectionStateFromDom(rootEl, window.getSelection(), text.length)
    expect(readBack.anchor).toBe(8)
    expect(readBack.focus).toBe(8)
    expect(readBack.start).toBe(8)
    expect(readBack.end).toBe(8)

    rootEl.remove()
  })
})
