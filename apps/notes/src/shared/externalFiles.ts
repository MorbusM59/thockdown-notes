import type { InvokeChannels } from './ipcContract';
/** Messages the main process sends unprompted (not requests). */
export const EXTERNAL_FILE_EVENTS = {
  opened: 'external-files:opened',
} as const;

export const EXTERNAL_FILE_CHANNELS = {
  getPendingFilePaths: 'external-files:get-pending-paths',
  readFileContent: 'external-files:read-content',
  writeFileContent: 'external-files:write-content',
  getFileBasename: 'external-files:basename',
  readFileSnapshot: 'external-files:read-snapshot',
} as const satisfies InvokeChannels<ExternalFilesApi>;

export type ExternalFilesApi = {
  getPendingFilePaths(): Promise<string[]>;
  readFileContent(filePath: string): Promise<string | null>;
  writeFileContent(filePath: string, content: string): Promise<boolean>;
  getFileBasename(filePath: string): Promise<string>;
  /**
   * The filesystem path of a `File` from a drag-and-drop, or '' when it has
   * none. Electron 32 removed the non-standard `File.path`; the path is only
   * readable through `webUtils`, which exists in the preload, not the page.
   */
  getPathForFile(file: File): string;
  /**
   * The file's content AND its modified time, from one read.
   *
   * One call rather than two deliberately: the save-time reconciliation
   * compares what is on disk against what this app last saw there, and then
   * records the disk copy stamped with the file's own mtime. Fetching content
   * and mtime separately can straddle somebody else's write, producing a
   * snapshot whose bytes and timestamp describe different versions of the file
   * -- which is precisely the confusion the snapshot exists to resolve.
   */
  readFileSnapshot(filePath: string): Promise<{ content: string; modifiedAtMs: number } | null>;
  onOpenFile(callback: (filePath: string) => void): () => void;
};
