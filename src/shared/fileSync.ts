export const FILE_SYNC_CHANNELS = {
  syncExistingNotes: 'file-sync:sync-existing-notes',
  importNotes: 'file-sync:import-notes',
} as const;

export type SyncResult = {
  createdNoteIds: string[];
  updatedPaths: Array<{ noteId: string; oldPath: string; newPath: string }>;
  markedDeletedNoteIds: string[];
};

export type ImportResult = {
  imported: number;
  createdNoteIds: string[];
  errors?: string[];
};

export type FileSyncApi = {
  syncExistingNotes(): Promise<SyncResult>;
  importNotes(): Promise<ImportResult>;
};
