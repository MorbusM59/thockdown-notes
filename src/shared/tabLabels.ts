import { stripMarkdownInlineFormatting } from './tableOfContentsText'
import { deriveDefaultAssignedIdBase } from './assignedIds'

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
 * (getChapterTabLabel below) and databaseService.ts's getChapterLinkId
 * (the same snippet seeds a chapter's live, unpersisted stand-in link id,
 * so a chapter's displayed label and its filler link id are never derived
 * from two different things -- and, like the label, that stand-in is never
 * written to the chapterId column; only the user assigning one explicitly
 * ever persists it).
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

export interface ChapterLinkIdInput {
  chapterNoteId: string
  /** Explicitly assigned via setChapterId (the chapter bar's right-click), or null if never assigned. */
  chapterId: string | null
  /** This chapter's own current content text -- only read when chapterId is null. */
  contentText: string | null | undefined
}

/**
 * Resolves the final display/link id for every real chapter in `chapters`
 * (already in chapter-bar order) -- mirrors, in one pass, the two dedup
 * layers databaseService.ts's getChapterLinkId (via resolveUniqueChapterId,
 * scoped against every OTHER chapter's own PERSISTED chapterId) and
 * noteLifecycleService.ts's own resolveUnusedLinkIdThisPass (scoped against
 * every id already resolved earlier in this same pass, so two unassigned
 * siblings whose content happens to derive the same snippet-based id never
 * collide) apply together when the auto-TOC/Open-Items chapters are
 * generated.
 *
 * Pure and DB-free -- everything both dedup layers need (every chapter's own
 * persisted chapterId, if any, and its content text) is already present in
 * `chapters` itself, so this can run identically on the main process (to
 * generate the TOC/Open-Items text in the first place) and in the renderer
 * (to resolve a `$NOTE-ID§CHAPTER-ID` link's chapter segment back to a
 * chapterNoteId -- including one that was never explicitly assigned, and so
 * only ever exists as this live, recomputed stand-in, never a value the
 * renderer could look up directly). Both sides MUST go through this rather
 * than re-deriving their own version, or a chapter's TOC label and its own
 * link's resolved destination could silently drift apart.
 */
export function resolveChapterLinkIds(chapters: ChapterLinkIdInput[]): Map<string, string> {
  const persistedIds = new Set(
    chapters.map((chapter) => chapter.chapterId).filter((id): id is string => Boolean(id)),
  )
  const usedThisPass = new Set<string>()
  const result = new Map<string, string>()

  for (const chapter of chapters) {
    let candidate: string
    if (chapter.chapterId) {
      candidate = chapter.chapterId
    } else {
      const snippet = deriveChapterContentSnippet(chapter.contentText)
      const base = deriveDefaultAssignedIdBase(snippet === '···' ? 'CHAPTER' : snippet)
      candidate = persistedIds.has(base) ? resolveUnusedId(base, persistedIds) : base
    }

    const resolved = resolveUnusedId(candidate, usedThisPass)
    usedThisPass.add(resolved)
    result.set(chapter.chapterNoteId, resolved)
  }

  return result
}

/** Suffixes `candidateId` with `-2`, `-3`, ... until it's not already in `used` -- shared incremental-suffix rule both of resolveChapterLinkIds' dedup layers apply. */
function resolveUnusedId(candidateId: string, used: Set<string>): string {
  if (!used.has(candidateId)) return candidateId
  let attempt = 2
  let resolved = `${candidateId}-${attempt}`
  while (used.has(resolved)) {
    attempt += 1
    resolved = `${candidateId}-${attempt}`
  }
  return resolved
}
