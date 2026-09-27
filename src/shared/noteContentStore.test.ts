import { describe, expect, it } from 'vitest'
import { adoptNoteSummaries, keepIfUnchanged, withSavedNote } from './noteContentStore'
import type { NoteSummary } from './noteLifecycle'

function summary(id: string, extra: Record<string, unknown> = {}): NoteSummary {
  return {
    id, fileName: `${id}.md`, title: id, leadLine: `# ${id}`, tags: [], createdAtMs: 1, updatedAtMs: 1, sizeBytes: 1,
    chapterOnly: false, isAutoToc: false, isAutoOpenItems: false, isTimeless: false,
    chapterParentId: null, detachedChapterParentId: null, chapterId: null,
    ...extra,
  } as NoteSummary
}

describe('adoptNoteSummaries', () => {
  it('moves content out of every summary, from either field, and returns summaries without it', () => {
    const store = new Map<string, string>()
    const adopted = adoptNoteSummaries([summary('a', { contentText: 'alpha' }), summary('b', { text: 'beta', contentText: 'beta' }), summary('c')], store)
    expect(store.get('a')).toBe('alpha')
    expect(store.get('b')).toBe('beta')
    expect(store.has('c')).toBe(false)
    for (const entry of adopted) {
      expect('contentText' in entry).toBe(false)
      expect('text' in entry).toBe(false)
    }
  })

  it('returns the same array when nothing carried content', () => {
    const entries = [summary('a'), summary('b')]
    expect(adoptNoteSummaries(entries, new Map())).toBe(entries)
  })

  it('holds exactly one entry per listed note, whatever sequence of lists arrives', () => {
    const store = new Map<string, string>()
    let seed = 7
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    for (let round = 0; round < 200; round += 1) {
      const ids = ['a', 'b', 'c', 'd', 'e'].filter(() => random() < 0.6)
      const list = ids.map((id) => (random() < 0.5 ? summary(id, { contentText: `${id}${round}` }) : summary(id)))
      const adopted = adoptNoteSummaries(list, store)
      const listed = new Set(adopted.map((entry) => entry.id))
      for (const id of store.keys()) expect(listed.has(id)).toBe(true)
      for (const entry of list) {
        const carried = (entry as { contentText?: string }).contentText
        if (carried !== undefined) expect(store.get(entry.id)).toBe(carried)
      }
    }
  })
})

describe('a save, through the setter App uses', () => {
  // App's setNotes, as a pure function of the list it had.
  const setNotesOnce = (previous: NoteSummary[], store: Map<string, string>, update: (list: NoteSummary[]) => NoteSummary[]) =>
    keepIfUnchanged(adoptNoteSummaries(update(previous), store), previous)

  it('stores the text that was saved, although the saved summary carries none', () => {
    const store = new Map([['a', 'old text']])
    const listed = [summary('a'), summary('b')]
    const saved = summary('a', { updatedAtMs: 2 })
    const next = setNotesOnce(listed, store, (previous) => withSavedNote(previous, saved, 'new text'))
    expect(store.get('a')).toBe('new text')
    expect(next[0]).toEqual(saved)
    expect((next[0] as NoteSummary & { contentText?: string }).contentText).toBeUndefined()
  })

  it('keeps the previous list when only the content changed, so nothing re-renders', () => {
    const store = new Map([['a', 'old text']])
    const listed = [summary('a'), summary('b')]
    const next = setNotesOnce(listed, store, (previous) => withSavedNote(previous, summary('a'), 'new text'))
    expect(next).toBe(listed)
    expect(store.get('a')).toBe('new text')
  })

  it('leaves the list alone for a note that is not listed', () => {
    const listed = [summary('a')]
    expect(withSavedNote(listed, summary('z'), 'text')).toBe(listed)
  })
})
