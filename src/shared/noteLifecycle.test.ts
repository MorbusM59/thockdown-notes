import { describe, expect, it } from 'vitest'
import { isSameNoteSummary, type NoteSummary } from './noteLifecycle'

function baseSummary(overrides: Partial<NoteSummary> = {}): NoteSummary {
  return {
    id: 'note-1',
    fileName: 'note-1.md',
    title: 'Note One',
    tags: [],
    createdAtMs: 1000,
    updatedAtMs: 1000,
    sizeBytes: 42,
    chapterOnly: false,
    isAutoToc: false,
    chapterParentId: null,
    ...overrides,
  }
}

describe('isSameNoteSummary', () => {
  it('treats identical summaries as the same', () => {
    expect(isSameNoteSummary(baseSummary(), baseSummary())).toBe(true)
  })

  // Regression: assignedId used to be excluded from this comparison, so
  // App.tsx's mergeNoteSummaries would treat an assignedId-only change as
  // "nothing changed" and keep the stale cached summary -- silently
  // reverting a freshly-assigned $id the next time notes refreshed (which
  // happens constantly: tag edits, note switches, chapter operations, ...),
  // since assigning an id doesn't itself bump updatedAtMs either.
  it('detects an assignedId-only change', () => {
    const a = baseSummary({ assignedId: null })
    const b = baseSummary({ assignedId: 'FOO' })
    expect(isSameNoteSummary(a, b)).toBe(false)
  })

  it('treats a missing and a null assignedId as equivalent', () => {
    const a = baseSummary({ assignedId: undefined })
    const b = baseSummary({ assignedId: null })
    expect(isSameNoteSummary(a, b)).toBe(true)
  })

  it('detects a chapterOnly-only change', () => {
    const a = baseSummary({ chapterOnly: false })
    const b = baseSummary({ chapterOnly: true })
    expect(isSameNoteSummary(a, b)).toBe(false)
  })

  it('detects a chapterParentId-only change', () => {
    const a = baseSummary({ chapterParentId: null })
    const b = baseSummary({ chapterParentId: 'parent-1' })
    expect(isSameNoteSummary(a, b)).toBe(false)
  })
})
