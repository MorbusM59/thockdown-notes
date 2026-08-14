import { describe, expect, it } from 'vitest'
import { resolveIdentityLabel, getParentTabLabel } from './tabLabels'
import { getChapterNoteListMetaLabel, getNoteListMetaKind, type NoteListMetaCandidate } from './noteListMeta'

describe('tab label display', () => {
  it('shows bare assigned IDs without a $ prefix, marked as assigned', () => {
    expect(resolveIdentityLabel('NOTE-42', null)).toEqual({ text: 'NOTE-42', isAssigned: true })
    expect(resolveIdentityLabel(null, null)).toEqual({ text: '···', isAssigned: false })
  })

  it('uses the parent label for the chapter bar root tab', () => {
    expect(getParentTabLabel()).toBe('INTRO')
  })

  it('uses the assigned id when present, otherwise a compact preview of the content -- same rule for a note or a chapter', () => {
    expect(resolveIdentityLabel('AGENDA', null)).toEqual({ text: 'AGENDA', isAssigned: true })
    expect(resolveIdentityLabel(null, 'chapter one intro')).toEqual({ text: 'chapter', isAssigned: false })
    expect(resolveIdentityLabel(null, 'hello world from the chapter')).toEqual({ text: 'hello world', isAssigned: false })
    expect(resolveIdentityLabel(null, 'this is a much longer chapter preview')).toEqual({ text: 'this is', isAssigned: false })
    expect(resolveIdentityLabel(null, 'abcdef')).toEqual({ text: 'abcdef', isAssigned: false })
    expect(resolveIdentityLabel(null, 'abcdefghijkl')).toEqual({ text: 'abcdefghijkl', isAssigned: false })
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
