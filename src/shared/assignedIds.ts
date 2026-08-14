// Pure id-normalization helpers, shared between the main process
// (databaseService.ts, where a note's/chapter's assignedId is actually
// persisted) and anywhere else that needs to derive or reproduce the same
// id from a title/snippet -- framework-free, no DOM/Node/DB dependency, so
// the renderer can import it directly without an IPC round trip. Originally
// lived only in databaseService.ts; extracted here so the renderer (see
// tabLabels.ts's resolveChapterLinkIds) can reproduce the exact same
// derivation when it needs to resolve an id it never persisted itself.

const NOTE_INTERNAL_ID_MAX_LEN = 8

/**
 * Normalizes user- or title-derived text into the tab-bar ID alphabet:
 * upper-cased, whitespace collapsed to single hyphens, anything else left
 * as-is (so punctuation the user deliberately typed survives).
 */
export function normalizeAssignedIdInput(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '-')
}

/** First 8 characters of the normalized title, trimmed of a trailing hyphen. */
export function deriveDefaultAssignedIdBase(title: string): string {
  const normalized = normalizeAssignedIdInput(title || 'NOTE')
  const truncated = normalized.slice(0, NOTE_INTERNAL_ID_MAX_LEN)
  const trimmed = truncated.replace(/-+$/, '')
  return trimmed.length > 0 ? trimmed : 'NOTE'
}
