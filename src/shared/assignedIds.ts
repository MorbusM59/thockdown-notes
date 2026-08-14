// Pure id-normalization helpers, used wherever a note's or chapter's
// default id needs to be derived from a title/snippet -- framework-free, no
// DOM/Node/DB dependency. Originally lived only in databaseService.ts;
// extracted here so the dev-mode browser mock (installBrowserMockBridges.ts)
// could import the same implementation instead of maintaining its own
// duplicate, rather than the two silently drifting apart.

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
