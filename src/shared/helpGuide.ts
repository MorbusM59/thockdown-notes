// Fixed, deterministic ids for the built-in User Guide's family of notes --
// the parent note, its auto-generated Table of Contents chapter, and its
// real content chapters (one per topic). "Fixed" the same way the Welcome
// note's own id is (see electron/help/helpNote.ts) -- seeding needs a
// stable id across every app start, not a freshly-generated random one, and
// this app's UI (App.tsx's sidebar-list filtering, the help-mode overlay)
// needs to recognize this exact family everywhere it might appear.
//
// Prose content lives in electron/help/helpGuideContent.ts (main-process
// only, paired with these same ids); this module holds only the ids
// themselves so the renderer (src/) can filter on them without pulling in
// ~800 lines of guide text it never needs to load eagerly.

export const HELP_GUIDE_ASSIGNED_ID = 'HELP'

export const HELP_GUIDE_ROOT_ID = '26-07-04_00-00_HELPGUIDE'
export const HELP_GUIDE_AUTO_TOC_ID = '26-07-04_00-00_HELPCTOC1'

export interface HelpGuideChapterId {
  /** Fixed internal note id. */
  noteId: string
  /** The user-facing `§CHAPTER-ID` short id used by this guide's own internal cross-links. */
  chapterId: string
}

export const HELP_GUIDE_CHAPTER_IDS: HelpGuideChapterId[] = [
  { noteId: '26-07-04_00-00_HELPCH001', chapterId: 'NOTES-EDITING' },
  { noteId: '26-07-04_00-00_HELPCH002', chapterId: 'INTERNAL-LINKING' },
  { noteId: '26-07-04_00-00_HELPCH003', chapterId: 'TAGS' },
  { noteId: '26-07-04_00-00_HELPCH004', chapterId: 'SIDEBAR-SEARCH' },
  { noteId: '26-07-04_00-00_HELPCH005', chapterId: 'SPLIT-VIEW-TABS' },
  { noteId: '26-07-04_00-00_HELPCH006', chapterId: 'ARCHIVE-TRASH' },
  { noteId: '26-07-04_00-00_HELPCH007', chapterId: 'TIME-MACHINE' },
  { noteId: '26-07-04_00-00_HELPCH008', chapterId: 'TOOLBAR-FORMATTING' },
  { noteId: '26-07-04_00-00_HELPCH009', chapterId: 'FIND-REPLACE' },
  { noteId: '26-07-04_00-00_HELPCH010', chapterId: 'EXTERNAL-FILES' },
  { noteId: '26-07-04_00-00_HELPCH011', chapterId: 'SYNC-IMPORT' },
  { noteId: '26-07-04_00-00_HELPCH012', chapterId: 'EXPORT' },
  { noteId: '26-07-04_00-00_HELPCH013', chapterId: 'SHORTCUTS' },
  { noteId: '26-07-04_00-00_HELPCH014', chapterId: 'WINDOW-CONTROLS' },
  { noteId: '26-07-04_00-00_HELPCH015', chapterId: 'APPEARANCE-SETTINGS' },
  { noteId: '26-07-04_00-00_HELPCH016', chapterId: 'MUSIC-PLAYER' },
  { noteId: '26-07-04_00-00_HELPCH017', chapterId: 'DATA-STORAGE' },
]

/** Every note id in the guide's family -- the parent, the auto-TOC chapter, and every real chapter. Used to exclude the whole family from every sidebar list (Date/Category/Archive/Trash/Find) in one place. */
export const HELP_GUIDE_NOTE_IDS: ReadonlySet<string> = new Set([
  HELP_GUIDE_ROOT_ID,
  HELP_GUIDE_AUTO_TOC_ID,
  ...HELP_GUIDE_CHAPTER_IDS.map((entry) => entry.noteId),
])

/**
 * A SEALED note: shipped documentation the app owns and the user reads, never
 * edits. Distinct from the ordinary frozen/timeless state, which is a user
 * choice they can undo at will -- sealing cannot be lifted from the UI at all.
 *
 * The protection is one rule, enforced where the user can actually reach:
 * `setNoteTimeless` refuses to unfreeze a sealed family. Writes are already
 * impossible while a family is frozen (databaseService's assertNotTimeless),
 * so making the unfreeze unreachable is what turns "frozen" into "read-only,
 * permanently". The seeding path in electron/help/helpGuideNote.ts calls the
 * database's own freeze/unfreeze primitives directly and is deliberately NOT
 * subject to this -- shipping a corrected guide has to keep working.
 */
export const SEALED_ROOT_NOTE_IDS: readonly string[] = [HELP_GUIDE_ROOT_ID]

export function isSealedNoteId(noteId: string | null | undefined): boolean {
  if (!noteId) return false
  return HELP_GUIDE_NOTE_IDS.has(noteId)
}
