import { createHash } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { sanitizeDocumentText } from '../src/shared/textSanitization';
import type { TextureCacheHit, TextureCachePurgeRequest, TextureCacheRequest } from '../src/shared/textures';
import type { UiLayoutLoadout } from '../src/shared/loadouts';
import { DEFAULT_TEXTURE_MATERIALS, TEXTURE_SURFACES, type TextureMaterialSettings, type TextureMaterialsBySurface } from '../src/textures/types';

const require = createRequire(import.meta.url);
const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3');

const DB_FILE_NAME = 'measly-notes.db';
const EXTERNAL_TAG = 'EXTERNAL';
const PROTECTED_TAGS = ['deleted', 'archived', EXTERNAL_TAG] as const;
const META_PREFIX = '<!-- measly-meta:';
const META_SUFFIX = '-->';
const TEXTURE_CACHE_DEFAULT_MAX_ENTRIES = 96;
const TEXTURE_CACHE_DEFAULT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;
const UI_LOADOUT_MAX_ENTRIES = 9;

const DEFAULT_UI_LAYOUT_LOADOUT: UiLayoutLoadout = {
  viewStyle: 'modern',
  viewFontSize: 'm',
  viewSpacing: 'cozy',
  editorStyle: 'syne',
  editorFontSize: 'm',
  editorSpacing: 'cozy',
  editorGlyphPaddingPx: 1,
  sidebarWidthRatio: 0.306,
  tagSplitRatio: 0.645,
  renderScrollDynamic: 1.5,
  renderScrollResponsiveness: 0.1,
  renderScrollTotalTimeSec: 0,
  renderScrollMaxSpeedPxPerSec: 10000,
  renderScrollSkew: 1,
  highlightColors: {
    caret: 'rgba(120, 115, 112, 0.8)',
    selection: 'rgba(199, 94, 0, 0.49)',
    background: '#e9e6e3',
    topBackground: 'rgba(196, 187, 182, 0.49)',
    bottomBackground: 'rgba(196, 187, 182, 0.49)',
    gridOutline: '#00000022',
  },
  textureMaterials: DEFAULT_TEXTURE_MATERIALS,
};

type SqliteDatabase = import('better-sqlite3').Database;

type NoteSyncRow = {
  id: string;
  title: string;
  filePath: string;
  text: string;
  tags: string[];
  createdAtMs: number;
  updatedAtMs: number;
};

type NoteRecordRow = {
  id: string;
  title: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
  contentChecksum: string | null;
  isTemp: number;
  externalPath: string | null;
  hasUnsavedChanges: number;
  syncMode: number;
};

export type NoteRecord = {
  id: string;
  title: string;
  filePath: string;
  createdAtMs: number;
  updatedAtMs: number;
  contentChecksum: string | null;
  isTemp: boolean;
  externalPath: string | null;
  hasUnsavedChanges: boolean;
  syncMode: boolean;
};

export type ExternalSyncState = {
  isExternal: boolean;
  hasUnsavedChanges: boolean;
  isInSync: boolean;
};

type ParsedLegacyNote = {
  tags: string[];
  bodyText: string;
  hasLegacyHeader: boolean;
};

function normalizeTagName(rawTag: string): string {
  const normalized = rawTag.trim().toLowerCase().replace(/\s+/g, '-');
  if (normalized === 'external') {
    return EXTERNAL_TAG;
  }
  return normalized;
}

function uniqueNormalizedTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map(normalizeTagName).filter((tag) => tag.length > 0)));
}

function ensureProtectedTagConstraints(tags: string[]): string[] {
  const normalized = uniqueNormalizedTags(tags);
  const archived = normalized.includes('archived');
  const deleted = normalized.includes('deleted');

  if (archived && deleted) {
    return normalized.filter((tag) => tag !== 'archived');
  }

  return normalized;
}

function withProtectedTagsFirst(tags: string[]): string[] {
  const normalized = ensureProtectedTagConstraints(tags);
  const protectedTags = normalized.filter((tag) => PROTECTED_TAGS.includes(tag as typeof PROTECTED_TAGS[number]));
  const regularTags = normalized.filter((tag) => !PROTECTED_TAGS.includes(tag as typeof PROTECTED_TAGS[number]));
  return [...protectedTags, ...regularTags];
}

function hasExternalTag(tags: string[]): boolean {
  return tags.includes(EXTERNAL_TAG);
}

