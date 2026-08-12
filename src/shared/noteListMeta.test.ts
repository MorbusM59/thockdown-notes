import { describe, expect, it } from 'vitest'
import { getChapterTabLabel, getNoteTabLabel, getParentTabLabel } from './tabLabels'
import { getChapterNoteListMetaLabel, getNoteListMetaKind, type NoteListMetaCandidate } from './noteListMeta'

describe('tab label display', () => {
  it('shows bare note IDs without a $ prefix', () => {
    expect(getNoteTabLabel('NOTE-42')).toBe('NOTE-42')
    expect(getNoteTabLabel(null)).toBe('···')
  })

  it('uses the parent label for the chapter bar root tab', () => {
    expect(getParentTabLabel()).toBe('INTRO')
  })

  it('uses the chapter ID when assigned, otherwise a compact preview of the chapter content', () => {
    expect(getChapterTabLabel('AGENDA')).toBe('AGENDA')
    expect(getChapterTabLabel(null, 'chapter one intro')).toBe('chapter')
    expect(getChapterTabLabel(null, 'hello world from the chapter')).toBe('hello world')
    expect(getChapterTabLabel(null, 'this is a much longer chapter preview')).toBe('this is')
    expect(getChapterTabLabel(null, 'abcdef')).toBe('abcdef')
    expect(getChapterTabLabel(null, 'abcdefghijkl')).toBe('abcdefghijkl')
    expect(getChapterTabLabel(null, null)).toBe('···')
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
