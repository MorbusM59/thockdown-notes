import Database from 'better-sqlite3';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Note, Tag, NoteTag, SearchResult, SnippetSegment } from '../shared/types';
import { getDataDir, getDbPath, getNotesDir } from './paths';

let db: Database.Database;
const PROTECTED_TAGS = new Set(['deleted', 'archived']);

// Initialize database schema
export async function initDatabase(): Promise<void> {
  try {
    await fs.mkdir(getDataDir(), { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create data directory: ${error instanceof Error ? error.message : String(error)}`);
  }

  db = new Database(getDbPath());

  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      filePath TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      lastEdited TEXT
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS note_tags (
      noteId INTEGER NOT NULL,
      tagId INTEGER NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (noteId, tagId),
      FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (tagId) REFERENCES tags(id)
    );

    CREATE INDEX IF NOT EXISTS idx_note_tags_note ON note_tags(noteId);
    CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tagId);

    CREATE TABLE IF NOT EXISTS note_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      noteId INTEGER NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      isManual INTEGER DEFAULT 0,
      FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_note_snapshots_note ON note_snapshots(noteId);
  `);

  // Ensure UI state columns exist on `notes` table. Use a migration-friendly approach
  try {
    const cols = db.prepare("PRAGMA table_info(notes)").all() as Array<{ name: string }>;
    const names = new Set(cols.map(c => String(c.name)));
    if (!names.has('progressPreview')) db.prepare('ALTER TABLE notes ADD COLUMN progressPreview REAL DEFAULT 0').run();
    if (!names.has('progressEdit')) db.prepare('ALTER TABLE notes ADD COLUMN progressEdit REAL DEFAULT 0').run();
    if (!names.has('cursorPos')) db.prepare('ALTER TABLE notes ADD COLUMN cursorPos INTEGER DEFAULT 0').run();
    if (!names.has('scrollTop')) db.prepare('ALTER TABLE notes ADD COLUMN scrollTop REAL DEFAULT 0').run();
    if (!names.has('editHistory')) db.prepare('ALTER TABLE notes ADD COLUMN editHistory TEXT').run();

    // Temp note fields
    if (!names.has('isTemp')) db.prepare('ALTER TABLE notes ADD COLUMN isTemp INTEGER DEFAULT 0').run();
    if (!names.has('externalPath')) db.prepare('ALTER TABLE notes ADD COLUMN externalPath TEXT').run();
    if (!names.has('hasUnsavedChanges')) db.prepare('ALTER TABLE notes ADD COLUMN hasUnsavedChanges INTEGER DEFAULT 0').run();
    if (!names.has('syncMode')) db.prepare('ALTER TABLE notes ADD COLUMN syncMode INTEGER DEFAULT 0').run();
    if (!names.has('originalEncoding')) db.prepare('ALTER TABLE notes ADD COLUMN originalEncoding TEXT').run();

    const snapCols = db.prepare("PRAGMA table_info(note_snapshots)").all() as Array<{ name: string }>;
    const snapNames = new Set(snapCols.map(c => String(c.name)));
    if (!snapNames.has('isManual')) db.prepare('ALTER TABLE note_snapshots ADD COLUMN isManual INTEGER DEFAULT 0').run();
  } catch (merr) {
    console.warn('[db] UI-state migration check failed', merr);
  }

  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        noteId UNINDEXED,
        title,
        content
      );
    `);
  } catch (err) {
    console.error('[db] Failed to create FTS table; FTS5 may be unavailable', err);
    throw err;
  }

  // Ensure `fileToken` column exists and a unique index enforces uniqueness
  try {
    const cols2 = db.prepare("PRAGMA table_info(notes)").all() as Array<{ name: string }>;
    const names2 = new Set(cols2.map(c => String(c.name)));
    if (!names2.has('fileToken')) {
      db.prepare('ALTER TABLE notes ADD COLUMN fileToken TEXT').run();
    }
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_fileToken ON notes(fileToken);");
  } catch (err) {
    console.warn('[db] fileToken migration failed', err);
  }
}

/* Utilities */
function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-');
}
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* Core note operations */
export function createNote(title: string, filePath: string): Note {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO notes (title, filePath, createdAt, updatedAt, lastEdited)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Ensure protected tags exist
  try {
    // createOrGetTag is declared below; call via normalized names after it's available
    // We'll lazily ensure tags exist after function definitions by calling here is not safe,
    // so instead ensure at end of initDatabase by creating them directly via SQL if absent.
    const existing = db.prepare('SELECT name FROM tags WHERE name IN (?, ?, ?)').all('deleted', 'archived', 'temp') as Array<{ name: string }>;
    const found = new Set(existing.map(r => r.name));
    if (!found.has('deleted')) db.prepare('INSERT INTO tags (name) VALUES (?)').run('deleted');
    if (!found.has('archived')) db.prepare('INSERT INTO tags (name) VALUES (?)').run('archived');
    if (!found.has('temp')) db.prepare('INSERT INTO tags (name) VALUES (?)').run('temp');
  } catch (err) {
    console.warn('[db] ensure protected tags failed', err);
  }
  const result = stmt.run(title, filePath, now, now, now);

  // Ensure freshly-created notes have no persisted cursor/scroll state
  try {
    db.prepare('UPDATE notes SET cursorPos = NULL, scrollTop = NULL WHERE id = ?').run(result.lastInsertRowid as number);
  } catch (err) {
    // non-fatal - leave as-is if the update fails
  }

  return {
    id: result.lastInsertRowid as number,
    title,
    filePath,
    createdAt: now,
    updatedAt: now,
    lastEdited: now,
  };
}

export function createTempNote(title: string, externalPath: string, originalEncoding?: string): Note {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO notes (title, filePath, createdAt, updatedAt, lastEdited, isTemp, externalPath, hasUnsavedChanges, syncMode, originalEncoding)
    VALUES (?, ?, ?, ?, ?, 1, ?, 0, 0, ?)
  `);

  const result = stmt.run(title, externalPath, now, now, now, externalPath, originalEncoding || 'utf8');

  return {
    id: result.lastInsertRowid as number,
    title,
    filePath: externalPath, // Use external path as filePath for consistency
    createdAt: now,
    updatedAt: now,
    lastEdited: now,
    isTemp: true,
    externalPath,
    hasUnsavedChanges: false,
    syncMode: false,
    originalEncoding: originalEncoding || 'utf8',
  };
}

export function updateTempNoteState(noteId: number, hasUnsavedChanges: boolean, syncMode: boolean): void {
  const stmt = db.prepare(`
    UPDATE notes 
    SET hasUnsavedChanges = ?, syncMode = ?, updatedAt = ?
    WHERE id = ? AND isTemp = 1
  `);
  stmt.run(hasUnsavedChanges ? 1 : 0, syncMode ? 1 : 0, new Date().toISOString(), noteId);
}

export function convertTempNoteToRegular(noteId: number, newFilePath: string): void {
  const stmt = db.prepare(`
    UPDATE notes 
    SET isTemp = 0, externalPath = NULL, hasUnsavedChanges = 0, syncMode = 0, 
        filePath = ?, updatedAt = ?, originalEncoding = NULL
    WHERE id = ? AND isTemp = 1
  `);
  stmt.run(newFilePath, new Date().toISOString(), noteId);
}

export function getTempNotes(): Note[] {
  const stmt = db.prepare('SELECT * FROM notes WHERE isTemp = 1 ORDER BY lastEdited DESC');
  return stmt.all() as Note[];
}

export function deleteTempNote(noteId: number): void {
  // Only delete if it's a temp note
  const stmt = db.prepare('DELETE FROM notes WHERE id = ? AND isTemp = 1');
  stmt.run(noteId);
}

export function getNoteByToken(token: string): Note | undefined {
  const stmt = db.prepare('SELECT * FROM notes WHERE fileToken = ?');
  return stmt.get(token) as Note | undefined;
}

