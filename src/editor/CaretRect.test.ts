/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest'
import { readSelectionRect } from './CaretRect'

function stubRangeTopPx(getTopPx: (range: Range) => number): void {
  // jsdom doesn't implement Range.prototype.getBoundingClientRect at all (no
  // layout engine), so there's nothing for vi.spyOn to wrap -- assign it
  // directly instead.
  Range.prototype.getBoundingClientRect = function (this: Range) {
    const top = getTopPx(this)
    return {
      top,
      bottom: top + 20,
      left: 0,
      right: 10,
      width: 10,
      height: 20,
      x: 0,
      y: top,
      toJSON() { return {} },
    } as DOMRect
  }
}

function collapseCaretAt(node: Node, offset: number): Selection {
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  return selection
}

afterEach(() => {
  delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect
  window.getSelection()?.removeAllRanges()
  document.body.innerHTML = ''
})

describe('readSelectionRect: soft-wrap boundary affinity', () => {
  it('overrides to the new line when the caret sits at an ambiguous wrap boundary', () => {
    const rootEl = document.createElement('div')
    const p = document.createElement('p')
    const textNode = document.createTextNode('abcdef')
    p.appendChild(textNode)
    rootEl.appendChild(p)
    document.body.appendChild(rootEl)

    // Primary (collapsed) rect lands on row 0 -- the wrong, previous line.
    // The real next character ('d', offset 3-4) renders on row 1; the real
    // previous character ('c', offset 2-3) agrees with row 0, confirming the
    // "parked upstream of a wrap" pattern.
    stubRangeTopPx((range) => {
      if (range.collapsed) return 0
      if (range.startOffset === 3 && range.endOffset === 4) return 20
      if (range.startOffset === 2 && range.endOffset === 3) return 0
      return 0
    })

    const selection = collapseCaretAt(textNode, 3)
    const rect = readSelectionRect(selection, 20, rootEl)

    expect(rect?.source).toBe('wrap-boundary-downstream')
    expect(rect?.top).toBe(20)
  })

  it('leaves an unambiguous mid-line caret untouched', () => {
    const rootEl = document.createElement('div')
    const p = document.createElement('p')
    const textNode = document.createTextNode('abcdef')
    p.appendChild(textNode)
    rootEl.appendChild(p)
    document.body.appendChild(rootEl)

    // Every probed rect (collapsed, next-char, prev-char) reports the same row.
    stubRangeTopPx(() => 40)

    const selection = collapseCaretAt(textNode, 3)
    const rect = readSelectionRect(selection, 20, rootEl)

    expect(rect?.source).toBe('primary')
    expect(rect?.top).toBe(40)
  })

  it('does not override for sub-pixel font jitter within the same row', () => {
    const rootEl = document.createElement('div')
    const p = document.createElement('p')
    const textNode = document.createTextNode('abcdef')
    p.appendChild(textNode)
    rootEl.appendChild(p)
    document.body.appendChild(rootEl)

    // Reproduces the Lekton-font case from BlockCaretPlugin's own comment:
    // 311px measured against a clean 312px row boundary, lineHeight 26 --
    // both round to the same row index (12), so no override should apply.
    stubRangeTopPx((range) => {
      if (range.collapsed) return 311
      if (range.startOffset === 3 && range.endOffset === 4) return 312
      if (range.startOffset === 2 && range.endOffset === 3) return 311
      return 311
    })

    const selection = collapseCaretAt(textNode, 3)
    const rect = readSelectionRect(selection, 26, rootEl)

    expect(rect?.source).toBe('primary')
    expect(rect?.top).toBe(311)
  })

  it('tunnels through wrapper spans to find the real next character', () => {
    const rootEl = document.createElement('div')
    const p = document.createElement('p')
    const spanA = document.createElement('span')
    const textA = document.createTextNode('abc')
    spanA.appendChild(textA)
    const spanB = document.createElement('span')
    const textB = document.createTextNode('def')
    spanB.appendChild(textB)
    p.appendChild(spanA)
    p.appendChild(spanB)
    rootEl.appendChild(p)
    document.body.appendChild(rootEl)

    // Caret sits at the end of the first span's text node -- ambiguous
    // boundary between two Lexical TextNode spans (e.g. across a
    // syntax-highlighted token boundary), not within a single Text node.
    stubRangeTopPx((range) => {
      if (range.collapsed) return 0
      if (range.startContainer === textB && range.startOffset === 0 && range.endOffset === 1) return 20
      if (range.startContainer === textA && range.startOffset === 2 && range.endOffset === 3) return 0
      return 0
    })

    const selection = collapseCaretAt(textA, 3)
    const rect = readSelectionRect(selection, 20, rootEl)

    expect(rect?.source).toBe('wrap-boundary-downstream')
    expect(rect?.top).toBe(20)
  })

  it('does not tunnel through a <br> hard break (shift+Enter)', () => {
    const rootEl = document.createElement('div')
    const p = document.createElement('p')
    const textA = document.createTextNode('abc')
    const br = document.createElement('br')
    const textB = document.createTextNode('def')
    p.appendChild(textA)
    p.appendChild(br)
    p.appendChild(textB)
    rootEl.appendChild(p)
    document.body.appendChild(rootEl)

    // Caret at the end of "abc", immediately before the <br>. This is a real,
    // unambiguous hard line break -- the caret belongs on this (upstream) row,
    // and must not be pulled onto the row after the <br>.
    stubRangeTopPx((range) => {
      if (range.collapsed) return 100
      // If the guard failed and the walk tunneled past the <br>, it would
      // measure "def"'s first character on a different row -- assert the
      // override is never even attempted by making that look ambiguous.
      if (range.startContainer === textB) return 120
      return 100
    })

    const selection = collapseCaretAt(textA, 3)
    const rect = readSelectionRect(selection, 20, rootEl)

    expect(rect?.source).toBe('primary')
    expect(rect?.top).toBe(100)
  })
})
