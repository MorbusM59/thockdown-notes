export const NOTE_TABS_CHANNELS = {
  list: 'tabs:list',
  add: 'tabs:add',
  remove: 'tabs:remove',
  reorder: 'tabs:reorder',
  setLastActiveChapter: 'tabs:set-last-active-chapter',
} as const;

/** One entry pinned to a section's tab bar. Display label comes from the note's `assignedId`, looked up client-side. */
export interface NoteTabEntry {
  sectionId: string;
  noteId: string;
  position: number;
  addedAtMs: number;
  /** Which chapter of `noteId` this tab last showed, or null if it last showed the base note -- so switching back to this tab resumes that chapter instead of always landing on the base note. Re-validated server-side on every read (both the column's own FK and a live join against `chapters`), so a chapter deleted or reorganized from anywhere -- even a different section -- is guaranteed to already read back as null here rather than a dangling id. */
  lastActiveChapterNoteId: string | null;
}

export interface NoteTabsApi {
  /** Every pinned tab across every section -- group by `sectionId` client-side. */
  listTabs(): Promise<NoteTabEntry[]>;
  addTab(sectionId: string, noteId: string): Promise<NoteTabEntry[]>;
  removeTab(sectionId: string, noteId: string): Promise<NoteTabEntry[]>;
  reorderTabs(sectionId: string, orderedNoteIds: string[]): Promise<NoteTabEntry[]>;
  /** Records which chapter of `noteId` (or null, for the base note) this section's tab last showed -- called on every note activation within a section, not just tab clicks. */
  setLastActiveChapter(sectionId: string, noteId: string, chapterNoteId: string | null): Promise<NoteTabEntry[]>;
}
