export const EDITOR_SECTIONS_CHANNELS = {
  list: 'sections:list',
  create: 'sections:create',
  rename: 'sections:rename',
  remove: 'sections:remove',
  reorder: 'sections:reorder',
  updateWidths: 'sections:update-widths',
  setActiveNote: 'sections:set-active-note',
  closeSlot: 'sections:close-slot',
  swapIntoSlot: 'sections:swap-into-slot',
} as const;

/** The sole section on a fresh install, and always where sidebar note clicks land. */
export const DEFAULT_EDITOR_SECTION_ID = 'default';

/**
 * One side-by-side editor pane. `widthFraction` is the pane's share of the
 * split-view width (null = "distribute evenly with its siblings", the
 * everyday case while there's only one section). `name` is null until the
 * user names it -- a named section is kept forever and can be recalled into
 * any slot later (see `swapIntoSlot`); an unnamed one is disposable and is
 * deleted outright when its slot is closed or replaced.
 *
 * `position` is null when the section isn't currently occupying a slot --
 * true for every named section the user has put away, never true for an
 * unnamed one (which simply ceases to exist instead). `lastActiveNoteId` is
 * this section's own "which note was I last showing" memory, independent of
 * whether that note is pinned to the tab bar.
 */
export interface EditorSectionEntry {
  id: string;
  name: string | null;
  position: number | null;
  widthFraction: number | null;
  lastActiveNoteId: string | null;
}

export interface EditorSectionWidthUpdate {
  id: string;
  widthFraction: number | null;
}

export interface EditorSectionsApi {
  listSections(): Promise<EditorSectionEntry[]>;
  /** `afterPosition` inserts immediately to the right of that position; omitted appends at the end. */
  createSection(name?: string | null, afterPosition?: number): Promise<EditorSectionEntry[]>;
  renameSection(id: string, name: string | null): Promise<EditorSectionEntry[]>;
  /** No-op on the default section -- it's never closable. */
  removeSection(id: string): Promise<EditorSectionEntry[]>;
  reorderSections(orderedSectionIds: string[]): Promise<EditorSectionEntry[]>;
  /** Persists the divider layout once a drag settles. */
  updateSectionWidths(widths: EditorSectionWidthUpdate[]): Promise<EditorSectionEntry[]>;
  /** Records which note this section last showed -- independent of pinning. */
  setActiveNote(sectionId: string, noteId: string | null): Promise<EditorSectionEntry[]>;
  /**
   * Closes a section's slot via its own "-" button. Unnamed sections are
   * deleted outright (cascading their pinned tabs); named sections are only
   * parked (`position` set to null) -- their row and tabs survive, reachable
   * again later via `swapIntoSlot`. Either way, remaining sections' positions
   * are renumbered to stay contiguous.
   */
  closeSlot(sectionId: string): Promise<EditorSectionEntry[]>;
  /**
   * Recalls `incomingSectionId` into whatever slot `outgoingSectionId`
   * currently occupies. `outgoingSectionId` is closed the same way
   * `closeSlot` would (deleted if unnamed, parked if named) but without the
   * confirm/priming gesture `closeSlot`'s own UI requires -- this is already
   * a deliberate, confirmed user action (right-click, then pick from a list).
   */
  swapIntoSlot(outgoingSectionId: string, incomingSectionId: string): Promise<EditorSectionEntry[]>;
}
