export const EDITOR_SECTIONS_CHANNELS = {
  list: 'sections:list',
  create: 'sections:create',
  rename: 'sections:rename',
  remove: 'sections:remove',
  reorder: 'sections:reorder',
  updateSlotWidths: 'sections:update-slot-widths',
  updateSlotFixedWidths: 'sections:update-slot-fixed-widths',
  setActiveNote: 'sections:set-active-note',
  closeSlot: 'sections:close-slot',
  swapIntoSlot: 'sections:swap-into-slot',
} as const;

/** The sole section on a fresh install, and always where sidebar note clicks land. */
export const DEFAULT_EDITOR_SECTION_ID = 'default';

/**
 * One collection of tabs -- a working set of notes that gets *loaded into* a
 * slot, not the slot itself (see `docs/user-workflow-design.md` §1.4: a slot
 * is the side-by-side container, a section is what's shown in it).
 *
 * `name` is null until the user names it -- a named section is kept forever
 * and can be recalled into any slot later (see `swapIntoSlot`); an unnamed
 * one is disposable and is deleted outright when its slot is closed or
 * replaced.
 *
 * `position` is which slot this section currently occupies, or null when it
 * occupies none -- true for every named section the user has put away, never
 * true for an unnamed one (which simply ceases to exist instead).
 * `lastActiveNoteId` is this section's own "which note was I last showing"
 * memory, independent of whether that note is pinned to the tab bar.
 */
export interface EditorSectionEntry {
  id: string;
  name: string | null;
  position: number | null;
  /**
   * READ-ONLY MIRROR of the occupied slot's width -- geometry belongs to the
   * slot (`EditorSlotEntry`), never to the section, so a parked section
   * (`position: null`) always reads null here rather than carrying the width
   * of a slot it no longer occupies. Written via `updateSlotWidths`, keyed by
   * position; writing to a section is not possible by design.
   */
  widthFraction: number | null;
  /** READ-ONLY MIRROR of the occupied slot's pin -- see `widthFraction` and `EditorSlotEntry.fixedWidthPx`. */
  fixedWidthPx: number | null;
  lastActiveNoteId: string | null;
  /** Whether `setActiveNote` has ever been called for this section -- distinguishes "never had a note assigned" (bootstrap falls back to some note) from "user explicitly cleared it" (bootstrap respects the empty state), since both otherwise look like `lastActiveNoteId: null`. */
  noteSlotInitialized: boolean;
}

/**
 * One side-by-side container an editor environment can be loaded into --
 * furniture, identified purely by where it is. Slots own the divider layout;
 * sections own tabs and note memory. Reordering or swapping which section
 * occupies a slot never moves geometry: the panes keep their shape and only
 * their contents change (`docs/user-workflow-design.md` §1.4).
 *
 * `widthFraction` is this slot's share of the split-view width (null =
 * "distribute evenly with the others", the everyday case while there's only
 * one slot). `fixedWidthPx` is set when the user has pinned the slot by
 * shrinking it via a divider drag: it then holds exactly this pixel width
 * while flexible siblings absorb window resizes (see computeSlotWidthsPx).
 * Null = flexible.
 */
export interface EditorSlotEntry {
  position: number;
  widthFraction: number | null;
  fixedWidthPx: number | null;
}

export interface EditorSlotWidthUpdate {
  position: number;
  widthFraction: number | null;
}

export interface EditorSlotFixedWidthUpdate {
  position: number;
  fixedWidthPx: number | null;
}

export interface EditorSectionsApi {
  listSections(): Promise<EditorSectionEntry[]>;
  /** `afterPosition` inserts immediately to the right of that position; omitted appends at the end. */
  createSection(name?: string | null, afterPosition?: number): Promise<EditorSectionEntry[]>;
  renameSection(id: string, name: string | null): Promise<EditorSectionEntry[]>;
  /** No-op on the default section -- it's never closable. */
  removeSection(id: string): Promise<EditorSectionEntry[]>;
  reorderSections(orderedSectionIds: string[]): Promise<EditorSectionEntry[]>;
  /** Persists the divider layout once a drag settles -- keyed by *slot* position, since geometry is the slot's, not its occupant's. */
  updateSlotWidths(widths: EditorSlotWidthUpdate[]): Promise<EditorSectionEntry[]>;
  /** Persists the fixed/flexible pin state (see EditorSlotEntry.fixedWidthPx), likewise keyed by slot position. */
  updateSlotFixedWidths(entries: EditorSlotFixedWidthUpdate[]): Promise<EditorSectionEntry[]>;
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
