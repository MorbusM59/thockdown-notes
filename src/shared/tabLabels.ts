export function getNoteTabLabel(assignedId: string | null | undefined): string {
  const trimmed = assignedId?.trim()
  return trimmed ? trimmed : '···'
}

export function getParentTabLabel(): string {
  return 'INTRO'
}

function normalizeContentPreviewText(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  return firstLine.replace(/^#+\s*/, '').replace(/^\s+/, '').replace(/\s+/g, ' ').trim()
}

export function getChapterTabLabel(chapterId: string | null | undefined, chapterContentText?: string | null): string {
  const trimmedId = chapterId?.trim()
  if (trimmedId) return trimmedId

  const fallbackText = normalizeContentPreviewText(chapterContentText ?? '')
  if (!fallbackText) return '···'

  let n = Math.min(fallbackText.length, 12)
  if (n < 6) {
    n = fallbackText.length
  }

  const maxPosition = Math.min(fallbackText.length, 12)
  for (let position = 7; position <= maxPosition; position += 1) {
    if (fallbackText[position - 1] === ' ') {
      n = position - 1
      break
    }
  }

  return fallbackText.slice(0, Math.min(fallbackText.length, n)).trimEnd() || '···'
}