function normalizeText(text: string): string {
  return sanitizeDocumentText(text);
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

function parseIsoToMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function parseLegacyMetadata(rawText: string): ParsedLegacyNote {
  const normalized = normalizeText(rawText);
  const lines = normalized.split('\n');
  const firstLine = lines[0]?.trim() ?? '';

  if (!firstLine.startsWith(META_PREFIX) || !firstLine.endsWith(META_SUFFIX)) {
    return { tags: [], bodyText: normalized, hasLegacyHeader: false };
  }

  const jsonPayload = firstLine.slice(META_PREFIX.length, firstLine.length - META_SUFFIX.length).trim();

  try {
    const parsed = JSON.parse(jsonPayload) as { tags?: unknown };
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags
        .filter((value): value is string => typeof value === 'string')
        .map(normalizeTagName)
        .filter((value) => value.length > 0)
      : [];

    return {
      tags,
      bodyText: lines.slice(1).join('\n'),
      hasLegacyHeader: true,
    };
  } catch {
    return { tags: [], bodyText: normalized, hasLegacyHeader: false };
  }
}

type NormalizedTextureCacheRequest = {
  surface: TextureCacheRequest['surface'];
  width: number;
  height: number;
  seed: number;
  granularity: number;
  vSteps: number;
  algorithmVersion: number;
};

type UiLoadoutRow = {
  slot: number;
  payloadJson: string;
  signature: string;
};

function normalizeTextureCacheRequest(request: TextureCacheRequest): NormalizedTextureCacheRequest {
  return {
    surface: request.surface,
    width: Math.max(1, Math.round(request.width)),
    height: Math.max(1, Math.round(request.height)),
    seed: Math.max(0, Math.round(request.seed)),
    granularity: Number(request.granularity.toFixed(4)),
    vSteps: Math.max(1, Math.round(request.vSteps)),
    algorithmVersion: Math.max(1, Math.round(request.algorithmVersion)),
  };
}

function textureCacheCompositeKey(request: NormalizedTextureCacheRequest): string {
  return [
    request.surface,
    request.width,
    request.height,
    request.seed,
    request.granularity,
    request.vSteps,
    request.algorithmVersion,
  ].join('|');
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function sanitizeString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeTextureMaterialSettings(
  input: unknown,
  fallback: TextureMaterialSettings,
): TextureMaterialSettings {
  const source = input && typeof input === 'object' ? input as Partial<TextureMaterialSettings> : {};
  const color = source.color && typeof source.color === 'object'
    ? source.color as Partial<TextureMaterialSettings['color']>
    : {};

  return {
    seed: clampInteger(source.seed, 0, 0x7fffffff, fallback.seed),
    granularity: clampInteger(source.granularity, 1, 20, fallback.granularity),
    vSteps: clampInteger(source.vSteps, 1, 20, fallback.vSteps),
    color: {
      h: clampInteger(color.h, 0, 360, fallback.color.h),
      s: clampNumber(color.s, 0, 1, fallback.color.s),
      v: clampNumber(color.v, 0, 1, fallback.color.v),
      a: clampNumber(color.a, 0, 1, fallback.color.a),
    },
  };
}

function normalizeTextureMaterials(input: unknown): TextureMaterialsBySurface {
  const source = input && typeof input === 'object' ? input as Partial<TextureMaterialsBySurface> : {};
  const next = { ...DEFAULT_TEXTURE_MATERIALS } as TextureMaterialsBySurface;

  for (const surface of TEXTURE_SURFACES) {
    next[surface] = normalizeTextureMaterialSettings(source[surface], DEFAULT_TEXTURE_MATERIALS[surface]);
  }

  return next;
}

function normalizeUiLayoutLoadout(input: unknown): UiLayoutLoadout | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const source = input as Partial<UiLayoutLoadout>;
  const highlights = source.highlightColors && typeof source.highlightColors === 'object'
    ? source.highlightColors as Partial<UiLayoutLoadout['highlightColors']>
    : {};

  const viewStyle = source.viewStyle === 'modern' || source.viewStyle === 'narrow' || source.viewStyle === 'cute' || source.viewStyle === 'print'
    ? source.viewStyle
    : DEFAULT_UI_LAYOUT_LOADOUT.viewStyle;

  const viewFontSize = source.viewFontSize === 'xs' || source.viewFontSize === 's' || source.viewFontSize === 'm' || source.viewFontSize === 'l' || source.viewFontSize === 'xl'
    ? source.viewFontSize
    : DEFAULT_UI_LAYOUT_LOADOUT.viewFontSize;

  const viewSpacing = source.viewSpacing === 'tight' || source.viewSpacing === 'compact' || source.viewSpacing === 'cozy' || source.viewSpacing === 'wide'
    ? source.viewSpacing
    : DEFAULT_UI_LAYOUT_LOADOUT.viewSpacing;

  const editorStyle = source.editorStyle === 'syne' || source.editorStyle === 'redhat'
    ? source.editorStyle
    : DEFAULT_UI_LAYOUT_LOADOUT.editorStyle;

  const editorFontSize = source.editorFontSize === 'xs' || source.editorFontSize === 's' || source.editorFontSize === 'm' || source.editorFontSize === 'l' || source.editorFontSize === 'xl'
    ? source.editorFontSize
    : DEFAULT_UI_LAYOUT_LOADOUT.editorFontSize;

  const editorSpacing = source.editorSpacing === 'tight' || source.editorSpacing === 'compact' || source.editorSpacing === 'cozy' || source.editorSpacing === 'wide'
    ? source.editorSpacing
    : DEFAULT_UI_LAYOUT_LOADOUT.editorSpacing;

  return {
    viewStyle,
    viewFontSize,
    viewSpacing,
    editorStyle,
    editorFontSize,
    editorSpacing,
    editorGlyphPaddingPx: clampInteger(source.editorGlyphPaddingPx, 0, 1, DEFAULT_UI_LAYOUT_LOADOUT.editorGlyphPaddingPx),
    sidebarWidthRatio: clampNumber(source.sidebarWidthRatio, 0, 1, DEFAULT_UI_LAYOUT_LOADOUT.sidebarWidthRatio),
    tagSplitRatio: clampNumber(source.tagSplitRatio, 0, 1, DEFAULT_UI_LAYOUT_LOADOUT.tagSplitRatio),
    renderScrollDynamic: clampNumber(source.renderScrollDynamic, 0.1, 5, DEFAULT_UI_LAYOUT_LOADOUT.renderScrollDynamic),
    renderScrollResponsiveness: clampNumber(source.renderScrollResponsiveness, 0.1, 5, DEFAULT_UI_LAYOUT_LOADOUT.renderScrollResponsiveness),
    renderScrollTotalTimeSec: clampNumber(source.renderScrollTotalTimeSec, 0, 2, DEFAULT_UI_LAYOUT_LOADOUT.renderScrollTotalTimeSec),
    renderScrollMaxSpeedPxPerSec: clampNumber(source.renderScrollMaxSpeedPxPerSec, 1000, 100000, DEFAULT_UI_LAYOUT_LOADOUT.renderScrollMaxSpeedPxPerSec),
    renderScrollSkew: clampNumber(source.renderScrollSkew, 0.1, 5, DEFAULT_UI_LAYOUT_LOADOUT.renderScrollSkew),
    highlightColors: {
      caret: sanitizeString(highlights.caret, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.caret),
      selection: sanitizeString(highlights.selection, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.selection),
      background: sanitizeString(highlights.background, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.background),
      topBackground: sanitizeString(highlights.topBackground, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.topBackground),
      bottomBackground: sanitizeString(highlights.bottomBackground, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.bottomBackground),
      gridOutline: sanitizeString(highlights.gridOutline, DEFAULT_UI_LAYOUT_LOADOUT.highlightColors.gridOutline),
    },
    textureMaterials: normalizeTextureMaterials(source.textureMaterials),
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`);
  return `{${entries.join(',')}}`;
}

export class DatabaseService {
  private readonly dataRoot: string;
  private readonly notesDir: string;
  private readonly dbPath: string;
  private db: SqliteDatabase | null = null;

  constructor(dataRoot: string) {
    this.dataRoot = dataRoot;
    this.notesDir = path.join(dataRoot, 'notes');
    this.dbPath = path.join(dataRoot, DB_FILE_NAME);
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.dataRoot, { recursive: true });

    const db = new BetterSqlite3(this.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');

    this.db = db;
    this.ensureSchema();
    this.ensureProtectedTags();
  }

  close(): void {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }

  getDatabasePath(): string {
    return this.dbPath;
  }

  async bootstrapFromFilesystem(): Promise<void> {
    await fs.mkdir(this.notesDir, { recursive: true });
    const db = this.requireDb();

    const entries = await fs.readdir(this.notesDir, { withFileTypes: true });
    const fileNames = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => entry.name);

    const syncedRows: NoteSyncRow[] = [];
    const existingRows = db.prepare(`
      SELECT nt.noteId AS noteId, t.name AS tagName
      FROM note_tags nt
      JOIN tags t ON nt.tagId = t.id
      ORDER BY nt.noteId ASC, nt.position ASC
    `).all() as Array<{ noteId: string; tagName: string }>;
    const existingTagsByNoteId = new Map<string, string[]>();
    for (const row of existingRows) {
      if (!existingTagsByNoteId.has(row.noteId)) {
        existingTagsByNoteId.set(row.noteId, []);
      }
      existingTagsByNoteId.get(row.noteId)!.push(row.tagName);
    }

    for (const fileName of fileNames) {
      const filePath = path.join(this.notesDir, fileName);
      const [stat, rawText] = await Promise.all([
        fs.stat(filePath),
        fs.readFile(filePath, 'utf8'),
      ]);
      const parsed = parseLegacyMetadata(rawText);
      const id = fileName.replace(/\.md$/i, '');
      syncedRows.push({
        id,
        title: titleFromText(parsed.bodyText),
        filePath,
        text: parsed.bodyText,
        tags: parsed.hasLegacyHeader
          ? withProtectedTagsFirst(parsed.tags)
          : withProtectedTagsFirst(existingTagsByNoteId.get(id) ?? []),
        createdAtMs: stat.birthtimeMs || stat.mtimeMs,
        updatedAtMs: stat.mtimeMs,
      });
    }

    const upsertNoteStmt = db.prepare(`
      INSERT INTO notes (
        id,
        title,
        filePath,
        createdAt,
        updatedAt,
        lastEdited,
        contentChecksum,
        isTemp,
        hasUnsavedChanges,
        syncMode
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        filePath = excluded.filePath,
        createdAt = excluded.createdAt,
        updatedAt = excluded.updatedAt,
        lastEdited = excluded.lastEdited,
        contentChecksum = excluded.contentChecksum
    `);

    const deleteMissingNotesStmt = db.prepare('DELETE FROM notes WHERE id = ?');
    const deleteNoteTagsStmt = db.prepare('DELETE FROM note_tags WHERE noteId = ?');
    const insertNoteTagStmt = db.prepare('INSERT OR REPLACE INTO note_tags (noteId, tagId, position) VALUES (?, ?, ?)');
    const selectAllNoteIdsStmt = db.prepare('SELECT id FROM notes');

    const findTagStmt = db.prepare('SELECT id FROM tags WHERE name = ?');
    const insertTagStmt = db.prepare('INSERT INTO tags (name) VALUES (?)');

    const upsertFtsStmt = db.prepare('INSERT OR REPLACE INTO notes_fts (noteId, title, content) VALUES (?, ?, ?)');
    const deleteMissingFtsStmt = db.prepare('DELETE FROM notes_fts WHERE noteId = ?');

    const toIso = (timestampMs: number): string => new Date(timestampMs).toISOString();

    const getOrCreateTagId = (tagNameRaw: string): number => {
      const tagName = normalizeTagName(tagNameRaw);
      if (!tagName) {
        throw new Error('Cannot create empty tag');
      }
      const existing = findTagStmt.get(tagName) as { id: number } | undefined;
      if (existing) return existing.id;
      const created = insertTagStmt.run(tagName);
      return Number(created.lastInsertRowid);
    };

    const seenIds = new Set<string>();

    const tx = db.transaction((rows: NoteSyncRow[]) => {
      for (const row of rows) {
        const createdAtIso = toIso(row.createdAtMs);
        const updatedAtIso = toIso(row.updatedAtMs);

        upsertNoteStmt.run(
          row.id,
          row.title,
          row.filePath,
          createdAtIso,
          updatedAtIso,
          updatedAtIso,
          checksumText(row.text),
        );

        deleteNoteTagsStmt.run(row.id);
        row.tags.forEach((tagName, position) => {
          const tagId = getOrCreateTagId(tagName);
          insertNoteTagStmt.run(row.id, tagId, position);
        });

        seenIds.add(row.id);
      }

      const existingIds = selectAllNoteIdsStmt.all() as Array<{ id: string }>;
      for (const { id } of existingIds) {
        if (seenIds.has(id)) continue;
        deleteMissingNotesStmt.run(id);
        deleteMissingFtsStmt.run(id);
      }
    });

    tx(syncedRows);

    for (const row of syncedRows) {
      upsertFtsStmt.run(row.id, row.title, row.text);
    }

    this.normalizeAllTagPositions();
  }

  runSanityChecks(): {
    normalizedTagOrderCount: number;
    missingNoteFiles: string[];
    orphanedTagRows: number;
  } {
    const db = this.requireDb();

    const missingNoteFiles: string[] = [];

    const orphanedTagRows = Number((db.prepare(`
      SELECT COUNT(*) AS c
      FROM note_tags nt
      LEFT JOIN notes n ON n.id = nt.noteId
      LEFT JOIN tags t ON t.id = nt.tagId
      WHERE n.id IS NULL OR t.id IS NULL
    `).get() as { c: number }).c);

    const normalizedTagOrderCount = this.normalizeAllTagPositions();

    const fsRows = db.prepare('SELECT id, filePath FROM notes').all() as Array<{ id: string; filePath: string }>;
    for (const row of fsRows) {
      try {
        // Synchronous exists-check keeps startup cheap and deterministic.
        const exists = existsSync(row.filePath);
        if (!exists) {
          missingNoteFiles.push(row.id);
        }
      } catch {
        missingNoteFiles.push(row.id);
      }
    }

    return {
      normalizedTagOrderCount,
      missingNoteFiles,
      orphanedTagRows,
    };
  }

  upsertNoteContent(input: {
    id: string;
    title: string;
    filePath: string;
    text: string;
    createdAtMs: number;
    updatedAtMs: number;
  }): void {
    const db = this.requireDb();
    const createdAtIso = new Date(input.createdAtMs).toISOString();
    const updatedAtIso = new Date(input.updatedAtMs).toISOString();
    const normalizedText = normalizeText(input.text);
    const contentChecksum = checksumText(normalizedText);

    db.prepare(`
      INSERT INTO notes (
        id,
        title,
        filePath,
        createdAt,
        updatedAt,
        lastEdited,
        contentChecksum,
        isTemp,
        hasUnsavedChanges,
        syncMode
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        filePath = excluded.filePath,
        createdAt = excluded.createdAt,
        updatedAt = excluded.updatedAt,
        lastEdited = excluded.lastEdited,
        contentChecksum = excluded.contentChecksum
    `).run(
      input.id,
      input.title,
      input.filePath,
      createdAtIso,
      updatedAtIso,
      updatedAtIso,
      contentChecksum,
    );

    db.prepare('INSERT OR REPLACE INTO notes_fts (noteId, title, content) VALUES (?, ?, ?)')
      .run(input.id, input.title, normalizedText);
  }

  listNoteRecords(): NoteRecord[] {
    const db = this.requireDb();
    const rows = db.prepare(`
      SELECT id, title, filePath, createdAt, updatedAt, contentChecksum, isTemp, externalPath, hasUnsavedChanges, syncMode
      FROM notes
      ORDER BY datetime(updatedAt) DESC
    `).all() as NoteRecordRow[];

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      filePath: row.filePath,
      createdAtMs: parseIsoToMs(row.createdAt),
      updatedAtMs: parseIsoToMs(row.updatedAt),
      contentChecksum: row.contentChecksum,
      isTemp: Boolean(row.isTemp),
      externalPath: row.externalPath,
      hasUnsavedChanges: Boolean(row.hasUnsavedChanges),
      syncMode: Boolean(row.syncMode),
    }));
  }

  getNoteRecord(noteId: string): NoteRecord | null {
    const db = this.requireDb();
    const row = db.prepare(`
      SELECT id, title, filePath, createdAt, updatedAt, contentChecksum, isTemp, externalPath, hasUnsavedChanges, syncMode
      FROM notes
      WHERE id = ?
      LIMIT 1
    `).get(noteId) as NoteRecordRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      filePath: row.filePath,
      createdAtMs: parseIsoToMs(row.createdAt),
      updatedAtMs: parseIsoToMs(row.updatedAt),
      contentChecksum: row.contentChecksum,
      isTemp: Boolean(row.isTemp),
      externalPath: row.externalPath,
      hasUnsavedChanges: Boolean(row.hasUnsavedChanges),
      syncMode: Boolean(row.syncMode),
    };
  }

  getNoteContentSnapshot(noteId: string): string | null {
    const db = this.requireDb();
    const row = db.prepare('SELECT content FROM notes_fts WHERE noteId = ?').get(noteId) as { content: string } | undefined;
    return row?.content ?? null;
  }

  getExternalSyncState(noteId: string): ExternalSyncState {
    const record = this.getNoteRecord(noteId);
    if (!record?.isTemp) {
      return {
        isExternal: false,
        hasUnsavedChanges: false,
        isInSync: true,
      };
    }

    return {
      isExternal: true,
      hasUnsavedChanges: record.hasUnsavedChanges,
      isInSync: record.syncMode && !record.hasUnsavedChanges,
    };
  }

  deleteNote(id: string): void {
    const db = this.requireDb();
    db.prepare('DELETE FROM notes WHERE id = ?').run(id);
    db.prepare('DELETE FROM notes_fts WHERE noteId = ?').run(id);
  }

  getNoteTags(noteId: string): string[] {
    const db = this.requireDb();
    const rows = db.prepare(`
      SELECT t.name
      FROM note_tags nt
      JOIN tags t ON nt.tagId = t.id
      WHERE nt.noteId = ?
      ORDER BY nt.position ASC
    `).all(noteId) as Array<{ name: string }>;

    return rows.map((row) => row.name);
  }

  addTagToNote(noteId: string, rawTagName: string, position: number): string[] {
    const normalizedTag = normalizeTagName(rawTagName);
    if (!normalizedTag) {
      return this.getNoteTags(noteId);
    }

    const current = this.getNoteTags(noteId);
    if (hasExternalTag(current) && normalizedTag !== EXTERNAL_TAG) {
      return current;
    }
    const withoutDup = current.filter((tag) => tag !== normalizedTag);
    const insertionIndex = Math.max(0, Math.min(Math.floor(position), withoutDup.length));
    withoutDup.splice(insertionIndex, 0, normalizedTag);

    let next = withoutDup;
    if (PROTECTED_TAGS.includes(normalizedTag as typeof PROTECTED_TAGS[number])) {
      next = [
        normalizedTag,
        ...withoutDup.filter((tag) => !PROTECTED_TAGS.includes(tag as typeof PROTECTED_TAGS[number])),
      ];
    }

    const finalTags = withProtectedTagsFirst(next);
    this.writeNoteTags(noteId, finalTags);
    return finalTags;
  }

  removeTagFromNote(noteId: string, rawTagName: string): string[] {
    const normalizedTag = normalizeTagName(rawTagName);
    const current = this.getNoteTags(noteId);
    if (hasExternalTag(current) && normalizedTag !== EXTERNAL_TAG) {
      return current;
    }
    const finalTags = withProtectedTagsFirst(current.filter((tag) => tag !== normalizedTag));
    this.writeNoteTags(noteId, finalTags);
    return finalTags;
  }

  reorderNoteTags(noteId: string, requestedTagNames: string[]): string[] {
    const current = this.getNoteTags(noteId);
    if (hasExternalTag(current)) {
      return current;
    }
    const requested = uniqueNormalizedTags(requestedTagNames);

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
    this.writeNoteTags(noteId, finalTags);
    return finalTags;
  }

  renameTag(input: { fromName: string; toName: string }): { updatedNoteIds: string[] } {
    const db = this.requireDb();
    const fromName = normalizeTagName(input.fromName);
    const toName = normalizeTagName(input.toName);

    if (!fromName || !toName || fromName === toName) {
      return { updatedNoteIds: [] };
    }

    if (PROTECTED_TAGS.includes(fromName as typeof PROTECTED_TAGS[number])) {
      throw new Error('This tag is protected and cannot be renamed');
    }

    const existingTag = db.prepare('SELECT id FROM tags WHERE name = ?').get(fromName) as { id: number } | undefined;
    if (!existingTag) {
      return { updatedNoteIds: [] };
    }

    const updatedNoteIds = db.prepare('SELECT noteId FROM note_tags WHERE tagId = ?').all(existingTag.id) as Array<{ noteId: string }>;
    const conflict = db.prepare('SELECT id FROM tags WHERE name = ?').get(toName) as { id: number } | undefined;

    const tx = db.transaction(() => {
      if (conflict && conflict.id !== existingTag.id) {
        db.prepare(`
          UPDATE note_tags
          SET tagId = ?
          WHERE tagId = ?
            AND NOT EXISTS (
              SELECT 1
              FROM note_tags nt2
              WHERE nt2.noteId = note_tags.noteId
                AND nt2.tagId = ?
            )
        `).run(conflict.id, existingTag.id, conflict.id);

        db.prepare('DELETE FROM note_tags WHERE tagId = ?').run(existingTag.id);
        db.prepare('DELETE FROM tags WHERE id = ?').run(existingTag.id);
      } else {
        db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(toName, existingTag.id);
      }
    });

    tx();

    return { updatedNoteIds: updatedNoteIds.map((row) => row.noteId) };
  }

  listTags(): Array<{ name: string; usageCount: number }> {
    const db = this.requireDb();

    return db.prepare(`
      SELECT t.name AS name, COUNT(nt.noteId) AS usageCount
      FROM tags t
      LEFT JOIN note_tags nt ON t.id = nt.tagId
      GROUP BY t.id, t.name
      HAVING usageCount > 0 OR t.name IN ('deleted', 'archived', 'EXTERNAL')
      ORDER BY usageCount DESC, t.name ASC
    `).all() as Array<{ name: string; usageCount: number }>;
  }

  getLastEditedNoteId(): string | null {
    const db = this.requireDb();
    const row = db.prepare(`
      SELECT id
      FROM notes
      WHERE lastEdited IS NOT NULL
      ORDER BY datetime(lastEdited) DESC
      LIMIT 1
    `).get() as { id: string } | undefined;
    return row?.id ?? null;
  }

  getTrashNoteIds(): string[] {
    const db = this.requireDb();
    const rows = db.prepare(`
      SELECT n.id AS id
      FROM notes n
      JOIN note_tags nt ON n.id = nt.noteId
      JOIN tags t ON nt.tagId = t.id
      WHERE LOWER(t.name) = 'deleted'
      ORDER BY datetime(n.lastEdited) DESC, datetime(n.updatedAt) DESC
    `).all() as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  searchNoteIdsByTag(tagQuery: string): string[] {
    const db = this.requireDb();
    const normalized = normalizeTagName(tagQuery);
    if (!normalized) return [];

    const rows = db.prepare(`
      SELECT DISTINCT n.id AS id
      FROM notes n
      JOIN note_tags nt ON n.id = nt.noteId
      JOIN tags t ON nt.tagId = t.id
      WHERE LOWER(t.name) LIKE ?
      ORDER BY datetime(n.updatedAt) DESC
    `).all(`%${normalized}%`) as Array<{ id: string }>;

    return rows.map((row) => row.id);
  }

  saveNoteUiState(noteId: string, payload: {
    progressPreview?: number | null;
    progressEdit?: number | null;
    cursorPos?: number | null;
    scrollTop?: number | null;
  }): void {
    const db = this.requireDb();
    const hasProgressPreview = Object.prototype.hasOwnProperty.call(payload, 'progressPreview');
    const hasProgressEdit = Object.prototype.hasOwnProperty.call(payload, 'progressEdit');
    const hasCursorPos = Object.prototype.hasOwnProperty.call(payload, 'cursorPos');
    const hasScrollTop = Object.prototype.hasOwnProperty.call(payload, 'scrollTop');

    db.prepare(`
      UPDATE notes
      SET
        progressPreview = CASE WHEN ? THEN ? ELSE progressPreview END,
        progressEdit = CASE WHEN ? THEN ? ELSE progressEdit END,
        cursorPos = CASE WHEN ? THEN ? ELSE cursorPos END,
        scrollTop = CASE WHEN ? THEN ? ELSE scrollTop END
      WHERE id = ?
    `).run(
      hasProgressPreview ? 1 : 0,
      payload.progressPreview ?? null,
      hasProgressEdit ? 1 : 0,
      payload.progressEdit ?? null,
      hasCursorPos ? 1 : 0,
      payload.cursorPos ?? null,
      hasScrollTop ? 1 : 0,
      payload.scrollTop ?? null,
      noteId,
    );
  }

  getNoteUiState(noteId: string): {
    progressPreview: number | null;
    progressEdit: number | null;
    cursorPos: number | null;
    scrollTop: number | null;
  } {
    const db = this.requireDb();

    const row = db.prepare(`
      SELECT progressPreview, progressEdit, cursorPos, scrollTop
      FROM notes
      WHERE id = ?
    `).get(noteId) as {
      progressPreview: number | null;
      progressEdit: number | null;
      cursorPos: number | null;
      scrollTop: number | null;
    } | undefined;

    return {
      progressPreview: row?.progressPreview ?? null,
      progressEdit: row?.progressEdit ?? null,
      cursorPos: row?.cursorPos ?? null,
      scrollTop: row?.scrollTop ?? null,
    };
  }

  saveNoteSnapshot(noteId: string, content: string, isManual = false): void {
    const db = this.requireDb();
    const timestamp = new Date().toISOString();

    db.prepare(`
      INSERT INTO note_snapshots (noteId, content, timestamp, isManual)
      VALUES (?, ?, ?, ?)
    `).run(noteId, content, timestamp, isManual ? 1 : 0);
  }

  getNoteSnapshots(noteId: string): Array<{
    id: number;
    noteId: string;
    content: string;
    timestamp: string;
    isManual: boolean;
  }> {
    const db = this.requireDb();
    const rows = db.prepare(`
      SELECT id, noteId, content, timestamp, isManual
      FROM note_snapshots
      WHERE noteId = ?
      ORDER BY datetime(timestamp) DESC
    `).all(noteId) as Array<{
      id: number;
      noteId: string;
      content: string;
      timestamp: string;
      isManual: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      noteId: row.noteId,
      content: row.content,
      timestamp: row.timestamp,
      isManual: Boolean(row.isManual),
    }));
  }

  deleteNoteSnapshot(snapshotId: number): void {
    const db = this.requireDb();
    db.prepare('DELETE FROM note_snapshots WHERE id = ?').run(snapshotId);
  }

  createTempNote(input: { title: string; externalPath: string; originalEncoding?: string }): string {
    const db = this.requireDb();
    const id = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO notes (
        id,
        title,
        filePath,
        createdAt,
        updatedAt,
        lastEdited,
        contentChecksum,
        isTemp,
        externalPath,
        hasUnsavedChanges,
        syncMode,
        originalEncoding
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 0, 0, ?)
    `).run(
      id,
      input.title,
      input.externalPath,
      now,
      now,
      now,
      null,
      input.externalPath,
      input.originalEncoding ?? null,
    );

    const tempTagId = this.getOrCreateTagId(EXTERNAL_TAG);
    this.writeTagRelations(id, [tempTagId]);

    return id;
  }

  updateTempNoteState(noteId: string, hasUnsavedChanges: boolean, syncMode: boolean): void {
    const db = this.requireDb();
    db.prepare(`
      UPDATE notes
      SET hasUnsavedChanges = ?, syncMode = ?, updatedAt = ?
      WHERE id = ? AND isTemp = 1
    `).run(hasUnsavedChanges ? 1 : 0, syncMode ? 1 : 0, new Date().toISOString(), noteId);
  }

  convertTempNoteToRegular(noteId: string, newFilePath: string): void {
    const db = this.requireDb();
    db.prepare(`
      UPDATE notes
      SET
        isTemp = 0,
        filePath = ?,
        externalPath = NULL,
        hasUnsavedChanges = 0,
        syncMode = 0,
        originalEncoding = NULL,
        updatedAt = ?
      WHERE id = ? AND isTemp = 1
    `).run(newFilePath, new Date().toISOString(), noteId);

    const tempTagId = this.findTagIdByName(EXTERNAL_TAG);
    if (tempTagId !== null) {
      const dbRows = db.prepare('SELECT tagId FROM note_tags WHERE noteId = ? ORDER BY position ASC').all(noteId) as Array<{ tagId: number }>;
      const filtered = dbRows.map((row) => row.tagId).filter((tagId) => tagId !== tempTagId);
      this.writeTagRelations(noteId, filtered);
    }
  }

  markExternalNoteSynced(noteId: string): void {
    const db = this.requireDb();
    db.prepare(`
      UPDATE notes
      SET hasUnsavedChanges = 0, syncMode = 1, updatedAt = ?
      WHERE id = ? AND isTemp = 1
    `).run(new Date().toISOString(), noteId);
  }

  getTempNoteIds(): string[] {
    const db = this.requireDb();
    const rows = db.prepare('SELECT id FROM notes WHERE isTemp = 1 ORDER BY datetime(lastEdited) DESC').all() as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  getTempNoteIdByExternalPath(externalPath: string): string | null {
    const db = this.requireDb();
    const row = db.prepare(`
      SELECT id
      FROM notes
      WHERE isTemp = 1 AND externalPath = ?
      ORDER BY datetime(updatedAt) DESC
      LIMIT 1
    `).get(externalPath) as { id: string } | undefined;

    return row?.id ?? null;
  }

  deleteTempNote(noteId: string): void {
    const db = this.requireDb();
    db.prepare('DELETE FROM notes WHERE id = ? AND isTemp = 1').run(noteId);
    db.prepare('DELETE FROM notes_fts WHERE noteId = ?').run(noteId);
  }

  getTextureCache(request: TextureCacheRequest): TextureCacheHit | null {
    const db = this.requireDb();
    const normalized = normalizeTextureCacheRequest(request);

    const row = db.prepare(`
      SELECT data, mimeType
      FROM texture_pattern_cache
      WHERE surface = ?
        AND width = ?
        AND height = ?
        AND seed = ?
        AND granularity = ?
        AND vSteps = ?
        AND algorithmVersion = ?
      LIMIT 1
    `).get(
      normalized.surface,
      normalized.width,
      normalized.height,
      normalized.seed,
      normalized.granularity,
      normalized.vSteps,
      normalized.algorithmVersion,
    ) as { data: Buffer; mimeType: string } | undefined;

    if (!row) {
      return null;
    }

    db.prepare(`
      UPDATE texture_pattern_cache
      SET createdAt = ?
      WHERE surface = ?
        AND width = ?
        AND height = ?
        AND seed = ?
        AND granularity = ?
        AND vSteps = ?
        AND algorithmVersion = ?
    `).run(
      Date.now(),
      normalized.surface,
      normalized.width,
      normalized.height,
      normalized.seed,
      normalized.granularity,
      normalized.vSteps,
      normalized.algorithmVersion,
    );

    return {
      data: new Uint8Array(row.data),
      mimeType: row.mimeType,
    };
  }

  saveTextureCache(request: TextureCacheRequest, payload: TextureCacheHit): void {
    const db = this.requireDb();
    const normalized = normalizeTextureCacheRequest(request);

    db.prepare(`
      INSERT OR REPLACE INTO texture_pattern_cache (
        surface,
        width,
        height,
        seed,
        granularity,
        vSteps,
        algorithmVersion,
        data,
        mimeType,
        createdAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      normalized.surface,
      normalized.width,
      normalized.height,
      normalized.seed,
      normalized.granularity,
      normalized.vSteps,
      normalized.algorithmVersion,
      Buffer.from(payload.data),
      payload.mimeType || 'image/webp',
      Date.now(),
    );

    this.purgeTextureCache();
  }

  purgeTextureCache(request?: TextureCachePurgeRequest): number {
    const db = this.requireDb();
    const maxEntries = Math.max(0, Math.floor(request?.maxEntries ?? TEXTURE_CACHE_DEFAULT_MAX_ENTRIES));
    const maxAgeMs = Math.max(0, Math.floor(request?.maxAgeMs ?? TEXTURE_CACHE_DEFAULT_MAX_AGE_MS));
    const keep = Array.isArray(request?.keep) ? request.keep : [];
    const keepKeys = new Set(keep.map((item) => textureCacheCompositeKey(normalizeTextureCacheRequest(item))));
    const cutoffMs = Date.now() - maxAgeMs;

    const rows = db.prepare(`
      SELECT rowid, surface, width, height, seed, granularity, vSteps, algorithmVersion, createdAt
      FROM texture_pattern_cache
      ORDER BY createdAt DESC
    `).all() as Array<{
      rowid: number;
      surface: TextureCacheRequest['surface'];
      width: number;
      height: number;
      seed: number;
      granularity: number;
      vSteps: number;
      algorithmVersion: number;
      createdAt: number;
    }>;

    const deleteStmt = db.prepare('DELETE FROM texture_pattern_cache WHERE rowid = ?');
    let retainedCount = 0;
    let deletedCount = 0;

    const tx = db.transaction(() => {
      for (const row of rows) {
        const key = textureCacheCompositeKey({
          surface: row.surface,
          width: row.width,
          height: row.height,
          seed: row.seed,
          granularity: row.granularity,
          vSteps: row.vSteps,
          algorithmVersion: row.algorithmVersion,
        });

        const isProtected = keepKeys.has(key);
        const isExpired = row.createdAt < cutoffMs;
        const exceedsCap = maxEntries > 0 && retainedCount >= maxEntries;

        if (!isProtected && (isExpired || exceedsCap)) {
          deleteStmt.run(row.rowid);
          deletedCount += 1;
          continue;
        }

        retainedCount += 1;
      }
    });

    tx();
    return deletedCount;
  }

  listUiLoadouts(): UiLayoutLoadout[] {
    const db = this.requireDb();
    const rows = db.prepare(`
      SELECT slot, payloadJson, signature
      FROM ui_loadouts
      ORDER BY slot ASC
    `).all() as UiLoadoutRow[];

    const output: UiLayoutLoadout[] = [];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.payloadJson) as unknown;
        const normalized = normalizeUiLayoutLoadout(parsed);
        if (!normalized) {
          continue;
        }
        output.push(normalized);
      } catch {
        continue;
      }
    }

    return output.slice(0, UI_LOADOUT_MAX_ENTRIES);
  }

  saveUiLoadout(slot: unknown, loadout: unknown): UiLayoutLoadout[] {
    const db = this.requireDb();
    const normalized = normalizeUiLayoutLoadout(loadout);
    if (!normalized) {
      return this.listUiLoadouts();
    }

    const targetSlot = clampInteger(slot, 0, UI_LOADOUT_MAX_ENTRIES - 1, 0);
    const payloadJson = JSON.stringify(normalized);
    const signature = stableStringify(normalized);
    const timestamp = Date.now();

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM ui_loadouts WHERE signature = ? AND slot <> ?').run(signature, targetSlot);

      db.prepare(`
        INSERT OR REPLACE INTO ui_loadouts (slot, payloadJson, signature, updatedAt)
        VALUES (?, ?, ?, ?)
      `).run(targetSlot, payloadJson, signature, timestamp);

      const rows = db.prepare(`
        SELECT slot, payloadJson, signature
        FROM ui_loadouts
        ORDER BY slot ASC
      `).all() as UiLoadoutRow[];

      const kept = rows.slice(0, UI_LOADOUT_MAX_ENTRIES);
      db.prepare('DELETE FROM ui_loadouts').run();

      const insertStmt = db.prepare(`
        INSERT INTO ui_loadouts (slot, payloadJson, signature, updatedAt)
        VALUES (?, ?, ?, ?)
      `);

      kept.forEach((row, index) => {
        insertStmt.run(index, row.payloadJson, row.signature, timestamp);
      });
    });

    tx();
    return this.listUiLoadouts();
  }

  private ensureSchema(): void {
    const db = this.requireDb();

    db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        filePath TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        lastEdited TEXT,
        progressPreview REAL,
        progressEdit REAL,
        cursorPos INTEGER,
        scrollTop INTEGER,
        contentChecksum TEXT,
        isTemp INTEGER DEFAULT 0,
        externalPath TEXT,
        hasUnsavedChanges INTEGER DEFAULT 0,
        syncMode INTEGER DEFAULT 0,
        originalEncoding TEXT,
        fileToken TEXT UNIQUE
      );

      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
      );

      CREATE TABLE IF NOT EXISTS note_tags (
        noteId TEXT NOT NULL,
        tagId INTEGER NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (noteId, tagId),
        FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_note_tags_note ON note_tags(noteId);
      CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tagId);

      CREATE TABLE IF NOT EXISTS note_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        noteId TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        isManual INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_note_snapshots_note_timestamp
      ON note_snapshots(noteId, timestamp DESC);

      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        noteId UNINDEXED,
        title,
        content
      );

      CREATE TABLE IF NOT EXISTS texture_pattern_cache (
        surface TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        seed INTEGER NOT NULL,
        granularity REAL NOT NULL,
        vSteps INTEGER NOT NULL,
        algorithmVersion INTEGER NOT NULL,
        data BLOB NOT NULL,
        mimeType TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        PRIMARY KEY (surface, width, height, seed, granularity, vSteps, algorithmVersion)
      );

      CREATE INDEX IF NOT EXISTS idx_texture_pattern_cache_created_at ON texture_pattern_cache(createdAt DESC);

      CREATE TABLE IF NOT EXISTS ui_loadouts (
        slot INTEGER PRIMARY KEY,
        payloadJson TEXT NOT NULL,
        signature TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ui_loadouts_signature ON ui_loadouts(signature);
    `);

    this.ensureNotesColumn('contentChecksum', 'TEXT');
  }

  private ensureNotesColumn(columnName: string, columnDefinition: string): void {
    const db = this.requireDb();
    const columns = db.prepare('PRAGMA table_info(notes)').all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    db.exec(`ALTER TABLE notes ADD COLUMN ${columnName} ${columnDefinition}`);
  }

  private ensureProtectedTags(): void {
    const db = this.requireDb();
    const findTagStmt = db.prepare('SELECT id FROM tags WHERE name = ?');
    const insertTagStmt = db.prepare('INSERT INTO tags (name) VALUES (?)');

    const tx = db.transaction(() => {
      for (const tagName of PROTECTED_TAGS) {
        const existing = findTagStmt.get(tagName) as { id: number } | undefined;
        if (existing) continue;
        insertTagStmt.run(tagName);
      }
    });

    tx();
  }

  private normalizeAllTagPositions(): number {
    const db = this.requireDb();
    const noteIds = db.prepare('SELECT id FROM notes').all() as Array<{ id: string }>;
    const selectTagsForNoteStmt = db.prepare('SELECT tagId FROM note_tags WHERE noteId = ? ORDER BY position ASC, tagId ASC');
    const updatePosStmt = db.prepare('UPDATE note_tags SET position = ? WHERE noteId = ? AND tagId = ?');

    let touchedCount = 0;
    const tx = db.transaction(() => {
      for (const { id } of noteIds) {
        const rows = selectTagsForNoteStmt.all(id) as Array<{ tagId: number }>;
        rows.forEach((row, index) => {
          const info = updatePosStmt.run(index, id, row.tagId);
          if (info.changes > 0) {
            touchedCount += 1;
          }
        });
      }
    });

    tx();
    return touchedCount;
  }

  private writeNoteTags(noteId: string, orderedTags: string[]): void {
    const db = this.requireDb();
    const findTagStmt = db.prepare('SELECT id FROM tags WHERE name = ?');
    const insertTagStmt = db.prepare('INSERT INTO tags (name) VALUES (?)');
    const deleteNoteTagsStmt = db.prepare('DELETE FROM note_tags WHERE noteId = ?');
    const insertNoteTagStmt = db.prepare('INSERT OR REPLACE INTO note_tags (noteId, tagId, position) VALUES (?, ?, ?)');

    const getOrCreateTagId = (tagNameRaw: string): number => {
      const tagName = normalizeTagName(tagNameRaw);
      const existing = findTagStmt.get(tagName) as { id: number } | undefined;
      if (existing) return existing.id;
      const created = insertTagStmt.run(tagName);
      return Number(created.lastInsertRowid);
    };

    const tx = db.transaction(() => {
      deleteNoteTagsStmt.run(noteId);
      orderedTags.forEach((tagName, position) => {
        const tagId = getOrCreateTagId(tagName);
        insertNoteTagStmt.run(noteId, tagId, position);
      });
    });

    tx();
  }

  private findTagIdByName(tagNameRaw: string): number | null {
    const db = this.requireDb();
    const tagName = normalizeTagName(tagNameRaw);
    const row = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName) as { id: number } | undefined;
    return row?.id ?? null;
  }

  private getOrCreateTagId(tagNameRaw: string): number {
    const db = this.requireDb();
    const tagName = normalizeTagName(tagNameRaw);
    const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName) as { id: number } | undefined;
    if (existing) return existing.id;
    const created = db.prepare('INSERT INTO tags (name) VALUES (?)').run(tagName);
    return Number(created.lastInsertRowid);
  }

  private writeTagRelations(noteId: string, orderedTagIds: number[]): void {
    const db = this.requireDb();
    const deleteStmt = db.prepare('DELETE FROM note_tags WHERE noteId = ?');
    const insertStmt = db.prepare('INSERT OR REPLACE INTO note_tags (noteId, tagId, position) VALUES (?, ?, ?)');

    const tx = db.transaction(() => {
      deleteStmt.run(noteId);
      orderedTagIds.forEach((tagId, position) => {
        insertStmt.run(noteId, tagId, position);
      });
    });

    tx();
  }

  private requireDb(): SqliteDatabase {
    if (!this.db) {
      throw new Error('DatabaseService is not initialized');
    }
    return this.db;
  }
}
