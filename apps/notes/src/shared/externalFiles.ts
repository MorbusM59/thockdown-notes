export const EXTERNAL_FILE_CHANNELS = {
  getPendingPaths: 'external-files:get-pending-paths',
  readContent: 'external-files:read-content',
  writeContent: 'external-files:write-content',
  basename: 'external-files:basename',
  readSnapshot: 'external-files:read-snapshot',
  opened: 'external-files:opened',
} as const;

export type ExternalFilesApi = {
  getPendingFilePaths(): Promise<string[]>;
  readFileContent(filePath: string): Promise<string | null>;
  writeFileContent(filePath: string, content: string): Promise<boolean>;
  getFileBasename(filePath: string): Promise<string>;
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
