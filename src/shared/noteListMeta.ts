import type { NoteSummary } from './noteLifecycle'

export type NoteListMetaCandidate = Pick<NoteSummary, 'assignedId' | 'updatedAtMs'>
export type NoteListMetaKind = 'id' | 'created'

export function getNoteListMetaKind(note: NoteListMetaCandidate): NoteListMetaKind {
  return note.assignedId ? 'id' : 'created'
}

export function getChapterNoteListMetaLabel(params: {
  parentAssignedId: string | null | undefined
  chapterAssignedId: string | null | undefined
  createdDateText: string
}): string {
  const parentAssignedId = params.parentAssignedId?.trim()
  const chapterAssignedId = params.chapterAssignedId?.trim()

  if (parentAssignedId && chapterAssignedId) return `$${parentAssignedId} §${chapterAssignedId}`
  if (parentAssignedId) return `$${parentAssignedId} § ${params.createdDateText}`
  if (chapterAssignedId) return `§${chapterAssignedId}`
  return `§ ${params.createdDateText}`
}
