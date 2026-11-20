import type { InvokeChannels } from './ipcContract';
export const FILE_SYNC_CHANNELS = {
  importNotes: 'file-sync:import-notes',
  backupDatabase: 'file-sync:backup-database',
} as const satisfies InvokeChannels<FileSyncApi>;

export type ImportResult = {
  imported: number;
  createdNoteIds: string[];
  errors?: string[];
};

/** What reading a Markdown backup (src/shared/notesBackup.ts) did, beyond the notes it created. */
export type BackupImportResult = ImportResult & {
  importedImages: number;
  /** Notes identical to the one already under their id, left as they were. */
  skipped: number;
  /** Ids changed on the way in, `[from, to]`: existing notes and images renamed out of the way. Open notes still hold the old ids; the caller rewrites them. */
  renamedNotes: Array<[string, string]>;
  renamedImages: Array<[string, string]>;
};

export type ImportNotesRequest = {
  /** Notes an editor holds: a backup that renames existing ids leaves their text to the caller. */
  openNoteIds: string[];
  /** A backup's id conflicts rename the existing notes and images (`-OLD`) rather than the incoming ones (`-NEW`). */
  renameExisting: boolean;
};

export type FileSyncApi = {
  /**
   * Picks Markdown or text files to import as new notes, or a backup's
   * `thockdown.json` to read the whole backup back (src/shared/notesBackup.ts).
   */
  importNotes(request: ImportNotesRequest): Promise<ImportResult & Partial<BackupImportResult>>;
  /**
   * Writes a consistent copy of the whole database into the data folder's
   * `backups` folder and shows it in the file explorer. Resolves to the
   * copy's path. The database is the only store of every note, so this is
   * the backup.
   */
  backupDatabase(): Promise<string>;
};
