import { detachString } from './detachString'

/**
 * What an identity label needs from a note's content: its first line, or
 * null when the content is blank. Held on a note summary instead of the
 * content itself (see NoteSummary.leadLine for why), and detached so a kept
 * summary does not keep the note it was read from alive.
 */
export function leadLineOf(contentText: string | null | undefined): string | null {
  const content = contentText ?? ''
  if (!content.trim()) return null
  return detachString(content.split(/\r?\n/, 1)[0] ?? '')
}

export interface IdentityLabel {
  /** The text to display -- the assigned id if the user set one, otherwise the title read from the entity's own current first line. */
  text: string
  /** True when `text` is a real, user-assigned id -- the convention (established for chapters, now unified across notes too) is to render that in caps/regular weight, and a derived fallback (false) in italics, so the two states always read as visibly different at a glance. */
  isAssigned: boolean
}

/**
 * The single, unified "how do we label this thing" rule for both a note's
 * own tab and a chapter's own pill: the user's assigned id if they set one,
 * otherwise the entity's own current title line. The fallback is derived
 * every time it is shown and NEVER written back anywhere, under any
 * circumstance -- not on pin, not on first TOC generation, nothing short of
 * the user explicitly typing an id in -- because a stored copy would stop
 * following the content it describes. `assignedId` is `note.assignedId` for a
 * note or `chapter.chapterId` for a chapter -- both are the same "null until
 * the user explicitly sets one" shape, which is what makes one shared
 * function correct for both. `leadLine` is `leadLineOf(content)`.
 */
export function resolveIdentityLabel(
  assignedId: string | null | undefined,
  leadLine: string | null | undefined,
  kind: 'note' | 'chapter' = 'note',
): IdentityLabel {
  const trimmed = assignedId?.trim()
  if (trimmed) return { text: trimmed, isAssigned: true }

  if (leadLine === null || leadLine === undefined) return { text: '···', isAssigned: false }

  const expectedPrefix = kind === 'chapter' ? '## ' : '# '
  if (!leadLine.startsWith(expectedPrefix)) {
    return { text: 'Missing title', isAssigned: false }
  }

  const title = leadLine.replace(new RegExp(`^${expectedPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), '').trim()
  return { text: title || 'Missing title', isAssigned: false }
}
