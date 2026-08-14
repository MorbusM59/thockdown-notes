import { describe, expect, it } from 'vitest'
import { resolveChapterLinkIds } from './tabLabels'

describe('resolveChapterLinkIds', () => {
  it('uses an explicitly assigned chapterId as-is', () => {
    const result = resolveChapterLinkIds([
      { chapterNoteId: 'ch-1', chapterId: 'AGENDA', contentText: '# Chapter One' },
    ])
    expect(result.get('ch-1')).toBe('AGENDA')
  })

  it('derives a live stand-in from the content snippet for an unassigned chapter', () => {
    const result = resolveChapterLinkIds([
      { chapterNoteId: 'ch-1', chapterId: null, contentText: '# Chapter One\n\nBody.' },
    ])
    expect(result.get('ch-1')).toBe('CHAPTER')
  })

  it('dedupes two unassigned siblings that derive the same stand-in id, in order', () => {
    const result = resolveChapterLinkIds([
      { chapterNoteId: 'ch-1', chapterId: null, contentText: '# Chapter One' },
      { chapterNoteId: 'ch-2', chapterId: null, contentText: '# Chapter Two' },
    ])
    expect(result.get('ch-1')).toBe('CHAPTER')
    expect(result.get('ch-2')).toBe('CHAPTER-2')
  })

  it('an unassigned chapter never silently reuses another chapter\'s explicitly assigned id', () => {
    const result = resolveChapterLinkIds([
      { chapterNoteId: 'ch-1', chapterId: 'CHAPTER', contentText: '# Something Else' },
      { chapterNoteId: 'ch-2', chapterId: null, contentText: '# Chapter Two' },
    ])
    expect(result.get('ch-1')).toBe('CHAPTER')
    expect(result.get('ch-2')).not.toBe('CHAPTER')
  })

  it('falls back to a generic stand-in when the chapter has no usable content snippet', () => {
    const result = resolveChapterLinkIds([
      { chapterNoteId: 'ch-1', chapterId: null, contentText: '' },
    ])
    expect(result.get('ch-1')).toBe('CHAPTER')
  })

  it('every resolved id is reachable by exact-match lookup -- the round trip navigateToInternalPreviewLink relies on', () => {
    const chapters = [
      { chapterNoteId: 'ch-1', chapterId: null, contentText: '# Chapter One' },
      { chapterNoteId: 'ch-2', chapterId: 'AGENDA', contentText: '# Agenda' },
      { chapterNoteId: 'ch-3', chapterId: null, contentText: '# Chapter One' },
    ]
    const resolved = resolveChapterLinkIds(chapters)
    for (const chapter of chapters) {
      const linkId = resolved.get(chapter.chapterNoteId)!
      const matched = Array.from(resolved.entries()).find(([, id]) => id === linkId)?.[0]
      expect(matched).toBe(chapter.chapterNoteId)
    }
  })
})
