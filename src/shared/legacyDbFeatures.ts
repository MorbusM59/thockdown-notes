export const LEGACY_DB_CHANNELS = {
  getLastEditedNoteId: 'legacy-db:get-last-edited-note-id',
  getTrashNoteIds: 'legacy-db:get-trash-note-ids',
  searchNoteIdsByTag: 'legacy-db:search-note-ids-by-tag',
  saveNoteUiState: 'legacy-db:save-note-ui-state',
  getNoteUiState: 'legacy-db:get-note-ui-state',
  saveNoteSnapshot: 'legacy-db:save-note-snapshot',
  getNoteSnapshots: 'legacy-db:get-note-snapshots',
  deleteNoteSnapshot: 'legacy-db:delete-note-snapshot',
  createTempNote: 'legacy-db:create-temp-note',
  updateTempNoteState: 'legacy-db:update-temp-note-state',
  convertTempNoteToRegular: 'legacy-db:convert-temp-note-to-regular',
  getTempNoteIds: 'legacy-db:get-temp-note-ids',
  getTempNoteIdByExternalPath: 'legacy-db:get-temp-note-id-by-external-path',
  syncExternalNoteToFile: 'legacy-db:sync-external-note-to-file',
  getExternalSyncState: 'legacy-db:get-external-sync-state',
  deleteTempNote: 'legacy-db:delete-temp-note',
} as const;

export type NoteUiStatePayload = {
  progressPreview?: number | null;
  progressEdit?: number | null;
  cursorPos?: number | null;
  scrollTop?: number | null;
};

export type NoteUiState = {
  progressPreview: number | null;
  progressEdit: number | null;
  cursorPos: number | null;
  scrollTop: number | null;
};

export type NoteSnapshot = {
  id: number;
  noteId: string;
  content: string;
  timestamp: string;
  isManual: boolean;
};

export type ExternalSyncState = {
  isExternal: boolean;
  hasUnsavedChanges: boolean;
  isInSync: boolean;
};

export type LegacyDbApi = {
  getLastEditedNoteId(): Promise<string | null>;
  getTrashNoteIds(): Promise<string[]>;
  searchNoteIdsByTag(tagQuery: string): Promise<string[]>;
  saveNoteUiState(noteId: string, payload: NoteUiStatePayload): Promise<void>;
  getNoteUiState(noteId: string): Promise<NoteUiState>;
  saveNoteSnapshot(noteId: string, content: string, isManual?: boolean): Promise<void>;
  getNoteSnapshots(noteId: string): Promise<NoteSnapshot[]>;
  deleteNoteSnapshot(snapshotId: number): Promise<void>;
  createTempNote(title: string, externalPath: string, originalEncoding?: string): Promise<string>;
  updateTempNoteState(noteId: string, hasUnsavedChanges: boolean, syncMode: boolean): Promise<void>;
  convertTempNoteToRegular(noteId: string, newFilePath: string): Promise<void>;
  getTempNoteIds(): Promise<string[]>;
  getTempNoteIdByExternalPath(externalPath: string): Promise<string | null>;
  syncExternalNoteToFile(noteId: string): Promise<boolean>;
  getExternalSyncState(noteId: string): Promise<ExternalSyncState>;
  deleteTempNote(noteId: string): Promise<void>;
};
