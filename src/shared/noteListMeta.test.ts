import { describe, expect, it } from 'vitest'
import { getNoteListMetaKind, type NoteListMetaCandidate } from './noteListMeta'

describe('getNoteListMetaKind', () => {
  it('prefers the assigned id over the created date when one exists', () => {
    const note: NoteListMetaCandidate = {
      assignedId: 'FOO',
      updatedAtMs: 1700000000000,
    }

    expect(getNoteListMetaKind(note)).toBe('id')
  })

  it('falls back to the created date when no assigned id exists', () => {
    const note: NoteListMetaCandidate = {
      assignedId: null,
      updatedAtMs: 1700000000000,
    }

    expect(getNoteListMetaKind(note)).toBe('created')
  })
})
