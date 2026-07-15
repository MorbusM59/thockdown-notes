export const NOTE_TABS_CHANNELS = {
  list: 'tabs:list',
  add: 'tabs:add',
  remove: 'tabs:remove',
  reorder: 'tabs:reorder',
} as const;

/** One entry pinned to the tab bar. Display label comes from the note's `assignedId`, looked up client-side. */
export interface NoteTabEntry {
  noteId: string;
  position: number;
  addedAtMs: number;
}

export interface NoteTabsApi {
  listTabs(): Promise<NoteTabEntry[]>;
  addTab(noteId: string): Promise<NoteTabEntry[]>;
  removeTab(noteId: string): Promise<NoteTabEntry[]>;
  reorderTabs(orderedNoteIds: string[]): Promise<NoteTabEntry[]>;
}
