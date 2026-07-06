export interface NoteSearchCandidate {
  title: string
  fileName: string
  tags: string[]
  contentText?: string
}

export function isNoteSearchQueryActive(query: string): boolean {
  return query.trim().length > 0
}

export function matchesNoteSearchQuery(note: NoteSearchCandidate, query: string, isCaseSensitive: boolean): boolean {
  const trimmed = query.trim()
  const normalized = isCaseSensitive ? trimmed : trimmed.toLowerCase()
  if (!normalized) return true

  if (trimmed.startsWith('#')) {
    const rawTagQuery = trimmed.slice(1).trim()
    const tagQuery = isCaseSensitive ? rawTagQuery : rawTagQuery.toLowerCase()
    if (!tagQuery) return true
    return note.tags.some((tag) => {
      const comparableTag = isCaseSensitive ? tag : tag.toLowerCase()
      return comparableTag.includes(tagQuery)
    })
  }

  const title = isCaseSensitive ? note.title : note.title.toLowerCase()
  const fileName = isCaseSensitive ? note.fileName : note.fileName.toLowerCase()
  const contentText = isCaseSensitive ? (note.contentText ?? '') : (note.contentText ?? '').toLowerCase()

  return (
    title.includes(normalized) ||
    fileName.includes(normalized) ||
    contentText.includes(normalized) ||
    note.tags.some((tag) => {
      const comparableTag = isCaseSensitive ? tag : tag.toLowerCase()
      return comparableTag.includes(normalized)
    })
  )
}
