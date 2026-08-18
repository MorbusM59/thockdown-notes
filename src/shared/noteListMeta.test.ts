import { describe, expect, it } from 'vitest'
import { resolveIdentityLabel } from './tabLabels'
import { getChapterNoteListMetaLabel, getNoteListMetaKind, type NoteListMetaCandidate } from './noteListMeta'

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

describe('getChapterNoteListMetaLabel', () => {
  it('uses the parent assigned id and chapter id when both exist', () => {
    expect(getChapterNoteListMetaLabel({
      parentAssignedId: 'NOTE-42',
      chapterAssignedId: 'AGENDA',
      createdDateText: '01 Jan 26',
    })).toBe('$NOTE-42 §AGENDA')
  })

  it('uses the parent assigned id and the creation date when the chapter has no id', () => {
    expect(getChapterNoteListMetaLabel({
      parentAssignedId: 'NOTE-42',
      chapterAssignedId: null,
      createdDateText: '01 Jan 26',
    })).toBe('$NOTE-42 § 01 Jan 26')
  })

  it('uses the chapter id without the parent when the parent has no assigned id', () => {
    expect(getChapterNoteListMetaLabel({
      parentAssignedId: null,
      chapterAssignedId: 'AGENDA',
      createdDateText: '01 Jan 26',
    })).toBe('§AGENDA')
  })

  it('falls back to the chapter marker and creation date when neither id exists', () => {
    expect(getChapterNoteListMetaLabel({
      parentAssignedId: null,
      chapterAssignedId: null,
      createdDateText: '01 Jan 26',
    })).toBe('§ 01 Jan 26')
  })
})
