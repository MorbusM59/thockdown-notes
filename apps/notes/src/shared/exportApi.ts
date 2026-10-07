import type { InvokeChannels } from './ipcContract';

export interface ExportResult {
  ok: boolean;
  path?: string;
  error?: string;
}

/** Writing a note out of the app: choosing where, and the two formats. */
export interface ExportApi {
  selectExportFolder(): Promise<string | null>;
  exportPdf(folderPath: string, fileName: string, htmlContent?: string): Promise<ExportResult>;
  exportMarkdown(folderPath: string, fileName: string, markdownText: string): Promise<ExportResult>;
  /** Opens an http(s) link in the system browser. */
  openExternalUrl(url: string): Promise<void>;
}

export const EXPORT_CHANNELS = {
  selectExportFolder: 'select-export-folder',
  exportPdf: 'export-pdf',
  exportMarkdown: 'export-md',
  openExternalUrl: 'open-external-url',
} as const satisfies InvokeChannels<ExportApi>;
