import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AddTagInput,
  CreateNoteInput,
  DeleteNoteInput,
  LoadNoteInput,
  NoteDocument,
  NoteSummary,
  ReorderTagsInput,
  RemoveTagInput,
  RenameTagInput,
  SaveNoteInput,
  TagSummary,
} from '../src/shared/noteLifecycle';

const NOTES_DIR_NAME = 'notes';
const META_PREFIX = '<!-- measly-meta:';
const META_SUFFIX = '-->';
const PROTECTED_TAGS = new Set(['archived', 'deleted', 'temp']);

type ParsedNoteMetadata = {
  tags: string[];
  bodyText: string;
};

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

function normalizeTag(rawTag: string): string {
  return rawTag.trim().toLowerCase().replace(/\s+/g, '-');
}

function uniqueTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map(normalizeTag).filter((tag) => tag.length > 0)));
}

function ensureProtectedTagConstraints(tags: string[]): string[] {
  const normalized = uniqueTags(tags);
  const archived = normalized.includes('archived');
  const deleted = normalized.includes('deleted');

  if (archived && deleted) {
    return normalized.filter((tag) => tag !== 'archived');
  }

  return normalized;
}

function withProtectedTagsFirst(tags: string[]): string[] {
  const normalized = ensureProtectedTagConstraints(tags);
  const protectedTags = normalized.filter((tag) => PROTECTED_TAGS.has(tag));
  const regularTags = normalized.filter((tag) => !PROTECTED_TAGS.has(tag));
  return [...protectedTags, ...regularTags];
}

function serializeNoteText(tags: string[], bodyText: string): string {
  const normalizedBody = normalizeText(bodyText);
  const normalizedTags = withProtectedTagsFirst(tags);

  if (normalizedTags.length === 0) {
    return normalizedBody;
  }

  const header = `${META_PREFIX} ${JSON.stringify({ tags: normalizedTags })} ${META_SUFFIX}`;
  return `${header}\n${normalizedBody}`;
}

