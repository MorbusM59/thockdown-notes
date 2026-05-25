export const EXTERNAL_FILE_CHANNELS = {
  getPendingPaths: 'external-files:get-pending-paths',
  readContent: 'external-files:read-content',
  writeContent: 'external-files:write-content',
  basename: 'external-files:basename',
  opened: 'external-files:opened',
} as const;

export type ExternalFilesApi = {
  getPendingFilePaths(): Promise<string[]>;
  readFileContent(filePath: string): Promise<string | null>;
  writeFileContent(filePath: string, content: string): Promise<boolean>;
  getFileBasename(filePath: string): Promise<string>;
  onOpenFile(callback: (filePath: string) => void): () => void;
};
