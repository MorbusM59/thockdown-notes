import { stripMarkdownInlineFormatting } from './tableOfContentsText'

export function getNoteTabLabel(assignedId: string | null | undefined): string {
  const trimmed = assignedId?.trim()
  return trimmed ? trimmed : '···'
}

export function getParentTabLabel(): string {
  return 'INTRO'
}

function normalizeContentPreviewText(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const withoutHeading = firstLine.replace(/^#+\s*/, '').trim()
  return stripMarkdownInlineFormatting(withoutHeading).replace(/\s+/g, ' ').trim()
}

/**
 * A chapter's own display identity when it has no explicit chapterId: a
 * short snippet lifted from its first line, markdown/heading syntax
 * stripped. Chapters have no "title" concept at all (see noteLifecycleService.ts's
 * titleFromText doc comment) -- this is the one and only fallback identity
 * a chapter has, shared between the chapter pill's own label
 * (getChapterTabLabel below) and databaseService.ts's ensureChapterId (the
 * same snippet seeds a chapter's chapterId the first time one actually
 * needs to be persisted, so a chapter's displayed label and its eventual
 * real id are never derived from two different things).
 */
export function deriveChapterContentSnippet(contentText: string | null | undefined): string {
  const fallbackText = normalizeContentPreviewText(contentText ?? '')
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

export function getChapterTabLabel(chapterId: string | null | undefined, chapterContentText?: string | null): string {
  const trimmedId = chapterId?.trim()
  if (trimmedId) return trimmedId
  return deriveChapterContentSnippet(chapterContentText)
}