export function setNoteFileToken(noteId: number, token: string): void {
  db.prepare('UPDATE notes SET fileToken = ? WHERE id = ?').run(token, noteId);
}

export function generateUniqueFileToken(): string {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (let attempt = 0; attempt < 10000; attempt++) {
    let t = '';
    for (let i = 0; i < 9; i++) t += alpha[Math.floor(Math.random() * alpha.length)];
    const exists = db.prepare('SELECT 1 FROM notes WHERE fileToken = ?').get(t) as any;
    if (!exists) return t;
  }
  throw new Error('Failed to generate unique file token after many attempts');
}

export function updateNoteCreatedAt(noteId: number, iso: string): void {
  db.prepare('UPDATE notes SET createdAt = ? WHERE id = ?').run(iso, noteId);
}

export function updateNoteLastEdited(noteId: number, iso: string): void {
  db.prepare('UPDATE notes SET lastEdited = ? WHERE id = ?').run(iso, noteId);
}

export function getAllNotes(): Note[] {
  const stmt = db.prepare('SELECT * FROM notes ORDER BY updatedAt DESC');
  return stmt.all() as Note[];
}

export function getNoteById(id: number): Note | undefined {
  const stmt = db.prepare('SELECT * FROM notes WHERE id = ?');
  return stmt.get(id) as Note | undefined;
}

export function getNoteUiState(noteId: number): { progressPreview: number | null; progressEdit: number | null; cursorPos: number | null; scrollTop: number | null } {
  const stmt = db.prepare('SELECT progressPreview, progressEdit, cursorPos, scrollTop FROM notes WHERE id = ?');
  const row = stmt.get(noteId) as { progressPreview?: number; progressEdit?: number; cursorPos?: number; scrollTop?: number } | undefined;
  if (!row) return { progressPreview: null, progressEdit: null, cursorPos: null, scrollTop: null };
  return {
    progressPreview: row.progressPreview == null ? null : Number(row.progressPreview),
    progressEdit: row.progressEdit == null ? null : Number(row.progressEdit),
    cursorPos: row.cursorPos == null ? null : Number(row.cursorPos),
    scrollTop: row.scrollTop == null ? null : Number(row.scrollTop),
  };
}

export function saveNoteUiState(noteId: number, state: { progressPreview?: number | null; progressEdit?: number | null; cursorPos?: number | null; scrollTop?: number | null }): void {
  const parts: string[] = [];
  const values: any[] = [];
  if (state.progressPreview !== undefined) { parts.push('progressPreview = ?'); values.push(state.progressPreview); }
  if (state.progressEdit !== undefined) { parts.push('progressEdit = ?'); values.push(state.progressEdit); }
  if (state.cursorPos !== undefined) { parts.push('cursorPos = ?'); values.push(state.cursorPos); }
  if (state.scrollTop !== undefined) { parts.push('scrollTop = ?'); values.push(state.scrollTop); }
  if (parts.length === 0) return;
  const sql = `UPDATE notes SET ${parts.join(', ')} WHERE id = ?`;
  values.push(noteId);
  db.prepare(sql).run(...values);
}




export function updateNote(id: number): void {
  const now = new Date().toISOString();
  const stmt = db.prepare('UPDATE notes SET updatedAt = ?, lastEdited = ? WHERE id = ?');
  stmt.run(now, now, id);
}

export function updateNoteTitle(id: number, title: string): void {
  const now = new Date().toISOString();
  const stmt = db.prepare('UPDATE notes SET title = ?, updatedAt = ? WHERE id = ?');
  stmt.run(title, now, id);
}

export function updateNoteFilePath(id: number, filePath: string): void {
  const stmt = db.prepare('UPDATE notes SET filePath = ? WHERE id = ?');
  stmt.run(filePath, id);
}

export function deleteNote(id: number): void {
  const stmt = db.prepare('DELETE FROM notes WHERE id = ?');
  stmt.run(id);
  try { removeNoteFts(id); } catch (err) { console.warn('[db] removeNoteFts failed', err); }
}

export function getLastEditedNote(): Note | undefined {
  const stmt = db.prepare('SELECT * FROM notes WHERE lastEdited IS NOT NULL ORDER BY lastEdited DESC LIMIT 1');
  return stmt.get() as Note | undefined;
}

export function closeDatabase(): void {
  db.close();
}

