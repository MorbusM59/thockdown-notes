import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AddTagInput,
  CreateNoteInput,
  DeleteNoteInput,
  LoadNoteInput,
  NoteDocument,
  NoteSummary,
  NoteUiState,
  NoteUiStatePayload,
  ReorderTagsInput,
  RemoveTagInput,
  RenameTagInput,
  SaveNoteInput,
  TagSummary,
} from '../src/shared/noteLifecycle';
import { sanitizeDocumentText } from '../src/shared/textSanitization';
import type { DatabaseService, NoteRecord } from './databaseService';

const NOTES_DIR_NAME = 'notes';
const META_PREFIX = '<!-- measly-meta:';
const META_SUFFIX = '-->';
const EXTERNAL_TAG = 'EXTERNAL';

type ParsedNoteMetadata = {
  bodyText: string;
};

function normalizeText(text: string): string {
  return sanitizeDocumentText(text);
}

function normalizeLineEndingsOnly(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n');
}

function checksumText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function titleFromText(text: string): string {
  const lines = normalizeText(text).split('\n');
  const heading = lines.find((line) => line.startsWith('# ') && line.trim().length > 2);
  if (heading) return heading.slice(2).trim();

  const firstContent = lines.find((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && trimmed !== '#';
  });
  return firstContent?.trim() ?? 'Untitled';
}

function parseNoteMetadata(rawText: string, sanitize: boolean): ParsedNoteMetadata {
  const normalized = sanitize ? normalizeText(rawText) : normalizeLineEndingsOnly(rawText);
  const lines = normalized.split('\n');
  const firstLine = lines[0]?.trim() ?? '';

  if (!firstLine.startsWith(META_PREFIX) || !firstLine.endsWith(META_SUFFIX)) {
    return { bodyText: normalized };
  }

  const jsonPayload = firstLine.slice(META_PREFIX.length, firstLine.length - META_SUFFIX.length).trim();

  try {
    JSON.parse(jsonPayload);

    return {
      bodyText: lines.slice(1).join('\n'),
    };
  } catch {
    return { bodyText: normalized };
  }
}

function isExternalTag(tagName: string): boolean {
  return tagName.trim().toLowerCase() === 'external';
}

function idToFileName(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, '_');
  return `${safe}.md`;
}

function buildNoteId(now: Date): string {
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const suffix = randomBytes(5).toString('base64url').toUpperCase();
  return `${yy}-${mm}-${dd}_${hh}-${min}_${suffix}`;
}

export class NoteLifecycleService {
  private readonly notesDir: string;
  private readonly databaseService: DatabaseService;

  constructor(dataRoot: string, databaseService: DatabaseService) {
    this.notesDir = path.join(dataRoot, NOTES_DIR_NAME);
    this.databaseService = databaseService;
  }

  private async ensureNotesDir(): Promise<void> {
    await fs.mkdir(this.notesDir, { recursive: true });
  }

  private notePathFromId(id: string): { fileName: string; filePath: string } {
    const fileName = idToFileName(id);
    return {
      fileName,
      filePath: path.join(this.notesDir, fileName),
    };
  }

  private async readSummary(record: NoteRecord): Promise<NoteSummary | null> {
    try {
      const text = record.isTemp
        ? (this.databaseService.getNoteContentSnapshot(record.id) ?? '')
        : await fs.readFile(record.filePath, 'utf8');

      const stat = record.isTemp
        ? {
            birthtimeMs: record.createdAtMs,
            mtimeMs: record.updatedAtMs,
            size: Buffer.byteLength(text, 'utf8'),
          }
        : await fs.stat(record.filePath);

      const parsed = parseNoteMetadata(text, true);
      const fileName = path.basename(record.filePath);

      const tags = this.databaseService.getNoteTags(record.id);
      return {
        id: record.id,
        fileName,
        title: titleFromText(parsed.bodyText),
        tags,
        createdAtMs: stat.birthtimeMs || record.createdAtMs,
        updatedAtMs: stat.mtimeMs,
        sizeBytes: stat.size,
        isExternal: tags.includes(EXTERNAL_TAG),
        externalPath: record.externalPath ?? (record.isTemp ? record.filePath : null) ?? null,
        hasUnsavedChanges: record.hasUnsavedChanges,
        isInSync: Boolean(record.syncMode && !record.hasUnsavedChanges),
      };
    } catch {
      return null;
    }
  }

