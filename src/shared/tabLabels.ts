import { stripMarkdownInlineFormatting } from './tableOfContentsText'

export function getParentTabLabel(): string {
  return 'INTRO'
}

function normalizeContentPreviewText(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const withoutHeading = firstLine.replace(/^#+\s*/, '').trim()
  return stripMarkdownInlineFormatting(withoutHeading).replace(/\s+/g, ' ').trim()
}

/**
 * Derives a short, human-readable snippet from an entity's (note's or
 * chapter's) own first line -- markdown/heading syntax stripped. This is
 * the one and only fallback identity anything without a user-assigned id
 * ever has. Computed fresh from current content every single time it's
 * needed; NEVER persisted anywhere, under any circumstance -- only the user
 * explicitly assigning a real id (setNoteAssignedId / setChapterId) ever
 * writes to the database. The only argument for caching this would be
 * performance, and re-deriving a handful of characters from one line of
 * text whenever it's actually displayed isn't a real cost.
 */
export function deriveContentSnippet(contentText: string | null | undefined): string {
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

export interface IdentityLabel {
  /** The text to display -- the assigned id if the user set one, otherwise a live-derived snippet from the entity's own current content. */
  text: string
  /** True when `text` is a real, user-assigned id -- the convention (established for chapters, now unified across notes too) is to render that in caps/regular weight, and a derived fallback (false) in italics, so the two states always read as visibly different at a glance. */
  isAssigned: boolean
}

/**
 * The single, unified "how do we label this thing" rule for both a note's
 * own tab and a chapter's own pill: the user's assigned id if they set one,
 * otherwise a live snippet derived from the entity's own current content
 * (see deriveContentSnippet's own doc comment for why that's never written
 * back anywhere, under any circumstance -- not on pin, not on first TOC
 * generation, nothing short of the user explicitly typing one in).
 * `assignedId` is `note.assignedId` for a note or `chapter.chapterId` for a
 * chapter -- both are the same "null until the user explicitly sets one"
 * shape, which is what makes one shared function correct for both.
 */
export function resolveIdentityLabel(assignedId: string | null | undefined, contentText: string | null | undefined): IdentityLabel {
  const trimmed = assignedId?.trim()
  if (trimmed) return { text: trimmed, isAssigned: true }
  return { text: deriveContentSnippet(contentText), isAssigned: false }
}