/* Pagination */
export function getNotesPage(page: number, perPage: number): { notes: Note[]; total: number } {
  const offset = (page - 1) * perPage;
  const notesStmt = db.prepare(`
    SELECT n.*, t0.name as primaryTag
    FROM notes n
    LEFT JOIN note_tags nt0 ON n.id = nt0.noteId AND nt0.position = 0
    LEFT JOIN tags t0 ON nt0.tagId = t0.id
    WHERE t0.name IS NULL OR LOWER(t0.name) NOT IN ('deleted', 'archived')
    ORDER BY n.updatedAt DESC
    LIMIT ? OFFSET ?
  `);
  const countStmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM notes n
    LEFT JOIN note_tags nt0 ON n.id = nt0.noteId AND nt0.position = 0
    LEFT JOIN tags t0 ON nt0.tagId = t0.id
    WHERE t0.name IS NULL OR LOWER(t0.name) NOT IN ('deleted', 'archived')
  `);
  const notes = notesStmt.all(perPage, offset) as Array<Note & { primaryTag?: string | null }>;
  const result = countStmt.get() as { count: number };
  return { notes, total: result.count };
}

/* Tags */
export function createOrGetTag(name: string): Tag {
  const normalized = normalizeTagName(name);
  const existing = db.prepare('SELECT * FROM tags WHERE name = ?').get(normalized) as Tag | undefined;
  if (existing) return existing;
  const stmt = db.prepare('INSERT INTO tags (name) VALUES (?)');
  const result = stmt.run(normalized);
  return { id: result.lastInsertRowid as number, name: normalized };
}

export function renameTag(tagId: number, newName: string): void {
  const normalized = normalizeTagName(newName);
  const existingTag = db.prepare('SELECT * FROM tags WHERE id = ?').get(tagId) as Tag | undefined;
  if (!existingTag) throw new Error('Tag not found');

  // Prevent renaming protected tags
  if (PROTECTED_TAGS.has(existingTag.name)) {
    throw new Error('This tag is protected and cannot be renamed');
  }

  const conflict = db.prepare('SELECT * FROM tags WHERE name = ?').get(normalized) as Tag | undefined;
  if (conflict && conflict.id !== tagId) {
    // Merge: point note_tags to the conflict.id where no duplicate exists, then remove old tag rows
    const updateStmt = db.prepare(`
      UPDATE note_tags
      SET tagId = ?
      WHERE tagId = ? AND NOT EXISTS (
        SELECT 1 FROM note_tags nt2 WHERE nt2.noteId = note_tags.noteId AND nt2.tagId = ?
      )
    `);
    updateStmt.run(conflict.id, tagId, conflict.id);
    // remove any remaining old tag references
    db.prepare('DELETE FROM note_tags WHERE tagId = ?').run(tagId);
    // remove the old tag row
    db.prepare('DELETE FROM tags WHERE id = ?').run(tagId);
  } else {
    db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(normalized, tagId);
  }
}

export function addTagToNote(noteId: number, tagName: string, position: number): NoteTag {
  const tag = createOrGetTag(tagName);

  // If adding a protected tag, force it to primary (position 0) and shift existing positions up.
  if (PROTECTED_TAGS.has(tag.name)) {
    position = 0;
  }
  // If inserting at primary (position 0), shift existing positions up to make room.
  if (position === 0) {
    db.prepare('UPDATE note_tags SET position = position + 1 WHERE noteId = ?').run(noteId);
  }

  // Remove any existing relation for this tag (safe)
  db.prepare('DELETE FROM note_tags WHERE noteId = ? AND tagId = ?').run(noteId, tag.id);

  // If adding a protected tag, remove the other protected tag(s) from this note to enforce mutual exclusion
  if (PROTECTED_TAGS.has(tag.name)) {
    for (const other of PROTECTED_TAGS) {
      if (other === tag.name) continue;
      const otherRow = db.prepare('SELECT id FROM tags WHERE name = ?').get(other) as { id: number } | undefined;
      if (otherRow) db.prepare('DELETE FROM note_tags WHERE noteId = ? AND tagId = ?').run(noteId, otherRow.id);
    }
  }

  db.prepare('INSERT INTO note_tags (noteId, tagId, position) VALUES (?, ?, ?)').run(noteId, tag.id, position);

  // Re-normalize positions to 0..n-1 in current order
  const rows = db.prepare('SELECT tagId FROM note_tags WHERE noteId = ? ORDER BY position').all(noteId) as Array<{ tagId: number }>;
  rows.forEach((r, idx) => {
    db.prepare('UPDATE note_tags SET position = ? WHERE noteId = ? AND tagId = ?').run(idx, noteId, r.tagId);
  });

  return { noteId, tagId: tag.id, position: rows.findIndex(r => r.tagId === tag.id), tag };
}

export function removeTagFromNote(noteId: number, tagId: number): void {
  db.prepare('DELETE FROM note_tags WHERE noteId = ? AND tagId = ?').run(noteId, tagId);
  const tags = db.prepare('SELECT * FROM note_tags WHERE noteId = ? ORDER BY position').all(noteId) as NoteTag[];
  tags.forEach((tag, index) => {
    db.prepare('UPDATE note_tags SET position = ? WHERE noteId = ? AND tagId = ?').run(index, noteId, tag.tagId);
  });
}

export function reorderNoteTags(noteId: number, tagIds: number[]): void {
  // Ensure protected tags (deleted/archived) remain at position 0 if present.
  let newOrder = [...tagIds];
  try {
    const protNames = Array.from(PROTECTED_TAGS);
    if (protNames.length > 0) {
      const placeholders = protNames.map(() => '?').join(',');
      const rows = db.prepare(`SELECT id, name FROM tags WHERE LOWER(name) IN (${placeholders})`).all(...protNames) as Array<{ id: number; name: string }>;
      const protIdSet = new Set(rows.map(r => r.id));
      // Build a new order: any protected tag ids (in the order they appear in protNames/rows)
      const protIdsInRequest: number[] = [];
      for (const r of rows) {
        if (newOrder.includes(r.id)) protIdsInRequest.push(r.id);
      }
      if (protIdsInRequest.length > 0) {
        // Remove protected ids from their current positions
        newOrder = newOrder.filter(id => !protIdSet.has(id));
        // Insert protected ids at the front in the same order
        newOrder = [...protIdsInRequest, ...newOrder];
      }
    }
  } catch (err) {
    // Non-fatal - if anything goes wrong, fall back to provided order
    console.warn('[db] reorderNoteTags protected-tag reorder failed', err);
    newOrder = [...tagIds];
  }

  newOrder.forEach((tagId, index) => {
    db.prepare('UPDATE note_tags SET position = ? WHERE noteId = ? AND tagId = ?').run(index, noteId, tagId);
  });
}

export function getNoteTags(noteId: number): NoteTag[] {
  const stmt = db.prepare(`
    SELECT nt.noteId, nt.tagId, nt.position, t.id, t.name
    FROM note_tags nt
    JOIN tags t ON nt.tagId = t.id
    WHERE nt.noteId = ?
    ORDER BY nt.position
  `);
  const rows = stmt.all(noteId) as Array<{ noteId: number; tagId: number; position: number; id: number; name: string }>;
  return rows.map(row => ({
    noteId: row.noteId,
    tagId: row.tagId,
    position: row.position,
    tag: { id: row.id, name: row.name }
  }));
}

export function getAllTags(): Tag[] {
  const stmt = db.prepare('SELECT * FROM tags ORDER BY name');
  return stmt.all() as Tag[];
}

export function getTopTags(limit: number): Tag[] {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const stmt = db.prepare(`
    SELECT t.id, t.name, COUNT(nt.noteId) as usage_count
    FROM tags t
    JOIN note_tags nt ON t.id = nt.tagId
    JOIN notes n ON nt.noteId = n.id
    WHERE (n.updatedAt >= ? OR n.createdAt >= ? OR (n.lastEdited IS NOT NULL AND n.lastEdited >= ?))
      AND LOWER(t.name) NOT IN ('deleted', 'archived')
    GROUP BY t.id
    HAVING usage_count > 0
    ORDER BY usage_count DESC, t.name
    LIMIT ?
  `);
  return stmt.all(cutoff, cutoff, cutoff, limit) as Tag[];
}

/* FTS helpers */
export function upsertNoteFts(noteId: number, title: string, content: string): void {
  const idStr = String(noteId);
  db.prepare('DELETE FROM notes_fts WHERE noteId = ?').run(idStr);
  db.prepare('INSERT INTO notes_fts(noteId, title, content) VALUES (?, ?, ?)').run(idStr, title, content);
}
export function removeNoteFts(noteId: number): void {
  const idStr = String(noteId);
  db.prepare('DELETE FROM notes_fts WHERE noteId = ?').run(idStr);
}

/* Phrase permissive check */
function phraseMatchesPermissive(content: string, phrase: string): boolean {
  if (!phrase) return false;
  const tokens = phrase.split(/\s+/).map(t => t.trim()).filter(Boolean).map(t => t.replace(/[^A-Za-z0-9_-]+/g, ''));
  if (tokens.length === 0) return false;
  const allButLast = tokens.slice(0, -1).map(t => escapeRegExp(t));
  const last = escapeRegExp(tokens[tokens.length - 1]);
  const prefix = allButLast.length ? allButLast.join('\\W+') + '\\W+' : '';
  const pattern = prefix + last + '\\w*';
  const re = new RegExp(pattern, 'i');
  return re.test(content);
}

/* Build FTS match expression (tokens required -> AND semantics). */
function buildFtsMatchExpression(query: string): string {
  if (!query) return '';
  const phraseRegex = /"([^"]+)"/g;
  let m: RegExpExecArray | null;
  const phraseTokens: string[] = [];
  while ((m = phraseRegex.exec(query)) !== null) {
    const phrase = m[1].trim();
    if (phrase) {
      const toks = phrase.split(/\s+/).map(t => t.trim().replace(/[^A-Za-z0-9_-]+/g, '')).filter(Boolean);
      for (const t of toks) phraseTokens.push(`${t}*`);
    }
  }
  const stripped = query.replace(phraseRegex, ' ');
  const tokens = stripped.split(/\s+/).map(t => t.trim()).filter(Boolean);
  const tokenParts: string[] = [];
  for (const raw of tokens) {
    const cleaned = raw.replace(/[^A-Za-z0-9_-]+/g, '');
    if (!cleaned) continue;
    tokenParts.push(`${cleaned}*`);
  }
  const parts = [...phraseTokens, ...tokenParts];
  if (parts.length === 0) return '';
  return parts.join(' AND ');
}

/* Search (FTS-backed, with post-filtering and snippet segments) */
export async function searchNotes(query: string): Promise<SearchResult[]> {
  const trimmed = (query || '').trim();
  if (!trimmed) return [];

  const phraseRegex = /"([^"]+)"/g;
  let pm: RegExpExecArray | null;
  const quotedPhrases: string[] = [];
  while ((pm = phraseRegex.exec(trimmed)) !== null) {
    const phrase = pm[1].trim();
    if (phrase) quotedPhrases.push(phrase);
  }

  const stripped = trimmed.replace(phraseRegex, ' ');
  const tokens = stripped.split(/\s+/).map(t => t.trim()).filter(Boolean);
  const tokenPatterns = tokens
    .map(t => t.replace(/[^A-Za-z0-9_-]+/g, ''))
    .filter(Boolean)
    .map(t => t.toLowerCase());

  const matchExpr = buildFtsMatchExpression(trimmed);
  if (!matchExpr) return [];

  const MAX_RESULTS = 200;

  // Try parameterized MATCH first (safer); if not supported, try inlined escaped expression.
  try {
    const stmtParam = db.prepare(`SELECT noteId FROM notes_fts WHERE notes_fts MATCH ? LIMIT ?`);
    const rows = stmtParam.all(matchExpr, MAX_RESULTS) as Array<{ noteId: string }>;

    const results: SearchResult[] = [];

    for (const r of rows) {
      const id = Number(r.noteId);
      if (Number.isNaN(id)) continue;
      const note = getNoteById(id);
      if (!note) continue;

      let content = '';
      try { content = await fs.readFile(note.filePath, 'utf-8'); } catch { content = ''; }
      const contentLower = content.toLowerCase();
      const titleLower = note.title.toLowerCase();

      let ok = true;
      for (const phrase of quotedPhrases) {
        const inContent = content && phraseMatchesPermissive(content, phrase);
        const inTitle = phrase && note.title && phraseMatchesPermissive(note.title, phrase);
        if (!inContent && !inTitle) { ok = false; break; }
      }
      if (!ok) continue;

      for (const tp of tokenPatterns) {
        if (!(contentLower.includes(tp) || titleLower.includes(tp))) { ok = false; break; }
      }
      if (!ok) continue;

      // Determine snippet center and build segments
      let firstIndex = -1;
      let firstMatchText = '';
      for (const phrase of quotedPhrases) {
        if (!phrase) continue;
        const tokensP = phrase.split(/\s+/).map(t => t.replace(/[^A-Za-z0-9_-]+/g, '')).filter(Boolean);
        if (tokensP.length === 0) continue;
        const reStr = tokensP.map(t => escapeRegExp(t)).join('\\W+');
        const regex = new RegExp(reStr, 'i');
        const m2 = regex.exec(content);
        if (m2 && m2.index !== undefined) {
          if (firstIndex === -1 || m2.index < firstIndex) { firstIndex = m2.index; firstMatchText = m2[0]; }
        }
      }
      for (const t of tokenPatterns) {
        const idx = contentLower.indexOf(t);
        if (idx !== -1 && (firstIndex === -1 || idx < firstIndex)) { firstIndex = idx; firstMatchText = content.substr(idx, t.length); }
      }

      if (firstIndex === -1) {
        for (const phrase of quotedPhrases) {
          const re = new RegExp(escapeRegExp(phrase), 'i');
          const mt = re.exec(note.title);
          if (mt && mt.index !== undefined) { firstIndex = 0; firstMatchText = mt[0]; break; }
        }
        if (firstIndex === -1) {
          for (const t of tokenPatterns) {
            const idx = titleLower.indexOf(t);
            if (idx !== -1) { firstIndex = 0; firstMatchText = note.title.substr(idx, t.length); break; }
          }
        }
      }

      const radius = 50;
      let snippetRaw = '';
      if (!content) snippetRaw = note.title;
      else {
        const centerPos = firstIndex >= 0 ? firstIndex : 0;
        const start = Math.max(0, centerPos - radius);
        const end = Math.min(content.length, centerPos + (firstMatchText ? firstMatchText.length : 0) + radius);
        snippetRaw = content.substring(start, end);
        if (start > 0) snippetRaw = '...' + snippetRaw;
        if (end < content.length) snippetRaw = snippetRaw + '...';
      }

      const highlightItems: string[] = [];
      for (const p of quotedPhrases) if (p) highlightItems.push(p);
      for (const t of tokenPatterns) if (t) highlightItems.push(t);
      const uniqueHighlights = Array.from(new Set(highlightItems)).filter(Boolean).sort((a, b) => b.length - a.length);

      const segments: SnippetSegment[] = [];
      if (!snippetRaw) segments.push({ text: '' });
      else if (uniqueHighlights.length === 0) segments.push({ text: snippetRaw });
      else {
        const alt = uniqueHighlights.map(h => escapeRegExp(h)).join('|');
        const re = new RegExp(alt, 'ig');
        let lastIndex = 0;
        let m3: RegExpExecArray | null;
        while ((m3 = re.exec(snippetRaw)) !== null) {
          const s = m3.index;
          const e = re.lastIndex;
          if (s > lastIndex) segments.push({ text: snippetRaw.substring(lastIndex, s) });
          segments.push({ text: snippetRaw.substring(s, e), highlight: true });
          lastIndex = e;
        }
        if (lastIndex < snippetRaw.length) segments.push({ text: snippetRaw.substring(lastIndex) });
      }

      const joinedQuery = (quotedPhrases.join(' ') + ' ' + tokenPatterns.join(' ')).trim().toLowerCase();
      const matchInTitle = note.title.toLowerCase().includes(joinedQuery);

      results.push({ note, matchType: matchInTitle ? 'title' : 'content', snippet: segments });
      if (results.length >= MAX_RESULTS) break;
    }

    return results;
  } catch (paramErr) {
    // Fallback: attempt safe inline match, then final manual scan if necessary
    try {
      const safeMatch = matchExpr.replace(/'/g, "''").slice(0, 2000);
      const sql = `SELECT noteId FROM notes_fts WHERE notes_fts MATCH '${safeMatch}' LIMIT ${MAX_RESULTS}`;
      const stmt = db.prepare(sql);
      const rows = stmt.all() as Array<{ noteId: string }>;
      // reuse processing logic (kept concise here by delegating to above behavior)
      const results: SearchResult[] = [];
      for (const r of rows) {
        const id = Number(r.noteId);
        if (Number.isNaN(id)) continue;
        const note = getNoteById(id);
        if (!note) continue;
        let content = '';
        try { content = await fs.readFile(note.filePath, 'utf-8'); } catch { content = ''; }
        const contentLower = content.toLowerCase();
        const titleLower = note.title.toLowerCase();
        let ok = true;
        for (const phrase of quotedPhrases) {
          const inContent = content && phraseMatchesPermissive(content, phrase);
          const inTitle = phrase && note.title && phraseMatchesPermissive(note.title, phrase);
          if (!inContent && !inTitle) { ok = false; break; }
        }
        if (!ok) continue;
        for (const tp of tokenPatterns) {
          if (!(contentLower.includes(tp) || titleLower.includes(tp))) { ok = false; break; }
        }
        if (!ok) continue;

        // Build snippet (same as above)...
        let firstIndex = -1;
        let firstMatchText = '';
        for (const phrase of quotedPhrases) {
          if (!phrase) continue;
          const tokensP = phrase.split(/\s+/).map(t => t.replace(/[^A-Za-z0-9_-]+/g, '')).filter(Boolean);
          if (tokensP.length === 0) continue;
          const reStr = tokensP.map(t => escapeRegExp(t)).join('\\W+');
          const regex = new RegExp(reStr, 'i');
          const m2 = regex.exec(content);
          if (m2 && m2.index !== undefined) {
            if (firstIndex === -1 || m2.index < firstIndex) { firstIndex = m2.index; firstMatchText = m2[0]; }
          }
        }
        for (const t of tokenPatterns) {
          const idx = contentLower.indexOf(t);
          if (idx !== -1 && (firstIndex === -1 || idx < firstIndex)) { firstIndex = idx; firstMatchText = content.substr(idx, t.length); }
        }

        if (firstIndex === -1) {
          for (const phrase of quotedPhrases) {
            const re = new RegExp(escapeRegExp(phrase), 'i');
            const mt = re.exec(note.title);
            if (mt && mt.index !== undefined) { firstIndex = 0; firstMatchText = mt[0]; break; }
          }
          if (firstIndex === -1) {
            for (const t of tokenPatterns) {
              const idx = titleLower.indexOf(t);
              if (idx !== -1) { firstIndex = 0; firstMatchText = note.title.substr(idx, t.length); break; }
            }
          }
        }

        const radius = 50;
        let snippetRaw = '';
        if (!content) snippetRaw = note.title;
        else {
          const centerPos = firstIndex >= 0 ? firstIndex : 0;
          const start = Math.max(0, centerPos - radius);
          const end = Math.min(content.length, centerPos + (firstMatchText ? firstMatchText.length : 0) + radius);
          snippetRaw = content.substring(start, end);
          if (start > 0) snippetRaw = '...' + snippetRaw;
          if (end < content.length) snippetRaw = snippetRaw + '...';
        }

        const highlightItems: string[] = [];
        for (const p of quotedPhrases) if (p) highlightItems.push(p);
        for (const t of tokenPatterns) if (t) highlightItems.push(t);
        const uniqueHighlights = Array.from(new Set(highlightItems)).filter(Boolean).sort((a, b) => b.length - a.length);

        const segments: SnippetSegment[] = [];
        if (!snippetRaw) segments.push({ text: '' });
        else if (uniqueHighlights.length === 0) segments.push({ text: snippetRaw });
        else {
          const alt = uniqueHighlights.map(h => escapeRegExp(h)).join('|');
          const re = new RegExp(alt, 'ig');
          let lastIndex = 0;
          let m3: RegExpExecArray | null;
          while ((m3 = re.exec(snippetRaw)) !== null) {
            const s = m3.index;
            const e = re.lastIndex;
            if (s > lastIndex) segments.push({ text: snippetRaw.substring(lastIndex, s) });
            segments.push({ text: snippetRaw.substring(s, e), highlight: true });
            lastIndex = e;
          }
          if (lastIndex < snippetRaw.length) segments.push({ text: snippetRaw.substring(lastIndex) });
        }

        const joinedQuery = (quotedPhrases.join(' ') + ' ' + tokenPatterns.join(' ')).trim().toLowerCase();
        const matchInTitle = note.title.toLowerCase().includes(joinedQuery);

        results.push({ note, matchType: matchInTitle ? 'title' : 'content', snippet: segments });
        if (results.length >= MAX_RESULTS) break;
      }

      return results;
    } catch (inlineErr) {
      console.error('[db] FTS inline match failed', inlineErr);
      // Final fallback: manual scan across all notes
      const phrasesFallback: string[] = [];
      const phraseRegexFallback = /"([^"]+)"/g;
      let pm2: RegExpExecArray | null;
      while ((pm2 = phraseRegexFallback.exec(trimmed)) !== null) {
        const phrase = pm2[1].trim();
        if (phrase) phrasesFallback.push(phrase);
      }
      const stripped2 = trimmed.replace(phraseRegexFallback, ' ');
      const tokensFallback = stripped2.split(/\s+/).map(t => t.trim()).filter(Boolean)
        .map(t => t.replace(/[^A-Za-z0-9_-]+/g, '').toLowerCase())
        .filter(Boolean);

      const allNotes = getAllNotes();
      const results: SearchResult[] = [];
      for (const note of allNotes) {
        const content = await (async () => {
          try { return await fs.readFile(note.filePath, 'utf-8'); } catch { return ''; }
        })();
        const contentLower = content.toLowerCase();
        const titleLower = note.title.toLowerCase();

        let ok = true;
        for (const p of phrasesFallback) {
          if (!(phraseMatchesPermissive(content, p) || phraseMatchesPermissive(note.title, p))) { ok = false; break; }
        }
        if (!ok) continue;
        for (const t of tokensFallback) {
          if (!(contentLower.includes(t) || titleLower.includes(t))) { ok = false; break; }
        }
        if (!ok) continue;

        // snippet building
        const firstIndexCandidates: number[] = [];
        for (const p of phrasesFallback) {
          const idx = contentLower.indexOf(p.toLowerCase());
          if (idx !== -1) firstIndexCandidates.push(idx);
        }
        for (const t of tokensFallback) {
          const idx = contentLower.indexOf(t);
          if (idx !== -1) firstIndexCandidates.push(idx);
        }
        const firstIndex = firstIndexCandidates.length ? Math.min(...firstIndexCandidates) : -1;
        const radius = 50;
        let snippetRaw = '';
        if (!content) snippetRaw = note.title;
        else {
          const centerPos = firstIndex >= 0 ? firstIndex : 0;
          const start = Math.max(0, centerPos - radius);
          const end = Math.min(content.length, centerPos + radius);
          snippetRaw = content.substring(start, end);
          if (start > 0) snippetRaw = '...' + snippetRaw;
          if (end < content.length) snippetRaw = snippetRaw + '...';
        }

        const highlights = [...phrasesFallback, ...tokensFallback].filter(Boolean).sort((a, b) => b.length - a.length);
        const segments: SnippetSegment[] = [];
        if (!snippetRaw) segments.push({ text: '' });
        else {
          const alt = highlights.map(h => escapeRegExp(h)).join('|');
          const re = new RegExp(alt, 'ig');
          let lastIndex = 0;
          let m3: RegExpExecArray | null;
          while ((m3 = re.exec(snippetRaw)) !== null) {
            const s = m3.index;
            const e = re.lastIndex;
            if (s > lastIndex) segments.push({ text: snippetRaw.substring(lastIndex, s) });
            segments.push({ text: snippetRaw.substring(s, e), highlight: true });
            lastIndex = e;
          }
          if (lastIndex < snippetRaw.length) segments.push({ text: snippetRaw.substring(lastIndex) });
        }

        const joinedQuery = (phrasesFallback.join(' ') + ' ' + tokensFallback.join(' ')).trim().toLowerCase();
        const matchInTitle = note.title.toLowerCase().includes(joinedQuery);

        results.push({ note, matchType: matchInTitle ? 'title' : 'content', snippet: segments });
        if (results.length >= MAX_RESULTS) break;
      }
      return results;
    }
  }
}

/* DB-only searches (tags / primary grouping) */
export function searchNotesByTag(tagName: string): SearchResult[] {
  const stmt = db.prepare(`
    SELECT n.*, nt.position
    FROM notes n
    JOIN note_tags nt ON n.id = nt.noteId
    JOIN tags t ON nt.tagId = t.id
    WHERE t.name LIKE ?
    ORDER BY nt.position, n.updatedAt DESC
  `);
  const notes = stmt.all(`%${tagName}%`) as Note[];
  return notes.map(note => ({ note, matchType: 'tag' as const }));
}

export function getNotesByPrimaryTag(): { [tagName: string]: Note[] } {
  const stmt = db.prepare(`
    SELECT n.*, t.name as tagName
    FROM notes n
    JOIN note_tags nt ON n.id = nt.noteId
    JOIN tags t ON nt.tagId = t.id
    WHERE nt.position = 0
    ORDER BY t.name, n.updatedAt DESC
  `);
  const rows = stmt.all() as Array<Note & { tagName: string }>;
  const result: { [tagName: string]: Note[] } = {};
  rows.forEach(row => {
    const tagName = row.tagName;
    const note: Note = {
      id: row.id,
      title: row.title,
      filePath: row.filePath,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastEdited: (row as any).lastEdited ?? null
    };
    if (!result[tagName]) result[tagName] = [];
    result[tagName].push(note);
  });
  return result;
}

export function getCategoryHierarchy(): { hierarchy: any; uncategorizedNotes: Note[] } {
  const stmt = db.prepare(`
    SELECT 
      n.id, n.title, n.filePath, n.createdAt, n.updatedAt, n.lastEdited,
      t0.name as primaryTag,
      t1.name as secondaryTag,
      t2.name as tertiaryTag
    FROM notes n
    LEFT JOIN note_tags nt0 ON n.id = nt0.noteId AND nt0.position = 0
    LEFT JOIN tags t0 ON nt0.tagId = t0.id
    LEFT JOIN note_tags nt1 ON n.id = nt1.noteId AND nt1.position = 1
    LEFT JOIN tags t1 ON nt1.tagId = t1.id
    LEFT JOIN note_tags nt2 ON n.id = nt2.noteId AND nt2.position = 2
    LEFT JOIN tags t2 ON nt2.tagId = t2.id
    WHERE NOT EXISTS (
      SELECT 1 FROM note_tags ntp
      JOIN tags tp ON ntp.tagId = tp.id
      WHERE ntp.noteId = n.id AND LOWER(tp.name) IN ('deleted', 'archived')
    )
    ORDER BY t0.name, t1.name, t2.name, n.updatedAt DESC
  `);
  const rows = stmt.all() as Array<{
    id: number; title: string; filePath: string; createdAt: string; updatedAt: string; lastEdited: string | null;
    primaryTag: string | null; secondaryTag: string | null; tertiaryTag: string | null;
  }>;

  const hierarchy: any = {};
  const uncategorizedNotes: Note[] = [];

  rows.forEach(row => {
    const note: Note = {
      id: row.id, title: row.title, filePath: row.filePath, createdAt: row.createdAt, updatedAt: row.updatedAt,
      lastEdited: row.lastEdited ?? null
    };
    // Determine primary as the first non-protected tag among positions 0..2
    const positions = [row.primaryTag, row.secondaryTag, row.tertiaryTag].map(x => x == null ? null : String(x));
    let primary: string | null = null;
    let secondary: string | null = null;
    let tertiary: string | null = null;
    for (let i = 0; i < positions.length; i++) {
      const v = positions[i];
      if (!v) continue;
      if (!PROTECTED_TAGS.has(v) && primary == null) { primary = v; continue; }
      if (!v) continue;
      if (primary != null && secondary == null && !PROTECTED_TAGS.has(v)) { secondary = v; continue; }
      if (primary != null && secondary != null && tertiary == null && !PROTECTED_TAGS.has(v)) { tertiary = v; }
    }
    if (!primary) { uncategorizedNotes.push(note); return; }

    if (!hierarchy[primary]) hierarchy[primary] = { notes: [], secondary: {} };
    if (!secondary) { hierarchy[primary].notes.push(note); return; }

    if (!hierarchy[primary].secondary[secondary]) hierarchy[primary].secondary[secondary] = { notes: [], tertiary: {} };
    if (!tertiary) { hierarchy[primary].secondary[secondary].notes.push(note); return; }

    if (!hierarchy[primary].secondary[secondary].tertiary[tertiary]) hierarchy[primary].secondary[secondary].tertiary[tertiary] = [];
    hierarchy[primary].secondary[secondary].tertiary[tertiary].push(note);
  });

  uncategorizedNotes.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  // Reorder hierarchy keys so that normal tags (alphabetical) come first,
  // then 'archived' then 'deleted' (if present). This controls display order in the UI.
  // Exclude protected tags from the returned hierarchy (they are special menus)
  const orderedHierarchy: any = {};
  const keys = Object.keys(hierarchy).filter(Boolean).filter(k => !PROTECTED_TAGS.has(k));
  keys.sort((a, b) => a.localeCompare(b));
  for (const k of keys) orderedHierarchy[k] = hierarchy[k];
  return { hierarchy: orderedHierarchy, uncategorizedNotes };
}

export function getHierarchyForTag(tagName: string): { hierarchy: any; uncategorizedNotes: Note[] } {
  const stmt = db.prepare(`
    SELECT 
      n.id, n.title, n.filePath, n.createdAt, n.updatedAt, n.lastEdited,
      t0.name as pos0,
      t1.name as pos1,
      t2.name as pos2
    FROM notes n
    JOIN note_tags nt_filter ON n.id = nt_filter.noteId
    JOIN tags tf ON nt_filter.tagId = tf.id
    LEFT JOIN note_tags nt0 ON n.id = nt0.noteId AND nt0.position = 0
    LEFT JOIN tags t0 ON nt0.tagId = t0.id
    LEFT JOIN note_tags nt1 ON n.id = nt1.noteId AND nt1.position = 1
    LEFT JOIN tags t1 ON nt1.tagId = t1.id
    LEFT JOIN note_tags nt2 ON n.id = nt2.noteId AND nt2.position = 2
    LEFT JOIN tags t2 ON nt2.tagId = t2.id
    WHERE tf.name = ?
    ORDER BY n.updatedAt DESC
  `);
  const rows = stmt.all(tagName) as Array<any>;

  // Build hierarchy similar to getCategoryHierarchy but only for notes that have the tagName.
  const hierarchy: any = {};
  const uncategorizedNotes: Note[] = [];

  rows.forEach(row => {
    const note: Note = {
      id: row.id, title: row.title, filePath: row.filePath, createdAt: row.createdAt, updatedAt: row.updatedAt,
      lastEdited: row.lastEdited ?? null
    };
    const positions = [row.pos0, row.pos1, row.pos2].map((x: any) => x == null ? null : String(x));
    let primary: string | null = null;
    let secondary: string | null = null;
    let tertiary: string | null = null;
    for (let i = 0; i < positions.length; i++) {
      const v = positions[i];
      if (!v) continue;
      if (!PROTECTED_TAGS.has(v) && primary == null) { primary = v; continue; }
      if (!v) continue;
      if (primary != null && secondary == null && !PROTECTED_TAGS.has(v)) { secondary = v; continue; }
      if (primary != null && secondary != null && tertiary == null && !PROTECTED_TAGS.has(v)) { tertiary = v; }
    }
    if (!primary) { uncategorizedNotes.push(note); return; }
    if (!hierarchy[primary]) hierarchy[primary] = { notes: [], secondary: {} };
    if (!secondary) { hierarchy[primary].notes.push(note); return; }
    if (!hierarchy[primary].secondary[secondary]) hierarchy[primary].secondary[secondary] = { notes: [], tertiary: {} };
    if (!tertiary) { hierarchy[primary].secondary[secondary].notes.push(note); return; }
    if (!hierarchy[primary].secondary[secondary].tertiary[tertiary]) hierarchy[primary].secondary[secondary].tertiary[tertiary] = [];
    hierarchy[primary].secondary[secondary].tertiary[tertiary].push(note);
  });

  const ordered: any = {};
  const keys = Object.keys(hierarchy).filter(Boolean).sort((a, b) => a.localeCompare(b));
  for (const k of keys) ordered[k] = hierarchy[k];
  return { hierarchy: ordered, uncategorizedNotes };
}

export function getNotesInTrash(): Note[] {
  // Return notes that have tag 'deleted', sorted by lastEdited desc
  const stmt = db.prepare(`
    SELECT n.*
    FROM notes n
    JOIN note_tags nt ON n.id = nt.noteId
    JOIN tags t ON nt.tagId = t.id
    WHERE LOWER(t.name) = 'deleted'
    ORDER BY n.lastEdited DESC
  `);
  const rows = stmt.all() as Note[];
  return rows;
}

/**
 * Reconcile the database notes table with the on-disk `.md` files.
 *
 * Behavior (safe defaults):
 * - For each `.md` file in the notes directory not referenced by any DB note,
 *   create a new DB note. The note title is derived from the first non-empty
 *   line (stripping leading `#`), or the filename if none.
 * - For each DB note that references a path that no longer exists on disk,
 *   add the protected `deleted` tag (position 0) if not already present.
 * - If a file exists named `<id>.md` and a DB note with that id exists but
 *   has a different `filePath`, update the DB `filePath` to the expected
 *   location.
 *
 * Returns details about actions taken so the caller can present results.
 */
export async function reconcileNotesWithFs(opts?: { markMissingAsDeleted?: boolean }) : Promise<{
  createdNoteIds: number[];
  updatedPaths: Array<{ noteId: number; oldPath: string; newPath: string }>;
  markedDeletedNoteIds: number[];
}> {
  const markMissingAsDeleted = opts?.markMissingAsDeleted ?? true;
  const notesDir = getNotesDir();
  const results = { createdNoteIds: [] as number[], updatedPaths: [] as Array<{ noteId: number; oldPath: string; newPath: string }> , markedDeletedNoteIds: [] as number[] };

  let files: string[] = [];
  try {
    files = (await fs.readdir(notesDir)).filter(f => f.toLowerCase().endsWith('.md'));
  } catch (err) {
    // If notes dir inaccessible, nothing to do.
    return results;
  }

  const absFiles = new Set(files.map(f => path.normalize(path.join(notesDir, f))));

  const allNotes = getAllNotes();
  const dbPathMap = new Map<string, Note>();
  const dbIdMap = new Map<number, Note>();
  for (const n of allNotes) {
    try { dbPathMap.set(path.normalize(n.filePath), n); } catch { dbPathMap.set(String(n.filePath), n); }
    dbIdMap.set(n.id, n);
  }

  // Build a quick lookup of notes whose files are currently missing on disk,
  // keyed by lowercased title to allow associating orphan files created externally
  // with their DB note when the content/title matches.
  const missingNotesByTitle = new Map<string, Note[]>();
  for (const n of allNotes) {
    try {
      const norm = path.normalize(n.filePath);
      if (!absFiles.has(norm)) {
        const key = String(n.title ?? '').trim().toLowerCase();
        const arr = missingNotesByTitle.get(key) ?? [];
        arr.push(n);
        missingNotesByTitle.set(key, arr);
      }
    } catch {
      // ignore normalization errors
    }
  }

  // Ensure files referenced by DB use canonical filenames and tokens where possible.
  // This pass renames files (in-place) that are referenced by DB but don't follow
  // the YY-MM-DD_hh-mm_TOKEN.md pattern or where the DB lacks a token.
  for (const f of Array.from(absFiles)) {
    const note = dbPathMap.get(f);
    if (!note) continue;
    const base = path.basename(f, '.md');
    const match = /^([0-9]{2}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2})_([A-Z0-9]{9})$/i.exec(base);
    try {
      const stat = await fs.stat(f);
      const fileCreatedIso = (stat.birthtime && !isNaN(stat.birthtime.getTime())) ? stat.birthtime.toISOString() : stat.mtime.toISOString();
      const fileEditedIso = stat.mtime.toISOString();

      // Ensure DB has createdAt/lastEdited populated if missing
      if (!note.createdAt) updateNoteCreatedAt(note.id, fileCreatedIso);
      if (!note.lastEdited) updateNoteLastEdited(note.id, fileEditedIso);

      // If filename already matches and token matches DB, nothing to do
      if (match) {
        const token = match[2].toUpperCase();
        if ((note as any).fileToken && String((note as any).fileToken).toUpperCase() === token) continue;
      }

      // Need to ensure token exists
      let token = (note as any).fileToken as string | undefined;
      if (!token) {
        token = generateUniqueFileToken();
        try { setNoteFileToken(note.id, token); } catch (err) { /* non-fatal */ }
      }

      // Use DB createdAt if present (falls back to fileCreatedIso)
      const createdSource = note.createdAt ?? fileCreatedIso;
      const d = new Date(createdSource);
      const yy = String(d.getFullYear()).slice(-2);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      const fname = `${yy}-${mm}-${dd}_${hh}-${min}_${token}.md`;
      const dest = path.join(notesDir, fname);
      if (path.normalize(dest) !== path.normalize(f)) {
        try {
          await fs.rename(f, dest);
          updateNoteFilePath(note.id, dest);
          // update maps so later logic skips this new path
          dbPathMap.delete(f);
          dbPathMap.set(path.normalize(dest), note);
          absFiles.delete(f);
          absFiles.add(path.normalize(dest));
          results.updatedPaths.push({ noteId: note.id, oldPath: f, newPath: dest });
        } catch (err) {
          // non-fatal - leave file in place
          console.warn('[db] failed to rename file to canonical name', f, err);
        }
      }
    } catch (err) {
      // ignore stat errors - will be handled later
    }
  }

  // 1) Files on disk not referenced by DB -> create notes or update existing by id
  for (const f of absFiles) {
    if (dbPathMap.has(f)) continue; // already referenced
    const base = path.basename(f, '.md');
    // Read file content early so we can attempt title-based matching to existing missing notes
    let content = '';
    try { const { normalizeFileEncoding } = await import('./fileSystem'); content = await normalizeFileEncoding(f); } catch { content = ''; }
    const derivedTitle = (() => {
      const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length > 0) {
        const first = lines[0].replace(/^#+\s*/, '').trim();
        return first || base;
      }
      return base;
    })();

    // If there's a DB note whose file is missing and whose title matches this file's derived title,
    // associate the file to that note instead of creating a duplicate entry. This prevents newly
    // added files from causing their DB counterpart to be marked deleted.
    try {
      const key = String(derivedTitle).trim().toLowerCase();
      const bucket = missingNotesByTitle.get(key);
      if (bucket && bucket.length > 0) {
        const note = bucket.shift()!; // take first candidate
        const old = note.filePath;
        // derive timestamps from file stat
        let createdIso = new Date().toISOString();
        let editedIso = new Date().toISOString();
        try {
          const stat = await fs.stat(f);
          createdIso = (stat.birthtime && !isNaN(stat.birthtime.getTime())) ? stat.birthtime.toISOString() : stat.mtime.toISOString();
          editedIso = stat.mtime.toISOString();
        } catch { void 0; }

        // populate DB created/lastEdited if missing
        try { if (!note.createdAt) updateNoteCreatedAt(note.id, createdIso); } catch { void 0; }
        try { if (!note.lastEdited) updateNoteLastEdited(note.id, editedIso); } catch { void 0; }

        // ensure token exists and rename to canonical filename
        let token = (note as any).fileToken as string | undefined;
        if (!token) {
          token = generateUniqueFileToken();
          try { setNoteFileToken(note.id, token); } catch { void 0; }
        }
        const createdSource = note.createdAt ?? createdIso;
        const d = new Date(createdSource);
        const yy = String(d.getFullYear()).slice(-2);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        const fname = `${yy}-${mm}-${dd}_${hh}-${min}_${token}.md`;
        const dest = path.join(notesDir, fname);
        try {
          await fs.rename(f, dest);
          updateNoteFilePath(note.id, dest);
          // update maps so later logic skips this new path
          dbPathMap.set(path.normalize(dest), note);
          absFiles.delete(f);
          absFiles.add(path.normalize(dest));
          results.updatedPaths.push({ noteId: note.id, oldPath: old, newPath: dest });
        } catch (err) {
          // fallback: point DB at the original path if rename failed
          updateNoteFilePath(note.id, f);
          dbPathMap.set(path.normalize(f), note);
          results.updatedPaths.push({ noteId: note.id, oldPath: old, newPath: f });
        }
        try { upsertNoteFts(note.id, note.title ?? derivedTitle, content); } catch { void 0; }
        continue;
      }
    } catch (err) {
      // non-fatal - continue to other heuristics
    }
    // Expect format: YY-MM-DD_hh-mm_TOKEN (TOKEN = 9 uppercase alnum)
    const m = /^([0-9]{2}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2})_([A-Z0-9]{9})$/i.exec(base);
    if (m) {
      const datePart = m[1];
      const token = m[2].toUpperCase();
      const existing = getNoteByToken(token);
      if (existing) {
        const old = existing.filePath;
        if (path.normalize(old) !== f) {
          updateNoteFilePath(existing.id, f);
          results.updatedPaths.push({ noteId: existing.id, oldPath: old, newPath: f });
        }
        // Verify createdAt matches datePart (YY-MM-DD_hh-mm)
        try {
          const parts = /^([0-9]{2})-([0-9]{2})-([0-9]{2})_([0-9]{2})-([0-9]{2})$/.exec(datePart);
          if (parts) {
            const yy = Number(parts[1]);
            const year = 2000 + yy;
            const month = Number(parts[2]) - 1;
            const day = Number(parts[3]);
            const hour = Number(parts[4]);
            const minute = Number(parts[5]);
            const parsedIso = new Date(year, month, day, hour, minute).toISOString();
            const noteCreated = new Date(existing.createdAt).toISOString();
            const fmtNote = new Date(noteCreated);
            if (Math.abs(new Date(parsedIso).getTime() - fmtNote.getTime()) > 60 * 1000) {
              // If mismatch > 1 minute, update DB to match file timestamp
              updateNoteCreatedAt(existing.id, parsedIso);
            }
          }
        } catch (err) { /* non-fatal */ }
        continue;
      }
      // No existing token -> create a new note and record token + createdAt
      const title = (() => {
        const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length > 0) {
          const first = lines[0].replace(/^#+\s*/, '').trim();
          return first || base;
        }
        return base;
      })();
      const createdNote = createNote(title, f);
      try { setNoteFileToken(createdNote.id, token); } catch (err) { /* non-fatal */ }
      try {
        const parts = /^([0-9]{2})-([0-9]{2})-([0-9]{2})_([0-9]{2})-([0-9]{2})$/.exec(m[1]);
        if (parts) {
          const yy = Number(parts[1]);
          const year = 2000 + yy;
          const month = Number(parts[2]) - 1;
          const day = Number(parts[3]);
          const hour = Number(parts[4]);
          const minute = Number(parts[5]);
          const parsedIso = new Date(year, month, day, hour, minute).toISOString();
          updateNoteCreatedAt(createdNote.id, parsedIso);
        }
      } catch (err) { /* non-fatal */ }
      try { upsertNoteFts(createdNote.id, title, content); } catch { /* non-fatal */ }
      results.createdNoteIds.push(createdNote.id);
      continue;
    }

    // Fallback: previous behavior (numeric basename -> update by id, otherwise create)
    const parsedId = Number(base);
    if (!Number.isNaN(parsedId) && dbIdMap.has(parsedId)) {
      // Note exists by id but path differs -> update filePath
      const note = dbIdMap.get(parsedId)!;
      const old = note.filePath;
      if (path.normalize(old) !== f) {
        updateNoteFilePath(parsedId, f);
        results.updatedPaths.push({ noteId: parsedId, oldPath: old, newPath: f });
      }
      continue;
    }

    // Otherwise create a new note entry. Derive title from file contents,
    // generate token, rename file to canonical name, and populate created/lastEdited from stat.
    const title = (() => {
      const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length > 0) {
        const first = lines[0].replace(/^#+\s*/, '').trim();
        return first || base;
      }
      return base;
    })();

    // derive timestamps from file stat
    let createdIso = new Date().toISOString();
    let editedIso = new Date().toISOString();
    try {
      const stat = await fs.stat(f);
      createdIso = (stat.birthtime && !isNaN(stat.birthtime.getTime())) ? stat.birthtime.toISOString() : stat.mtime.toISOString();
      editedIso = stat.mtime.toISOString();
    } catch (err) {
      // non-fatal
    }

    const token = generateUniqueFileToken();
    // build canonical filename
    try {
      const d = new Date(createdIso);
      const yy = String(d.getFullYear()).slice(-2);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      const fname = `${yy}-${mm}-${dd}_${hh}-${min}_${token}.md`;
      const dest = path.join(notesDir, fname);
      try {
        await fs.rename(f, dest);
      } catch (err) {
        // if rename fails, fall back to leaving file in place and still create DB entry pointing to original path
      }

      const createdNote = createNote(title, path.normalize(path.join(notesDir, fname)));
      try { setNoteFileToken(createdNote.id, token); } catch (err) { /* non-fatal */ }
      try { updateNoteCreatedAt(createdNote.id, createdIso); } catch (err) { /* non-fatal */ }
      try { updateNoteLastEdited(createdNote.id, editedIso); } catch (err) { /* non-fatal */ }
      try { upsertNoteFts(createdNote.id, title, content); } catch { /* non-fatal */ }
      results.createdNoteIds.push(createdNote.id);
    } catch (err) {
      // final fallback: create note pointing to original file
      const createdNote = createNote(title, f);
      try { upsertNoteFts(createdNote.id, title, content); } catch { /* non-fatal */ }
      results.createdNoteIds.push(createdNote.id);
    }
  }

  // 2) DB notes referencing missing files -> mark as deleted (safe, non-destructive)
  if (markMissingAsDeleted) {
    for (const note of allNotes) {
      const fp = note.filePath;
      if (!fp) continue;
      const norm = path.normalize(fp);
      if (absFiles.has(norm)) continue; // file present

      // only mark if not already tagged 'deleted'
      try {
        const tags = getNoteTags(note.id);
        const alreadyDeleted = tags.some(t => String(t.tag?.name ?? '').toLowerCase() === 'deleted');
        if (!alreadyDeleted) {
          addTagToNote(note.id, 'deleted', 0);
          results.markedDeletedNoteIds.push(note.id);
        }
      } catch (err) {
        // non-fatal, continue
      }
    }
  }

  return results;
}
export function saveNoteSnapshot(noteId: number, content: string, isManual: boolean = false): void {
  const latestSnapshot = db.prepare(
    'SELECT id, content FROM note_snapshots WHERE noteId = ? ORDER BY timestamp DESC LIMIT 1'
  ).get(noteId) as { id: number; content: string } | undefined;

  if (latestSnapshot && latestSnapshot.content === content && !isManual) {
    return;
  }

  const timestamp = new Date().toISOString();
  const insertStmt = db.prepare(
    'INSERT INTO note_snapshots (noteId, content, timestamp, isManual) VALUES (?, ?, ?, ?)'
  );
  const deleteStmt = db.prepare('DELETE FROM note_snapshots WHERE id = ?');

  const saveTx = db.transaction(() => {
    insertStmt.run(noteId, content, timestamp, isManual ? 1 : 0);
    if (latestSnapshot && latestSnapshot.content === content && isManual) {
      deleteStmt.run(latestSnapshot.id);
    }
    compactNoteSnapshots(noteId);
  });

  saveTx();
}

