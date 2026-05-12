import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IElectronAPI, Note, NoteTag, Tag, SearchResult, CategoryHierarchyResult } from './shared/types';

/**
 * Simple runtime validators to avoid passing unexpected values to the main process.
 */
function assertString(v: unknown, name = 'value'): asserts v is string {
  if (typeof v !== 'string') {
    throw new TypeError(`${name} must be a string`);
  }
}
function assertNonEmptyString(v: unknown, name = 'value'): asserts v is string {
  assertString(v, name);
  if (v.trim().length === 0) throw new TypeError(`${name} must be a non-empty string`);
}
function assertNumber(v: unknown, name = 'value'): asserts v is number {
  if (typeof v !== 'number' || Number.isNaN(v)) {
    throw new TypeError(`${name} must be a number`);
  }
}
function assertPositiveInteger(v: unknown, name = 'value'): asserts v is number {
  assertNumber(v, name);
  if (!Number.isInteger(v) || v < 0) throw new TypeError(`${name} must be a non-negative integer`);
}
function assertStringArray(v: unknown, name = 'value'): asserts v is string[] {
  if (!Array.isArray(v)) throw new TypeError(`${name} must be an array`);
  for (const [i, item] of v.entries()) {
    if (typeof item !== 'string') throw new TypeError(`${name}[${i}] must be a string`);
  }
}

function assertBoolean(v: unknown, name = 'value'): asserts v is boolean {
  if (typeof v !== 'boolean') throw new TypeError(`${name} must be a boolean`);
}

/**
 * Exposed API - minimal and validated.
 */
