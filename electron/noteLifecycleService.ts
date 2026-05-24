import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  CreateNoteInput,
  DeleteNoteInput,
  LoadNoteInput,
  NoteDocument,
  NoteSummary,
  SaveNoteInput,
} from '../src/shared/noteLifecycle';

const NOTES_DIR_NAME = 'notes';

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function titleFromText(text: string): string {
  const lines = normalizeText(text).split('\n');
  const heading = lines.find((line) => line.startsWith('# ') && line.trim().length > 2);
  if (heading) return heading.slice(2).trim();

  const firstContent = lines.find((line) => line.trim().length > 0);
  return firstContent?.trim() ?? 'Untitled';
}

function idToFileName(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, '_');
  return `${safe}.md`;
}

function fileNameToId(fileName: string): string {
  return fileName.replace(/\.md$/i, '');
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

  constructor(dataRoot: string) {
    this.notesDir = path.join(dataRoot, NOTES_DIR_NAME);
  }

  private async ensureNotesDir(): Promise<void> {
    await fs.mkdir(this.notesDir, { recursive: true });
  }

  private async readSummary(fileName: string): Promise<NoteSummary | null> {
    if (!fileName.toLowerCase().endsWith('.md')) return null;

    const filePath = path.join(this.notesDir, fileName);
    const [stat, text] = await Promise.all([
      fs.stat(filePath),
      fs.readFile(filePath, 'utf8'),
    ]);

    return {
      id: fileNameToId(fileName),
      fileName,
      title: titleFromText(text),
      createdAtMs: stat.birthtimeMs || stat.mtimeMs,
      updatedAtMs: stat.mtimeMs,
      sizeBytes: stat.size,
    };
  }

  async listNotes(): Promise<NoteSummary[]> {
    await this.ensureNotesDir();
    const entries = await fs.readdir(this.notesDir, { withFileTypes: true });
    const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);

    const summaries = await Promise.all(fileNames.map((fileName) => this.readSummary(fileName)));

    return summaries
      .filter((summary): summary is NoteSummary => summary !== null)
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }

  async loadNote(input: LoadNoteInput): Promise<NoteDocument> {
    await this.ensureNotesDir();
    const fileName = idToFileName(input.id);
    const filePath = path.join(this.notesDir, fileName);
    const [text, stat] = await Promise.all([
      fs.readFile(filePath, 'utf8'),
      fs.stat(filePath),
    ]);

    return {
      id: input.id,
      fileName,
      title: titleFromText(text),
      createdAtMs: stat.birthtimeMs || stat.mtimeMs,
      updatedAtMs: stat.mtimeMs,
      sizeBytes: stat.size,
      text,
    };
  }

  async createNote(input?: CreateNoteInput): Promise<NoteDocument> {
    await this.ensureNotesDir();

    const id = buildNoteId(new Date());
    const fileName = idToFileName(id);
    const filePath = path.join(this.notesDir, fileName);
    const text = normalizeText(input?.initialText ?? '');

    await fs.writeFile(filePath, text, 'utf8');
    return this.loadNote({ id });
  }

  async saveNote(input: SaveNoteInput): Promise<NoteSummary> {
    await this.ensureNotesDir();

    const fileName = idToFileName(input.id);
    const filePath = path.join(this.notesDir, fileName);
    const text = normalizeText(input.text);

    await fs.writeFile(filePath, text, 'utf8');
    const summary = await this.readSummary(fileName);

    if (!summary) {
      throw new Error(`Failed to read saved note summary for id=${input.id}`);
    }

    return summary;
  }

  async deleteNote(input: DeleteNoteInput): Promise<void> {
    await this.ensureNotesDir();
    const fileName = idToFileName(input.id);
    const filePath = path.join(this.notesDir, fileName);
    await fs.unlink(filePath);
  }
}
