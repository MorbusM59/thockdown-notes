// The auto-generated cross-chapter Table of Contents and Open Items
// chapters need to link to a specific note (the parent, or any of its
// chapters) and, optionally, one of that note's own headings -- but they
// have no business going through the user-facing `$NOTE-ID§CHAPTER-ID`
// link syntax to do it. That syntax exists so a PERSON can type, read, and
// remember a link; it's built entirely around assignedId/chapterId, ids
// that only exist because a user explicitly set them (see
// databaseService.ts's setNoteAssignedId/setChapterId) -- and gating the
// TOC's own internal navigation on whether the user happened to assign one
// would mean, in the overwhelmingly common case where they haven't, the
// TOC simply doesn't work. There's no reason for it not to: every note
// (chapter or not) already has a real, permanent, globally-unique internal
// id (NoteSummary.id / a chapter's own chapterNoteId) the instant it's
// created, no user action required.
//
// This is that separate, internal-only addressing scheme: `@<noteId>`,
// optionally `@<noteId>#<fragment>` for one of that note's own headings
// (fragment format shared with tableOfContentsText.ts's own
// formatHeadingAnchorFragment/findHeadingAnchorLine -- reused because it's
// the same content-derived concept, not because the two link schemes are
// otherwise related). Deliberately never a `$...` link of any kind, and
// deliberately never something a user would type, read, or need to
// understand -- it only ever appears inside the read-only, forced-preview
// auto-TOC/auto-Open-Items chapters, generated and consumed entirely by
// this app's own code, never hand-written and never displayed as text
// (the visible label is always the target's own heading text or a derived
// snippet -- see tabLabels.ts's resolveIdentityLabel).

const INTERNAL_NOTE_LINK_PATTERN = /^@([^#]+)(?:#(.+))?$/

export interface ParsedInternalNoteLink {
  noteId: string
  /** The raw fragment after `#`, if any -- e.g. `heading:setting`. Not unwrapped here; see tableOfContentsText.ts's parseHeadingAnchorFragment for that. */
  fragment: string | null
}

export function formatInternalNoteLink(noteId: string, fragment?: string | null): string {
  return fragment ? `@${noteId}#${fragment}` : `@${noteId}`
}

export function parseInternalNoteLink(href: string): ParsedInternalNoteLink | null {
  const match = INTERNAL_NOTE_LINK_PATTERN.exec(href)
  if (!match) return null
  return { noteId: match[1], fragment: match[2] ?? null }
}