function parseNoteMetadata(rawText: string): ParsedNoteMetadata {
  const normalized = normalizeText(rawText);
  const lines = normalized.split('\n');
  const firstLine = lines[0]?.trim() ?? '';

  if (!firstLine.startsWith(META_PREFIX) || !firstLine.endsWith(META_SUFFIX)) {
    return { tags: [], bodyText: normalized };
  }

  const jsonPayload = firstLine.slice(META_PREFIX.length, firstLine.length - META_SUFFIX.length).trim();

  try {
    const parsed = JSON.parse(jsonPayload) as { tags?: unknown };
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags
        .filter((value): value is string => typeof value === 'string')
        .map(normalizeTag)
        .filter((value) => value.length > 0)
      : [];

    return {
      tags,
      bodyText: lines.slice(1).join('\n'),
    };
  } catch {
    return { tags: [], bodyText: normalized };
  }
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

  private notePathFromId(id: string): { fileName: string; filePath: string } {
    const fileName = idToFileName(id);
    return {
      fileName,
      filePath: path.join(this.notesDir, fileName),
    };
  }

  private async readParsedById(id: string): Promise<{ fileName: string; filePath: string; parsed: ParsedNoteMetadata }> {
    const { fileName, filePath } = this.notePathFromId(id);
    const raw = await fs.readFile(filePath, 'utf8');
    return {
      fileName,
      filePath,
      parsed: parseNoteMetadata(raw),
    };
  }

  private async writeParsedById(id: string, tags: string[], bodyText: string): Promise<void> {
    const { filePath } = this.notePathFromId(id);
    const serialized = serializeNoteText(tags, bodyText);
    await fs.writeFile(filePath, serialized, 'utf8');
  }

  private async readSummary(fileName: string): Promise<NoteSummary | null> {
    if (!fileName.toLowerCase().endsWith('.md')) return null;

    const filePath = path.join(this.notesDir, fileName);
    const [stat, text] = await Promise.all([
      fs.stat(filePath),
      fs.readFile(filePath, 'utf8'),
    ]);

    const parsed = parseNoteMetadata(text);

    return {
      id: fileNameToId(fileName),
      fileName,
      title: titleFromText(parsed.bodyText),
      tags: parsed.tags,
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

    const parsed = parseNoteMetadata(text);

    return {
      id: input.id,
      fileName,
      title: titleFromText(parsed.bodyText),
      tags: parsed.tags,
      createdAtMs: stat.birthtimeMs || stat.mtimeMs,
      updatedAtMs: stat.mtimeMs,
      sizeBytes: stat.size,
      text: parsed.bodyText,
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
    const existingRaw = await fs.readFile(filePath, 'utf8');
    const existingParsed = parseNoteMetadata(existingRaw);
    const serialized = serializeNoteText(existingParsed.tags, input.text);

    await fs.writeFile(filePath, serialized, 'utf8');
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

  async getNoteTags(input: LoadNoteInput): Promise<string[]> {
    await this.ensureNotesDir();
    const parsed = await this.readParsedById(input.id);
    return withProtectedTagsFirst(parsed.parsed.tags);
  }

  async addTagToNote(input: AddTagInput): Promise<string[]> {
    await this.ensureNotesDir();
    const parsed = await this.readParsedById(input.id);

    const next = [...parsed.parsed.tags];
    const normalizedTag = normalizeTag(input.tagName);
    if (!normalizedTag) {
      return withProtectedTagsFirst(next);
    }

    const existingIndex = next.indexOf(normalizedTag);
    if (existingIndex >= 0) {
      next.splice(existingIndex, 1);
    }

    const insertionIndex = Math.max(0, Math.min(Math.floor(input.position), next.length));
    next.splice(insertionIndex, 0, normalizedTag);

    const finalTags = withProtectedTagsFirst(next);
    await this.writeParsedById(input.id, finalTags, parsed.parsed.bodyText);
    return finalTags;
  }

  async removeTagFromNote(input: RemoveTagInput): Promise<string[]> {
    await this.ensureNotesDir();
    const parsed = await this.readParsedById(input.id);
    const normalizedTag = normalizeTag(input.tagName);
    const next = parsed.parsed.tags.filter((tag) => tag !== normalizedTag);
    const finalTags = withProtectedTagsFirst(next);
    await this.writeParsedById(input.id, finalTags, parsed.parsed.bodyText);
    return finalTags;
  }

  async reorderNoteTags(input: ReorderTagsInput): Promise<string[]> {
    await this.ensureNotesDir();
    const parsed = await this.readParsedById(input.id);
    const current = withProtectedTagsFirst(parsed.parsed.tags);
    const requested = uniqueTags(input.tagNames);

    const merged: string[] = [];
    for (const tag of requested) {
      if (current.includes(tag)) {
        merged.push(tag);
      }
    }
    for (const tag of current) {
      if (!merged.includes(tag)) {
        merged.push(tag);
      }
    }

    const finalTags = withProtectedTagsFirst(merged);
    await this.writeParsedById(input.id, finalTags, parsed.parsed.bodyText);
    return finalTags;
  }

  async renameTag(input: RenameTagInput): Promise<{ updatedNoteIds: string[] }> {
    await this.ensureNotesDir();

    const fromName = normalizeTag(input.fromName);
    const toName = normalizeTag(input.toName);
    if (!fromName || !toName || fromName === toName) {
      return { updatedNoteIds: [] };
    }

    const notes = await this.listNotes();
    const updatedNoteIds: string[] = [];

    for (const note of notes) {
      if (!note.tags.includes(fromName)) {
        continue;
      }

      const parsed = await this.readParsedById(note.id);
      const next = parsed.parsed.tags.map((tag) => (tag === fromName ? toName : tag));
      const finalTags = withProtectedTagsFirst(next);
      await this.writeParsedById(note.id, finalTags, parsed.parsed.bodyText);
      updatedNoteIds.push(note.id);
    }

    return { updatedNoteIds };
  }

  async listTags(): Promise<TagSummary[]> {
    await this.ensureNotesDir();
    const notes = await this.listNotes();
    const counts = new Map<string, number>();

    for (const note of notes) {
      for (const tag of note.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .map(([name, usageCount]) => ({ name, usageCount }))
      .sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name));
  }
}
