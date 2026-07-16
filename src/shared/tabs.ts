export const NOTE_TABS_CHANNELS = {
  list: 'tabs:list',
  add: 'tabs:add',
  remove: 'tabs:remove',
  reorder: 'tabs:reorder',
} as const;

/** One entry pinned to a section's tab bar. Display label comes from the note's `assignedId`, looked up client-side. */
export interface NoteTabEntry {
  sectionId: string;
  noteId: string;
  position: number;
  addedAtMs: number;
}

export interface NoteTabsApi {
  /** Every pinned tab across every section -- group by `sectionId` client-side. */
  listTabs(): Promise<NoteTabEntry[]>;
  addTab(sectionId: string, noteId: string): Promise<NoteTabEntry[]>;
  removeTab(sectionId: string, noteId: string): Promise<NoteTabEntry[]>;
  reorderTabs(sectionId: string, orderedNoteIds: string[]): Promise<NoteTabEntry[]>;
}
