// shared/types.ts - central types for Measly Notes

export interface Note {
  id: number;
  title: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
  lastEdited?: string | null;
  primaryTag?: string | null;
  // UI state persisted per-note
  progressPreview?: number | null;
  progressEdit?: number | null;
  cursorPos?: number | null;
  scrollTop?: number | null;
}

export interface Tag {
  id: number;
  name: string;
}

export interface NoteTag {
  noteId: number;
  tagId: number;
  position: number;
  tag?: Tag;
}

/**
 * SnippetSegment:
 * - text: plain substring from the note (NOT HTML)
 * - highlight?: when true the renderer should display this segment highlighted (e.g. <strong>)
 */
export interface SnippetSegment {
  text: string;
  highlight?: true;
}

/**
 * SearchResult returned by searchNotes
 */
export interface SearchResult {
  note: Note;
  matchType: 'title' | 'content' | 'tag';
  snippet?: SnippetSegment[]; // renderer maps segments to DOM
}

export interface EditSelectionState {
  selectionStart: number;
  selectionEnd: number;
}

export interface EditSnapshot extends EditSelectionState {
  content: string;
}

/**
 * CategoryHierarchy describes the structure returned by getCategoryHierarchy():
 * {
 *   hierarchy: {
 *     [primaryTag: string]: {
 *       notes: Note[],
 *       secondary: {
 *         [secondaryTag: string]: {
 *           notes: Note[],
 *           tertiary: {
 *             [tertiaryTag: string]: Note[]
 *           }
 *         }
 *       }
 *     }
 *   },
 *   uncategorizedNotes: Note[]
 * }
 */
export type CategoryHierarchy = {
  [primaryTag: string]: {
    notes: Note[];
    secondary: {
      [secondaryTag: string]: {
        notes: Note[];
        tertiary: {
          [tertiaryTag: string]: Note[];
        };
      };
    };
  };
};

export interface CategoryHierarchyResult {
  hierarchy: CategoryHierarchy;
  uncategorizedNotes: Note[];
}

/**
 * Electron preload/IPC API interface (used in global.d.ts and preload.ts)
 */
export interface IElectronAPI {
  createNote: (title: string) => Promise<Note>;
  saveNote: (id: number, content: string) => Promise<Note | null>;
  updateNoteTitle: (id: number, title: string) => Promise<void>;
  loadNote: (id: number) => Promise<string>;
  getAllNotes: () => Promise<Note[]>;
  getNotesPage: (page: number, perPage: number) => Promise<{ notes: Note[]; total: number }>;
  deleteNote: (id: number) => Promise<void>;

  // Tag operations
  addTagToNote: (noteId: number, tagName: string, position: number) => Promise<NoteTag>;
  removeTagFromNote: (noteId: number, tagId: number) => Promise<void>;
  reorderNoteTags: (noteId: number, tagIds: number[]) => Promise<void>;
  getNoteTags: (noteId: number) => Promise<NoteTag[]>;
  getAllTags: () => Promise<Tag[]>;
  getTopTags: (limit: number) => Promise<Tag[]>;

  // Search operations
  searchNotes: (query: string) => Promise<SearchResult[]>;
  searchNotesByTag: (tagName: string) => Promise<SearchResult[]>;

  // Category view operations
  getNotesByPrimaryTag: () => Promise<{ [tagName: string]: Note[] }>;
  getCategoryHierarchy: () => Promise<CategoryHierarchyResult>;
  getHierarchyForTag: (tagName: string) => Promise<CategoryHierarchyResult>;
  getNotesInTrash: () => Promise<Note[]>;
  getLastEditedNote: () => Promise<Note | null>;

  // Runtime controls
  setSpellcheckerLanguages: (langs: string[]) => Promise<{ ok: boolean; error?: string }>;
  // Per-note UI state (progress/cursor) persistence
  saveNoteUiState: (noteId: number, state: { progressPreview?: number | null; progressEdit?: number | null; cursorPos?: number | null; scrollTop?: number | null }) => Promise<void>;
  getNoteUiState: (noteId: number) => Promise<{ progressPreview: number | null; progressEdit: number | null; cursorPos: number | null; scrollTop: number | null }>;
  // PDF export helpers
  selectExportFolder: () => Promise<string | null>;
  exportPdf: (folderPath: string, fileName: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  // Tag management
  renameTag: (tagId: number, newName: string) => Promise<{ ok: boolean; error?: string }>;
  // Data folder sync / import / purge
  triggerSync: () => Promise<{ createdNoteIds: number[]; updatedPaths: Array<{ noteId: number; oldPath: string; newPath: string }>; markedDeletedNoteIds: number[] }>;
  importFolder: () => Promise<{ imported: number; createdNoteIds: number[]; errors?: string[] }>;
  purgeTrash: () => Promise<{ purgedNoteIds: number[]; errors?: string[] }>;
}