const electronAPI: IElectronAPI & {
  setSpellcheckerLanguages: (langs: string[]) => Promise<{ ok: boolean; error?: string }>;
  requestForceSave: () => Promise<{ ok: boolean }>;
  onForceSave: (cb: (requestId?: string) => void) => { unsubscribe: () => void };
  forceSaveComplete: (requestId?: string) => void;
  // Temp note operations
  createTempNote: (title: string, externalPath: string, originalEncoding?: string) => Promise<Note>;
  updateTempNoteState: (noteId: number, hasUnsavedChanges: boolean, syncMode: boolean) => Promise<void>;
  convertTempNoteToRegular: (noteId: number, newFilePath: string) => Promise<void>;
  getTempNotes: () => Promise<Note[]>;
  deleteTempNote: (noteId: number) => Promise<void>;
  // File association
  getPendingFilePaths: () => Promise<string[]>;
  onOpenMdFile: (callback: (event: IpcRendererEvent, filePath: string) => void) => { unsubscribe: () => void };
  // File operations for temp notes
  readFileContent: (filePath: string) => Promise<string | null>;
  writeFileContent: (filePath: string, content: string) => Promise<boolean>;
  showSaveDialog: (options: any) => Promise<any>;
  getFileBasename: (filePath: string) => Promise<string>;
} = {
  // Notes
  createNote: async (title: string) => {
    assertString(title, 'title');
    return (await ipcRenderer.invoke('create-note', String(title))) as Note;
  },

  saveNote: async (id: number, content: string) => {
    assertPositiveInteger(id, 'id');
    assertString(content, 'content');
    return (await ipcRenderer.invoke('save-note', id, content)) as Note | null;
  },

  updateNoteTitle: async (id: number, title: string) => {
    assertPositiveInteger(id, 'id');
    assertString(title, 'title');
    return (await ipcRenderer.invoke('update-note-title', id, title)) as void;
  },

  loadNote: async (id: number) => {
    assertPositiveInteger(id, 'id');
    return (await ipcRenderer.invoke('load-note', id)) as string;
  },

  getAllNotes: async () => {
    return (await ipcRenderer.invoke('get-all-notes')) as Note[];
  },

  getNotesPage: async (page: number, perPage: number) => {
    assertPositiveInteger(page, 'page');
    assertPositiveInteger(perPage, 'perPage');
    return (await ipcRenderer.invoke('get-notes-page', page, perPage)) as { notes: Note[]; total: number };
  },

  deleteNote: async (id: number) => {
    assertPositiveInteger(id, 'id');
    return (await ipcRenderer.invoke('delete-note', id)) as void;
  },

  saveNoteSnapshot: async (noteId: number, content: string, isManual?: boolean) => {
    assertPositiveInteger(noteId, 'noteId');
    if (typeof content !== 'string') throw new Error('Invalid content');
    return (await ipcRenderer.invoke('save-note-snapshot', noteId, content, isManual)) as void;
  },

  getNoteSnapshots: async (noteId: number) => {
    assertPositiveInteger(noteId, 'noteId');
    return (await ipcRenderer.invoke('get-note-snapshots', noteId)) as any[];
  },

  deleteNoteSnapshot: async (snapshotId: number) => {
    assertPositiveInteger(snapshotId, 'snapshotId');
    return (await ipcRenderer.invoke('delete-note-snapshot', snapshotId)) as void;
  },

  // Tags
  addTagToNote: async (noteId: number, tagName: string, position: number) => {
    assertPositiveInteger(noteId, 'noteId');
    assertNonEmptyString(tagName, 'tagName');
    assertNumber(position, 'position');
    return (await ipcRenderer.invoke('add-tag-to-note', noteId, tagName, position)) as NoteTag;
  },

  removeTagFromNote: async (noteId: number, tagId: number) => {
    assertPositiveInteger(noteId, 'noteId');
    assertPositiveInteger(tagId, 'tagId');
    return (await ipcRenderer.invoke('remove-tag-from-note', noteId, tagId)) as void;
  },

  reorderNoteTags: async (noteId: number, tagIds: number[]) => {
    assertPositiveInteger(noteId, 'noteId');
    if (!Array.isArray(tagIds)) throw new TypeError('tagIds must be an array');
    tagIds.forEach((id, idx) => {
      if (typeof id !== 'number' || !Number.isInteger(id)) throw new TypeError(`tagIds[${idx}] must be an integer`);
    });
    return (await ipcRenderer.invoke('reorder-note-tags', noteId, tagIds)) as void;
  },

  getNoteTags: async (noteId: number) => {
    assertPositiveInteger(noteId, 'noteId');
    return (await ipcRenderer.invoke('get-note-tags', noteId)) as NoteTag[];
  },

  getAllTags: async () => {
    return (await ipcRenderer.invoke('get-all-tags')) as Tag[];
  },

  getTopTags: async (limit: number) => {
    assertPositiveInteger(limit, 'limit');
    return (await ipcRenderer.invoke('get-top-tags', limit)) as Tag[];
  },

  // Search
  searchNotes: async (query: string) => {
    assertString(query, 'query');
    return (await ipcRenderer.invoke('search-notes', query)) as SearchResult[];
  },

  searchNotesByTag: async (tagName: string) => {
    assertNonEmptyString(tagName, 'tagName');
    return (await ipcRenderer.invoke('search-notes-by-tag', tagName)) as SearchResult[];
  },

  // Category / last edited helpers
  getNotesByPrimaryTag: async () => {
    return (await ipcRenderer.invoke('get-notes-by-primary-tag')) as { [tagName: string]: Note[] };
  },

  getCategoryHierarchy: async () => {
    return (await ipcRenderer.invoke('get-category-hierarchy')) as CategoryHierarchyResult;
  },
  getHierarchyForTag: async (tagName: string) => {
    assertNonEmptyString(tagName, 'tagName');
    return (await ipcRenderer.invoke('get-hierarchy-for-tag', tagName)) as CategoryHierarchyResult;
  },
  getNotesInTrash: async () => {
    return (await ipcRenderer.invoke('get-notes-in-trash')) as Note[];
  },

  getLastEditedNote: async () => {
    return (await ipcRenderer.invoke('get-last-edited-note')) as Note | null;
  },

  // Runtime spellchecker control (routes to main)
  setSpellcheckerLanguages: async (langs: string[]) => {
    assertStringArray(langs, 'langs');
    try {
      const res = await ipcRenderer.invoke('set-spellchecker-languages', langs);
      return res as { ok: boolean; error?: string };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  },

  // Per-note UI state helpers
  saveNoteUiState: async (noteId: number, state) => {
    assertPositiveInteger(noteId, 'noteId');
    try {
      await ipcRenderer.invoke('save-note-ui-state', noteId, state);
    } catch (err) {
      // non-fatal
    }
  },

  getNoteUiState: async (noteId: number) => {
    assertPositiveInteger(noteId, 'noteId');
    try {
      return (await ipcRenderer.invoke('get-note-ui-state', noteId)) as { progressPreview: number | null; progressEdit: number | null; cursorPos: number | null; scrollTop: number | null };
    } catch (err) {
      return { progressPreview: null, progressEdit: null, cursorPos: null, scrollTop: null };
    }
  },

  // Export PDF helpers
  selectExportFolder: async () => {
    try {
      return (await ipcRenderer.invoke('select-export-folder')) as string | null;
    } catch (err) {
      return null;
    }
  },

  exportPdf: async (folderPath: string, fileName: string) => {
    assertNonEmptyString(folderPath, 'folderPath');
    assertNonEmptyString(fileName, 'fileName');
    return (await ipcRenderer.invoke('export-pdf', folderPath, fileName)) as { ok: boolean; path?: string; error?: string };
  },

  exportMd: async (folderPath: string, fileName: string, content: string) => {
    assertNonEmptyString(folderPath, 'folderPath');
    assertNonEmptyString(fileName, 'fileName');
    assertString(content, 'content');
    return (await ipcRenderer.invoke('export-md', folderPath, fileName, content)) as { ok: boolean; path?: string; error?: string };
  },
  // Tag renaming
  renameTag: async (tagId: number, newName: string) => {
    assertPositiveInteger(tagId, 'tagId');
    assertNonEmptyString(newName, 'newName');
    try {
      return (await ipcRenderer.invoke('rename-tag', tagId, newName)) as { ok: boolean; error?: string };
    } catch (err) {
      return { ok: false, error: (err as any)?.message ?? String(err) };
    }
  },

  // Data folder sync/import/purge
  triggerSync: async () => {
    try {
      return (await ipcRenderer.invoke('trigger-sync')) as { createdNoteIds: number[]; updatedPaths: Array<{ noteId: number; oldPath: string; newPath: string }>; markedDeletedNoteIds: number[] };
    } catch (err) {
      return { createdNoteIds: [], updatedPaths: [], markedDeletedNoteIds: [] };
    }
  },

  importFolder: async () => {
    try {
      return (await ipcRenderer.invoke('import-folder')) as { imported: number; createdNoteIds: number[]; errors?: string[] };
    } catch (err) {
      return { imported: 0, createdNoteIds: [], errors: [(err as any)?.message ?? String(err)] };
    }
  },

  purgeTrash: async () => {
    try {
      return (await ipcRenderer.invoke('purge-trash')) as { purgedNoteIds: number[]; errors?: string[] };
    } catch (err) {
      return { purgedNoteIds: [], errors: [(err as any)?.message ?? String(err)] };
    }
  },

  // Force-save flow: request is routed via main (so focused window receives do-force-save),
  // and renderer will respond with forceSaveComplete which main waits for.
  requestForceSave: async () => {
    try {
      const res = await ipcRenderer.invoke('request-force-save');
      return res as { ok: boolean };
    } catch (err) {
      return { ok: false };
    }
  },

  // Register a local callback that will be invoked when main broadcasts the do-force-save event.
  // The callback receives the requestId (string) if provided.
  onForceSave: (cb: (requestId?: string) => void) => {
    const wrapper = (_event: IpcRendererEvent, requestId?: string) => {
      try {
        cb(requestId);
      } catch (err) {
        console.warn('onForceSave handler error', err);
      }
    };
    ipcRenderer.on('do-force-save', wrapper);
    return {
      unsubscribe: () => {
        ipcRenderer.removeListener('do-force-save', wrapper);
      },
    };
  },

  // Called by renderer to notify main that the force-save for requestId is complete.
  // This is an untrusted notification so keep it simple (main will verify sender).
  forceSaveComplete: (requestId?: string) => {
    try {
      ipcRenderer.send('force-save-complete', requestId);
    } catch (err) {
      // swallow - non-fatal
    }
  },

  // Temp note operations
  createTempNote: async (title: string, externalPath: string, originalEncoding?: string) => {
    assertNonEmptyString(title, 'title');
    assertNonEmptyString(externalPath, 'externalPath');
    return (await ipcRenderer.invoke('create-temp-note', title, externalPath, originalEncoding)) as Note | null;
  },

  updateTempNoteState: async (noteId: number, hasUnsavedChanges: boolean, syncMode: boolean) => {
    assertPositiveInteger(noteId, 'noteId');
    assertBoolean(hasUnsavedChanges, 'hasUnsavedChanges');
    assertBoolean(syncMode, 'syncMode');
    return (await ipcRenderer.invoke('update-temp-note-state', noteId, hasUnsavedChanges, syncMode)) as void;
  },

  convertTempNoteToRegular: async (noteId: number, newFilePath: string) => {
    assertPositiveInteger(noteId, 'noteId');
    assertNonEmptyString(newFilePath, 'newFilePath');
    return (await ipcRenderer.invoke('convert-temp-note-to-regular', noteId, newFilePath)) as void;
  },

  getTempNotes: async () => {
    return (await ipcRenderer.invoke('get-temp-notes')) as Note[];
  },

  deleteTempNote: async (noteId: number) => {
    assertPositiveInteger(noteId, 'noteId');
    return (await ipcRenderer.invoke('delete-temp-note', noteId)) as void;
  },

  // File operations for temp notes
  readFileContent: async (filePath: string) => {
    assertNonEmptyString(filePath, 'filePath');
    return (await ipcRenderer.invoke('read-file-content', filePath)) as string | null;
  },

  writeFileContent: async (filePath: string, content: string) => {
    assertNonEmptyString(filePath, 'filePath');
    assertString(content, 'content');
    return (await ipcRenderer.invoke('write-file-content', filePath, content)) as boolean;
  },

  showSaveDialog: async (options: any) => {
    return (await ipcRenderer.invoke('show-save-dialog', options)) as any;
  },

  getFileBasename: async (filePath: string) => {
    assertNonEmptyString(filePath, 'filePath');
    return (await ipcRenderer.invoke('get-file-basename', filePath)) as string;
  },

  // File association
  getPendingFilePaths: async () => {
    return (await ipcRenderer.invoke('get-pending-file-paths')) as string[];
  },

  onOpenMdFile: (callback: (event: IpcRendererEvent, filePath: string) => void) => {
    const listener = (event: IpcRendererEvent, filePath: string) => callback(event, filePath);
    ipcRenderer.on('open-md-file', listener);
    return {
      unsubscribe: () => ipcRenderer.removeListener('open-md-file', listener)
    };
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
export {}; // module
