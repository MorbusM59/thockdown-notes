import { describe, expect, it } from 'vitest'
import { matchesNoteSearchQuery } from './noteSearch'

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

    expect(matchesNoteSearchQuery(note, 'secret phrase', false)).toBe(true)
    expect(matchesNoteSearchQuery(note, 'Secret Phrase', false)).toBe(true)
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

    expect(matchesNoteSearchQuery(note, '#project', false)).toBe(true)
  })
})