export function getNoteSnapshots(noteId: number): import('../shared/types').NoteSnapshot[] {
  const rows = db.prepare('SELECT * FROM note_snapshots WHERE noteId = ? ORDER BY timestamp DESC').all(noteId) as any[];
  return rows.map(r => ({
    id: r.id,
    noteId: r.noteId,
    content: r.content,
    timestamp: r.timestamp,
    isManual: r.isManual === 1
  }));
}

export function deleteNoteSnapshot(snapshotId: number): void {
  db.prepare('DELETE FROM note_snapshots WHERE id = ?').run(snapshotId);
}

function compactNoteSnapshots(noteId: number): void {
  const snapshots = db.prepare('SELECT * FROM note_snapshots WHERE noteId = ? ORDER BY timestamp DESC').all(noteId) as import('../shared/types').NoteSnapshot[];
  if (snapshots.length === 0) return;

  const now = Date.now();
  const toDelete: number[] = [];
  const keptSnapshots: any[] = [];

  let lastKeptContent: string | null = null;
  
  let lastKeptAge = -1;
  const MAX_CHECK_AGE = 12 * 60 * 60 * 1000;

  for (const snap of snapshots) {
    const age = now - new Date(snap.timestamp).getTime();

    if ((snap as any).isManual === 1) {
      keptSnapshots.push(snap);
      lastKeptContent = snap.content;
      lastKeptAge = age;
      continue;
    }
    
    if (lastKeptContent !== null && lastKeptContent === snap.content) {
      toDelete.push(snap.id);
      continue;
    }

    let kept = false;

    if (lastKeptAge === -1) {
      kept = true;
    } else {
      const timeDiff = age - lastKeptAge;
      const threshold = Math.min(age / 2, MAX_CHECK_AGE);
      if (timeDiff >= threshold) {
        kept = true;
      }
    }

    if (kept) {
      lastKeptContent = snap.content;
      lastKeptAge = age;
      keptSnapshots.push(snap);
    } else {
      toDelete.push(snap.id);
    }
  }

  if (toDelete.length > 0) {
    const deleteStmt = db.prepare('DELETE FROM note_snapshots WHERE id = ?');
    const transaction = db.transaction((ids: number[]) => {
      for (const id of ids) deleteStmt.run(id);
    });
    transaction(toDelete);
  }
}

