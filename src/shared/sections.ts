export const EDITOR_SECTIONS_CHANNELS = {
  list: 'sections:list',
  create: 'sections:create',
  rename: 'sections:rename',
  remove: 'sections:remove',
  reorder: 'sections:reorder',
  updateWidths: 'sections:update-widths',
} as const;

/** The sole section on a fresh install, and always where sidebar note clicks land. */
export const DEFAULT_EDITOR_SECTION_ID = 'default';

/**
 * One side-by-side editor pane. `widthFraction` is the pane's share of the
 * split-view width (null = "distribute evenly with its siblings", the
 * everyday case while there's only one section). `name` is null until the
 * user names it -- reserved for saving/restoring named section collections
 * independently from the existing UI loadout system.
 */
export interface EditorSectionEntry {
  id: string;
  name: string | null;
  position: number;
  widthFraction: number | null;
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
}
