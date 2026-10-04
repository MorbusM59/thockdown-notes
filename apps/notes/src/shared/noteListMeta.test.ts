import { describe, expect, it } from 'vitest'
import { resolveIdentityLabel } from './tabLabels'
import { getNoteListMetaKind, type NoteListMetaCandidate } from './noteListMeta'

describe('tab label display', () => {
  it('shows bare assigned IDs without a $ prefix, marked as assigned', () => {
    expect(resolveIdentityLabel('NOTE-42', null)).toEqual({ text: 'NOTE-42', isAssigned: true })
    expect(resolveIdentityLabel(null, null)).toEqual({ text: '···', isAssigned: false })
  })

  it('uses the assigned id when present, otherwise the first heading title for a note or chapter', () => {
    expect(resolveIdentityLabel('AGENDA', null)).toEqual({ text: 'AGENDA', isAssigned: true })
    expect(resolveIdentityLabel(null, '# chapter one intro', 'note')).toEqual({ text: 'chapter one intro', isAssigned: false })
    expect(resolveIdentityLabel(null, '## chapter one intro', 'chapter')).toEqual({ text: 'chapter one intro', isAssigned: false })
    expect(resolveIdentityLabel(null, 'plain intro', 'note')).toEqual({ text: 'Missing title', isAssigned: false })
    expect(resolveIdentityLabel(null, 'plain intro', 'chapter')).toEqual({ text: 'Missing title', isAssigned: false })
    expect(resolveIdentityLabel(null, null)).toEqual({ text: '···', isAssigned: false })
  })
})

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
