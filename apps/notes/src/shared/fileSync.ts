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

export type FileSyncApi = {
  importNotes(): Promise<ImportResult>;
  /**
   * Writes a consistent copy of the whole database into the data folder's
   * `backups` folder and shows it in the file explorer. Resolves to the
   * copy's path. The database is the only store of every note, so this is
   * the backup.
   */
  backupDatabase(): Promise<string>;
};