  async listNotes(): Promise<NoteSummary[]> {
    const records = this.databaseService.listNoteRecords();
    const summaries = await Promise.all(records.map((record) => this.readSummary(record)));

    return summaries
      .filter((summary): summary is NoteSummary => summary !== null)
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }

  async loadNote(input: LoadNoteInput): Promise<NoteDocument> {
    const record = this.databaseService.getNoteRecord(input.id);
    const filePath = record?.filePath ?? path.join(this.notesDir, idToFileName(input.id));
    const fileName = path.basename(filePath);
    let rawText: string
    if (record?.isTemp) {
      const snapshotText = this.databaseService.getNoteContentSnapshot(input.id)
      if (snapshotText !== null) {
        rawText = snapshotText
      } else if (record.externalPath) {
        rawText = await fs.readFile(record.externalPath, 'utf8')
      } else {
        rawText = ''
      }
    } else {
      rawText = await fs.readFile(filePath, 'utf8')
    }

    const stat = record?.isTemp
      ? {
          birthtimeMs: record.createdAtMs,
          mtimeMs: record.updatedAtMs,
          size: Buffer.byteLength(rawText, 'utf8'),
        }
      : await fs.stat(filePath);

    let text = rawText;
    let shouldSanitize = true;

    // External/temp notes are always full-pass sanitized.
    if (!record?.isTemp) {
      const storedChecksum = record?.contentChecksum;
      const currentChecksum = checksumText(rawText);
      // Trusted fast path for internal notes: unchanged content bypasses sanitizer.
      shouldSanitize = !(storedChecksum && storedChecksum === currentChecksum);
    }

    if (shouldSanitize) {
      const sanitizedText = normalizeText(rawText);
      text = sanitizedText;

      if (record?.isTemp) {
        const sanitizedTitle = titleFromText(sanitizedText);
        const shouldUpdateTempNote =
          sanitizedText !== rawText ||
          sanitizedTitle !== record.title;

        if (shouldUpdateTempNote) {
          this.databaseService.upsertNoteContent({
            id: input.id,
            title: sanitizedTitle,
            filePath,
            text: sanitizedText,
            createdAtMs: record.createdAtMs,
            updatedAtMs: Date.now(),
            isTemp: true,
            hasUnsavedChanges: record.hasUnsavedChanges,
            syncMode: record.syncMode,
          });
        }
      } else {
        if (sanitizedText !== rawText) {
          await fs.writeFile(filePath, sanitizedText, 'utf8');
        }

        this.databaseService.upsertNoteContent({
          id: input.id,
          title: titleFromText(sanitizedText),
          filePath,
          text: sanitizedText,
          createdAtMs: stat.birthtimeMs || record?.createdAtMs || stat.mtimeMs,
          updatedAtMs: stat.mtimeMs,
        });
      }
    }

    const parsed = parseNoteMetadata(text, shouldSanitize);

    const tags = this.databaseService.getNoteTags(input.id);
    return {
      id: input.id,
      fileName,
      title: titleFromText(parsed.bodyText),
      tags,
      createdAtMs: stat.birthtimeMs || record?.createdAtMs || stat.mtimeMs,
      updatedAtMs: stat.mtimeMs,
      sizeBytes: Buffer.byteLength(text, 'utf8'),
      text: parsed.bodyText,
      isExternal: tags.includes(EXTERNAL_TAG),
      externalPath: record?.externalPath ?? (record?.isTemp ? record.filePath : null) ?? null,
      hasUnsavedChanges: record?.hasUnsavedChanges ?? false,
      isInSync: Boolean(record?.syncMode && !record?.hasUnsavedChanges),
    };
  }

