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
 * An auto-assigned note id is a dollar sign followed by a number: `$12`.
 * Chapters use the section sign the same way, so the sigil itself says which
 * layer an id belongs to — and says at a glance that nobody named it.
 *
 * The sigil is part of the STORED id, not decoration added at display time.
 * That is what lets a link write `$12` with one character doing two jobs at
 * once (the link's own sigil and the id's first character) rather than needing
 * `$$12` — see resolveLinkedNoteId.
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
 * A user may still type the auto form deliberately to hand a note back to
 * provisional state; it goes through the same collision check as any other id.
 */
const AUTO_ASSIGNED_ID_PATTERN = /^\$(\d+)$/

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
 * Lowest free `$n` (n starting at 1) given every id already in use. Checks the
 * full id set, not just the auto-shaped ones, so a hand-assigned `$4` is never
 * collided with. Numbers freed by deletion are reused, but existing ids are
 * never renumbered to close a gap — links point at them.
 */
export function buildNextAutoAssignedId(existingIds: Iterable<string | null | undefined>): string {
  const taken = new Set<string>()
  for (const id of existingIds) {
    if (typeof id === 'string' && id.trim().length > 0) taken.add(id.trim().toUpperCase())
  }
  let candidate = 1
  while (taken.has(`$${candidate}`)) candidate += 1
  return `$${candidate}`
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

/**
 * Characters a user-chosen id may never START with.
 *
 * This is what keeps link syntax unambiguous rather than being a style rule:
 * a link reads `$SOMETHING`, and the parser decides what follows the sigil by
 * looking at its first character -- a digit means the target is an auto id
 * (`$12`, where the link's own `$` doubles as the id's first character), and
 * anything else means a user id carrying no sigil of its own. Allow a user id
 * to begin with a digit and `$12` has two readings; allow one to begin with
 * `$` or the section sign and `$$FOO` does too.
 */
const RESERVED_ID_LEADING_CHARACTERS = /^[0-9$§]/

/** True when `raw` is acceptable as a user-chosen id (note or chapter). Empty is NOT valid here -- an empty request means "hand it back", handled separately. */
export function isValidUserAssignedId(raw: string): boolean {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return false
  return !RESERVED_ID_LEADING_CHARACTERS.test(trimmed)
}

/**
 * The stored note id a link's post-`$` text refers to. `123` means the auto id
 * `$123` (the link's sigil is the id's own first character); anything else is
 * a user id exactly as written.
 */
export function resolveLinkedNoteId(rawFromLink: string): string {
  const trimmed = rawFromLink.trim()
  return /^\d/.test(trimmed) ? `$${trimmed}` : trimmed
}

/** The stored chapter id a link's post-section-sign text refers to -- same rule as resolveLinkedNoteId. */
export function resolveLinkedChapterId(rawFromLink: string): string {
  const trimmed = rawFromLink.trim()
  return /^\d/.test(trimmed) ? `§${trimmed}` : trimmed
}

/**
 * Display text for an id, with its sigil shown exactly once.
 *
 * An auto id already carries its sigil as the first character of the STORED
 * value; a user-chosen id never does. So a display site that prefixes the
 * sigil itself renders `$$12` for the first kind and a correct `$MYNOTE` for
 * the second. This adds the sigil only when it isn't already there.
 *
 * Never separated from the value. An auto id carries the sigil as its own
 * first character, so any separator would render the two kinds differently for
 * a reason the reader cannot see.
 */
export function formatIdWithSigil(id: string | null | undefined, sigil: '$' | '§'): string {
  const value = (id ?? '').trim()
  if (value.length === 0) return ''
  return value.startsWith(sigil) ? value : `${sigil}${value}`
}
