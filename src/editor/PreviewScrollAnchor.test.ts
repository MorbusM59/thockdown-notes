import { describe, expect, it } from 'vitest'
import { resolvePreviewSourceAnchorEntry } from './PreviewScrollAnchor'

describe('resolvePreviewSourceAnchorEntry', () => {
  it('prefers a block that spans the requested source line over an earlier sibling block', () => {
    const entries = [
      { element: {} as HTMLElement, line: 2, lineStart: 2, lineEnd: 8, text: 'intro' },
      { element: {} as HTMLElement, line: 10, lineStart: 10, lineEnd: 14, text: 'body' },
      { element: {} as HTMLElement, line: 15, lineStart: 15, lineEnd: 20, text: 'tail' },
    ]

    const resolved = resolvePreviewSourceAnchorEntry(entries, 12)

    expect(resolved?.text).toBe('body')
    expect(resolved?.lineStart).toBe(10)
    expect(resolved?.lineEnd).toBe(14)
  })

  it('falls back to the nearest earlier block when no block spans the requested line', () => {
    const entries = [
      { element: {} as HTMLElement, line: 2, lineStart: 2, lineEnd: 4, text: 'intro' },
      { element: {} as HTMLElement, line: 8, lineStart: 8, lineEnd: 10, text: 'body' },
    ]

    const resolved = resolvePreviewSourceAnchorEntry(entries, 6)

    expect(resolved?.text).toBe('intro')
  })
})
