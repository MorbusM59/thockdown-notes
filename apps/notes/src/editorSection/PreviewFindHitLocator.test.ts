// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { buildPreviewVisibleDocumentFindHits } from '../editor/FindReplaceEngine'
import {
  resolvePreviewHitRange,
  resolveSourceLineForOffset,
  resolveSourceOffsetRangeForLines,
  collectPreviewElementVisibleText,
} from './PreviewFindHitLocator'

/**
 * Stands in for the preview pane: a scroller holding only the blocks a
 * virtualizer would currently have mounted, each tagged with the source
 * lines it came from exactly the way createPreviewSourceAnchorRehypePlugin
 * tags them. `[label](#id)` renders as a `.note-anchor-marker` span (an
 * anchor definition), which is what makes its label visible text while its
 * target isn't.
 */
function mountPreview(blocks: { html: string; startLine: number; endLine?: number }[]): HTMLElement {
  const scroller = document.createElement('div')
  blocks.forEach(({ html, startLine, endLine }) => {
    const wrapper = document.createElement('div')
    wrapper.innerHTML = html
    const element = wrapper.firstElementChild as HTMLElement
    element.dataset.sourceLine = String(startLine)
    element.dataset.sourceLineStart = String(startLine)
    element.dataset.sourceLineEnd = String(endLine ?? startLine)
    scroller.appendChild(element)
  })
  document.body.replaceChildren(scroller)
  return scroller
}

describe('source line/offset helpers', () => {
  it('resolves the line an offset falls on', () => {
    const text = 'zero\none\ntwo\n'
    expect(resolveSourceLineForOffset(text, 0)).toBe(0)
    expect(resolveSourceLineForOffset(text, text.indexOf('one'))).toBe(1)
    expect(resolveSourceLineForOffset(text, text.indexOf('two'))).toBe(2)
  })

  it('resolves the offset range a line span covers', () => {
    const text = 'zero\none\ntwo\n'
    expect(resolveSourceOffsetRangeForLines(text, 1, 1)).toEqual({ start: 5, end: 9 })
    expect(text.slice(5, 9)).toBe('one\n')
    // A span reaching the last line runs to the end of the document.
    expect(resolveSourceOffsetRangeForLines(text, 2, 2).end).toBe(text.length)
  })
})

describe('collectPreviewElementVisibleText', () => {
  it('separates block-level children instead of running their text together', () => {
    const scroller = mountPreview([{ html: '<li><p>alpha</p><p>beta</p></li>', startLine: 0, endLine: 1 }])
    const { text } = collectPreviewElementVisibleText(scroller.firstElementChild as HTMLElement)
    expect(text).toBe('alpha\nbeta')
  })
})

describe('resolvePreviewHitRange', () => {
  const source = [
    '# The anchor chapter',                                  // line 0
    '',                                                      // line 1
    'First [anchor](#anchor) then anchor again, same line.',  // line 2
    '',                                                      // line 3
    'A much later anchor paragraph.',                        // line 4
    '',
  ].join('\n')

  const hits = buildPreviewVisibleDocumentFindHits(source, 'anchor', false)

  const mountAll = () => mountPreview([
    { html: '<h1>The anchor chapter</h1>', startLine: 0 },
    {
      html: '<p>First <span class="note-anchor-marker" data-anchor-id="anchor">anchor</span> then anchor again, same line.</p>',
      startLine: 2,
    },
    { html: '<p>A much later anchor paragraph.</p>', startLine: 4 },
  ])

  const rangeTextContext = (range: Range): string => {
    const container = range.startContainer.parentElement
    return `${container?.closest('h1,p')?.textContent ?? ''}`
  }

  it('finds the visible hits and only those', () => {
    // Heading, link label, the plain repeat on the same line, and the later
    // paragraph -- the link's `(#anchor)` target contributes nothing.
    expect(hits).toHaveLength(4)
  })

  it('resolves each hit to its own block', () => {
    const scroller = mountAll()
    const blocks = hits.map((hit) => {
      const range = resolvePreviewHitRange({ scroller, sourceText: source, hit, hits, needle: 'anchor', caseSensitive: false })
      return range ? rangeTextContext(range) : null
    })
    expect(blocks[0]).toBe('The anchor chapter')
    expect(blocks[1]).toBe('First anchor then anchor again, same line.')
    expect(blocks[2]).toBe('First anchor then anchor again, same line.')
    expect(blocks[3]).toBe('A much later anchor paragraph.')
  })

  it('tells two occurrences inside one block apart, across the invisible link target', () => {
    const scroller = mountAll()
    const labelHit = hits[1]
    const repeatHit = hits[2]

    const labelRange = resolvePreviewHitRange({ scroller, sourceText: source, hit: labelHit, hits, needle: 'anchor', caseSensitive: false })
    const repeatRange = resolvePreviewHitRange({ scroller, sourceText: source, hit: repeatHit, hits, needle: 'anchor', caseSensitive: false })

    // The first lands inside the anchor-marker span (the link label), the
    // second on the plain repeat after it -- not both on the same one, and
    // not shifted onto the next match by the invisible `(#anchor)` target.
    expect(labelRange?.toString()).toBe('anchor')
    expect(repeatRange?.toString()).toBe('anchor')
    expect(labelRange?.startContainer.parentElement?.className).toBe('note-anchor-marker')
    expect(repeatRange?.startContainer.parentElement?.className).toBe('')
    expect(repeatRange?.startOffset).toBeGreaterThan(0)
  })

  it('returns null when the hit\'s own block is not mounted', () => {
    const scroller = mountPreview([{ html: '<h1>The anchor chapter</h1>', startLine: 0 }])
    const laterHit = hits[3]
    expect(resolvePreviewHitRange({ scroller, sourceText: source, hit: laterHit, hits, needle: 'anchor', caseSensitive: false })).toBeNull()
  })

  it('does not mistake a mounted neighbour for the hit\'s own block', () => {
    // Only the later paragraph is mounted -- a hit belonging to the heading
    // must not resolve into it just because the needle appears there too.
    const scroller = mountPreview([{ html: '<p>A much later anchor paragraph.</p>', startLine: 4 }])
    expect(resolvePreviewHitRange({ scroller, sourceText: source, hit: hits[0], hits, needle: 'anchor', caseSensitive: false })).toBeNull()
  })
})