  async createNote(input?: CreateNoteInput): Promise<NoteDocument> {
    const id = buildNoteId(new Date());
    const text = normalizeText(input?.initialText ?? '');
    const title = input?.title ? input.title.trim() || titleFromText(text) : titleFromText(text);
    const createdAtMs = Date.now();
    const updatedAtMs = createdAtMs;

    if (input?.externalPath) {
      const externalPath = input.externalPath;
      const filePath = externalPath;
      this.databaseService.upsertNoteContent({
        id,
        title,
        filePath,
        externalPath,
        text,
        createdAtMs,
        updatedAtMs,
        isTemp: true,
        hasUnsavedChanges: false,
        syncMode: true,
      });
      await this.databaseService.addTagToNote(id, EXTERNAL_TAG, 0);
      return this.loadNote({ id });
    }

    await this.ensureNotesDir();
    const fileName = idToFileName(id);
    const filePath = path.join(this.notesDir, fileName);

    await fs.writeFile(filePath, text, 'utf8');
    const stat = await fs.stat(filePath);
    this.databaseService.upsertNoteContent({
      id,
      title,
      filePath,
      text,
      createdAtMs: stat.birthtimeMs || stat.mtimeMs,
      updatedAtMs: stat.mtimeMs,
    });
    return this.loadNote({ id });
  }

  async saveNote(input: SaveNoteInput): Promise<NoteSummary> {
    const record = this.databaseService.getNoteRecord(input.id);
    const filePath = record?.filePath ?? path.join(this.notesDir, idToFileName(input.id));
    const text = normalizeText(input.text);

    if (record?.isTemp) {
      const nowMs = Date.now();
      this.databaseService.upsertNoteContent({
        id: input.id,
        title: titleFromText(text),
        filePath,
        externalPath: record.externalPath,
        text,
        createdAtMs: record.createdAtMs,
        updatedAtMs: nowMs,
        isTemp: true,
        hasUnsavedChanges: true,
        syncMode: false,
      });
      this.databaseService.updateTempNoteState(input.id, true, false);
      const summary = await this.readSummary(this.databaseService.getNoteRecord(input.id) ?? {
        id: input.id,
        title: titleFromText(text),
        filePath,
        createdAtMs: record.createdAtMs,
        updatedAtMs: nowMs,
        contentChecksum: null,
        isTemp: true,
        externalPath: record.externalPath,
        hasUnsavedChanges: true,
        syncMode: false,
      });

      if (!summary) {
        throw new Error(`Failed to read saved temp note summary for id=${input.id}`);
      }

      return summary;
    }

    await fs.writeFile(filePath, text, 'utf8');
    const stat = await fs.stat(filePath);
    this.databaseService.upsertNoteContent({
      id: input.id,
      title: titleFromText(text),
      filePath,
      text,
      createdAtMs: stat.birthtimeMs || record?.createdAtMs || stat.mtimeMs,
      updatedAtMs: stat.mtimeMs,
      externalPath: record?.externalPath ?? null,
      hasUnsavedChanges: record?.hasUnsavedChanges ?? false,
      syncMode: record?.syncMode ?? false,
    });
    const summary = await this.readSummary(this.databaseService.getNoteRecord(input.id) ?? {
      id: input.id,
      title: titleFromText(text),
      filePath,
      createdAtMs: stat.birthtimeMs || stat.mtimeMs,
      updatedAtMs: stat.mtimeMs,
      contentChecksum: null,
      isTemp: false,
      externalPath: null,
      hasUnsavedChanges: false,
      syncMode: false,
    });

    if (!summary) {
      throw new Error(`Failed to read saved note summary for id=${input.id}`);
    }

    return summary;
  }

