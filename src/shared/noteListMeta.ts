import type { NoteSummary } from './noteLifecycle'

export type NoteListMetaCandidate = Pick<NoteSummary, 'assignedId' | 'updatedAtMs'>
export type NoteListMetaKind = 'id' | 'created'

export function getNoteListMetaKind(note: NoteListMetaCandidate): NoteListMetaKind {
  return note.assignedId ? 'id' : 'created'
}
