export interface NoteSearchCandidate {
  title: string
  fileName: string
  tags: string[]
  contentText?: string
}

export function isNoteSearchQueryActive(query: string): boolean {
  return query.trim().length > 0
}

/** Whether a note (or anything shaped like one) matches the sidebar search. Always ignores letter case. */
export function matchesNoteSearchQuery(note: NoteSearchCandidate, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true

  if (normalized.startsWith('#')) {
    const tagQuery = normalized.slice(1).trim()
    if (!tagQuery) return true
    return note.tags.some((tag) => tag.toLowerCase().includes(tagQuery))
  }

  return (
    note.title.toLowerCase().includes(normalized) ||
    note.fileName.toLowerCase().includes(normalized) ||
    (note.contentText ?? '').toLowerCase().includes(normalized) ||
    note.tags.some((tag) => tag.toLowerCase().includes(normalized))
  )
}