  async deleteNote(input: DeleteNoteInput): Promise<void> {
    const record = this.databaseService.getNoteRecord(input.id);

    if (record?.isTemp) {
      this.databaseService.deleteTempNote(input.id);
      return;
    }

    const filePath = record?.filePath ?? path.join(this.notesDir, idToFileName(input.id));
    await fs.unlink(filePath);
    this.databaseService.deleteNote(input.id);
  }

  async saveNoteUiState(input: { id: string; payload: NoteUiStatePayload }): Promise<void> {
    this.databaseService.saveNoteUiState(input.id, input.payload);
  }

  async getNoteUiState(input: LoadNoteInput): Promise<NoteUiState> {
    return this.databaseService.getNoteUiState(input.id);
  }

  async updateExternalNoteState(input: { id: string; hasUnsavedChanges: boolean; syncMode: boolean }): Promise<NoteSummary> {
    this.databaseService.updateTempNoteState(input.id, input.hasUnsavedChanges, input.syncMode);
    const summary = await this.readSummary(this.databaseService.getNoteRecord(input.id)!);
    if (!summary) {
      throw new Error(`Failed to read updated external note summary for id=${input.id}`);
    }
    return summary;
  }

  async saveNoteSnapshot(input: { id: string; content: string; isManual?: boolean }): Promise<void> {
    this.databaseService.saveNoteSnapshot(input.id, input.content, Boolean(input.isManual));
  }

  async getNoteSnapshots(input: LoadNoteInput): Promise<Array<{ id: number; noteId: string; content: string; timestamp: string; isManual: boolean }>> {
    return this.databaseService.getNoteSnapshots(input.id);
  }

  async syncExternalNoteToFile(input: { id: string; content: string }): Promise<boolean> {
    const record = this.databaseService.getNoteRecord(input.id);
    if (!record?.isTemp || !record.externalPath) {
      return false;
    }

    try {
      await fs.writeFile(record.externalPath, input.content, 'utf8');
      const verification = await fs.readFile(record.externalPath, 'utf8');
      if (verification !== input.content) {
        return false;
      }
      this.databaseService.markExternalNoteSynced(input.id);
      return true;
    } catch {
      return false;
    }
  }

  async getNoteIdByExternalPath(input: { externalPath: string }): Promise<string | null> {
    return this.databaseService.getTempNoteIdByExternalPath(input.externalPath);
  }

  async getNoteTags(input: LoadNoteInput): Promise<string[]> {
    return this.databaseService.getNoteTags(input.id);
  }

  async addTagToNote(input: AddTagInput): Promise<string[]> {
    return this.databaseService.addTagToNote(input.id, input.tagName, input.position);
  }

  async removeTagFromNote(input: RemoveTagInput): Promise<string[]> {
    const record = this.databaseService.getNoteRecord(input.id);
    const removingExternalTag = isExternalTag(input.tagName);

    if (record?.isTemp && removingExternalTag) {
      await this.ensureNotesDir();
      const { filePath } = this.notePathFromId(input.id);
      const snapshot = this.databaseService.getNoteContentSnapshot(input.id) ?? '';
      await fs.writeFile(filePath, snapshot, 'utf8');
      const stat = await fs.stat(filePath);

      this.databaseService.convertTempNoteToRegular(input.id, filePath);
      this.databaseService.upsertNoteContent({
        id: input.id,
        title: titleFromText(snapshot),
        filePath,
        text: snapshot,
        createdAtMs: record.createdAtMs,
        updatedAtMs: stat.mtimeMs,
      });

      return this.databaseService.removeTagFromNote(input.id, EXTERNAL_TAG);
    }

    return this.databaseService.removeTagFromNote(input.id, input.tagName);
  }

  async reorderNoteTags(input: ReorderTagsInput): Promise<string[]> {
    return this.databaseService.reorderNoteTags(input.id, input.tagNames);
  }

  async renameTag(input: RenameTagInput): Promise<{ updatedNoteIds: string[] }> {
    return this.databaseService.renameTag(input);
  }

  async listTags(): Promise<TagSummary[]> {
    return this.databaseService.listTags();
  }
}
