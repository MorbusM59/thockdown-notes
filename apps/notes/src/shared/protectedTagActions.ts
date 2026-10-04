import { normalizeTagName } from './tags'

export type ProtectedTagDestination = 'archived' | 'deleted'

/**
 * Swaps a note's (or chapter's) archived/deleted protected tag to
 * `destination` -- clearing the opposite protected tag if present, adding
 * the destination tag if missing, then reordering tags so the destination
 * tag sits first. Shared between regular notes
 * (useNoteProtectionActions.ts's applyProtectedNoteDestination) and
 * chapters (useChapterPillActions.ts's delete/archive handlers): both are
 * plain notes as far as the tag API is concerned, chapters just carry no
 * *regular* tags of their own.
 */
export async function applyProtectedTagDestination(noteId: string, existingTags: string[], destination: ProtectedTagDestination): Promise<void> {
  if (!window.thockdownNotes) return

  const opposite: ProtectedTagDestination = destination === 'archived' ? 'deleted' : 'archived'

  const hasDestination = existingTags.some((tag) => normalizeTagName(tag) === destination)
  const hasOpposite = existingTags.some((tag) => normalizeTagName(tag) === opposite)

  if (hasOpposite) {
    await window.thockdownNotes.removeTagFromNote({ id: noteId, tagName: opposite })
  }

  if (!hasDestination) {
    await window.thockdownNotes.addTagToNote({
      id: noteId,
      tagName: destination,
      position: 0,
    })
  }

  const reordered = [
    destination,
    ...existingTags.filter((tag) => {
      const normalized = normalizeTagName(tag)
      return normalized !== destination && normalized !== opposite
    }),
  ]

  await window.thockdownNotes.reorderNoteTags({ id: noteId, tagNames: reordered })
}
