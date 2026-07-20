/**
 * Cross-component drag payload for moving a note onto a section -- either
 * from another section's pinned tab (in which case it should be unpinned
 * from where it came from) or from the sidebar note list (nothing to
 * unpin). The first drag interaction in the app to cross component/section
 * boundaries, so there's no existing convention to follow; a custom
 * dataTransfer MIME type carries the payload since, unlike the same-bar tag
 * reorder, source and target don't share any closure state.
 */
export const NOTE_DRAG_MIME_TYPE = 'application/x-thockdown-note'

export interface NoteDragPayload {
  noteId: string
  /** null when the drag originated from the sidebar note list. */
  sourceSectionId: string | null
}

export function serializeNoteDragPayload(payload: NoteDragPayload): string {
  return JSON.stringify(payload)
}

export function parseNoteDragPayload(raw: string): NoteDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<NoteDragPayload>
    if (typeof parsed?.noteId !== 'string') return null
    return {
      noteId: parsed.noteId,
      sourceSectionId: typeof parsed.sourceSectionId === 'string' ? parsed.sourceSectionId : null,
    }
  } catch {
    return null
  }
}
