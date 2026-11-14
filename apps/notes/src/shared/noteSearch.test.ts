import { describe, expect, it } from 'vitest'
import { isNoteSearchQueryActive, matchesNoteSearchQuery } from './noteSearch'

describe('isNoteSearchQueryActive', () => {
  it('treats non-empty search input as active filtering', () => {
    expect(isNoteSearchQueryActive('alpha')).toBe(true)
    expect(isNoteSearchQueryActive('   ')).toBe(false)
  })
})

describe('matchesNoteSearchQuery', () => {
  it('matches note content even when the title does not contain the query', () => {
    const note = {
      id: '1',
      fileName: 'example.md',
      title: 'Summary',
      tags: ['work'],
      contentText: 'This note contains the secret phrase in the body.',
      createdAtMs: 0,
      updatedAtMs: 0,
      sizeBytes: 0,
    }

    expect(matchesNoteSearchQuery(note, 'secret phrase')).toBe(true)
    expect(matchesNoteSearchQuery(note, 'Secret Phrase')).toBe(true)
  })

  it('matches tags when the query starts with #', () => {
    const note = {
      id: '1',
      fileName: 'example.md',
      title: 'Summary',
      tags: ['ProjectAlpha'],
      contentText: 'body',
      createdAtMs: 0,
      updatedAtMs: 0,
      sizeBytes: 0,
    }

    expect(matchesNoteSearchQuery(note, '#project')).toBe(true)
  })
})
