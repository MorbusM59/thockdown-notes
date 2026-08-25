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

/**
 * An auto-assigned note id looks exactly like `NOTE-#<n>` (the normalized
 * form of "Note #n" -- normalizeAssignedIdInput upper-cases and hyphenates
 * whitespace, so that is what actually reaches storage).
 *
 * There is deliberately NO separate "was this auto-assigned" column. The
 * state is derived from the value itself, which makes it impossible to
 * desynchronize: a boolean flag would have to be cleared by every path that
 * can change an id (rename, import, external file sync, undo), and the first
 * one that forgets renders a deliberate id as provisional or vice versa.
 * Deriving it means the marker is always correct by construction -- and it
 * gives the user a way back into the provisional state by simply typing that
 * form, which is a feature rather than a leak.
 *
 * Matching is case- and separator-insensitive so a user typing "Note #3"
 * lands in the same state as the generator's own `NOTE-#3`.
 */
const AUTO_ASSIGNED_ID_PATTERN = /^NOTE[-\s]#(\d+)$/i

/** True when `assignedId` is a provisional, generator-made id rather than one the user chose. A note with no id at all counts as provisional too: it has equally not been committed to. */
export function isAutoAssignedId(assignedId: string | null | undefined): boolean {
  if (!assignedId) return true
  return AUTO_ASSIGNED_ID_PATTERN.test(assignedId.trim())
}

/** The number in an auto-assigned id, or null if it isn't one. */
export function readAutoAssignedIdNumber(assignedId: string | null | undefined): number | null {
  if (!assignedId) return null
  const match = AUTO_ASSIGNED_ID_PATTERN.exec(assignedId.trim())
  if (!match) return null
  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Lowest free `NOTE-#n` (n starting at 1) given every id already in use.
 * Checks the full id set, not just the auto-shaped ones, so a user who has
 * manually taken `NOTE-#4` is never collided with.
 */
export function buildNextAutoAssignedId(existingIds: Iterable<string | null | undefined>): string {
  const taken = new Set<string>()
  for (const id of existingIds) {
    if (typeof id === 'string' && id.trim().length > 0) taken.add(id.trim().toUpperCase())
  }
  let candidate = 1
  while (taken.has(`NOTE-#${candidate}`)) candidate += 1
  return `NOTE-#${candidate}`
}

/**
 * A chapter's provisional id is `§n` -- the same idea as a note's `NOTE-#n`,
 * derived the same way (from the value's shape, not a stored flag; see
 * isAutoAssignedId for the full reasoning).
 *
 * Numbering is per parent, not global: chapter ids only have to be unique
 * within one note's chapter list, so every note's chapters start again at §1.
 */
const AUTO_CHAPTER_ID_PATTERN = /^§(\d+)$/

/** True when `chapterId` is a provisional, generator-made chapter id -- or absent entirely, which has equally not been committed to. */
export function isAutoAssignedChapterId(chapterId: string | null | undefined): boolean {
  if (!chapterId) return true
  return AUTO_CHAPTER_ID_PATTERN.test(chapterId.trim())
}

/** Lowest free `§n` (n starting at 1) among one parent's chapter ids. */
export function buildNextAutoChapterId(existingIds: Iterable<string | null | undefined>): string {
  const taken = new Set<string>()
  for (const id of existingIds) {
    if (typeof id === 'string' && id.trim().length > 0) taken.add(id.trim().toUpperCase())
  }
  let candidate = 1
  while (taken.has(`§${candidate}`)) candidate += 1
  return `§${candidate}`
}
