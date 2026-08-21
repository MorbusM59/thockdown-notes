import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { sanitizeDocumentText } from '../../src/shared/textSanitization';
import type { DatabaseService } from '../databaseService';
import type { NoteLifecycleService } from '../noteLifecycleService';
import {
  HELP_GUIDE_ASSIGNED_ID,
  HELP_GUIDE_ROOT_ID,
  HELP_GUIDE_AUTO_TOC_ID,
  HELP_GUIDE_INTRO_CONTENT,
  HELP_GUIDE_CHAPTERS,
} from './helpGuideContent';

// app_meta key this module's own reseed-skip check reads/writes -- see
// ensureHelpGuide's own doc comment.
const HELP_GUIDE_CONTENT_HASH_KEY = 'helpGuideContentHash';

/**
 * A stable digest of every hand-authored guide string (the root's own intro
 * plus each chapter's id/chapterId/content) -- anything that would actually
 * change what ends up on disk/in the DB. Deliberately NOT a function of
 * anything generated (the auto-TOC chapter's own content, timestamps, ...),
 * so regenerating those on a future startup never falsely looks like a
 * content change. JSON.stringify over a plain array keeps id/chapterId
 * baked into the digest alongside content, so reordering chapters or
 * changing an id counts as a change too, not just editing prose.
 */
function computeHelpGuideContentHash(): string {
  const payload = JSON.stringify({
    intro: HELP_GUIDE_INTRO_CONTENT,
    chapters: HELP_GUIDE_CHAPTERS.map((chapter) => ({
      noteId: chapter.noteId,
      chapterId: chapter.chapterId,
      content: chapter.content,
    })),
  });
  return createHash('sha256').update(payload).digest('hex');
}

// One minute after the Welcome note's own fixed timestamp -- see
// helpNote.ts -- purely so the two sort adjacently if anything ever needs a
// date-based tiebreak between this app's two system notes. Never shown to
// the user (the guide never appears in Date/Category/Archive/Trash/Find --
// see the exclusion in App.tsx's searchedNotes).
const HELP_GUIDE_TIME_MS = new Date(2026, 6, 4, 0, 1, 0, 0).getTime();

async function writeNoteFile(db: DatabaseService, id: string, text: string): Promise<{ filePath: string; sanitized: string }> {
  const notesDir = db.getNotesDir();
  await fs.mkdir(notesDir, { recursive: true });
  const filePath = path.join(notesDir, `${id}.md`);
  const sanitized = sanitizeDocumentText(text);
  await fs.writeFile(filePath, sanitized, 'utf8');
  return { filePath, sanitized };
}

function deriveTitle(text: string): string {
  const firstLine = text.split('\n')[0] ?? '';
  return firstLine.replace(/^#+\s*/, '').trim() || 'Untitled';
}

/**
 * Seeds (and re-seeds, whenever the content actually changed) the built-in
 * User Guide: a protected parent note (assigned id `$HELP`) plus one real
 * chapter per topic, plus an auto-generated Table of Contents chapter for
 * navigation between them. Content itself lives in helpGuideContent.ts --
 * this module only wires it into the database.
 *
 * Deliberately NOT gated on "database is empty" the way ensureHelpNote's
 * Welcome note is (see helpNote.ts) -- this content should track app
 * updates (a shipped documentation fix should reach an existing install on
 * its next launch), not just first-run installs. It IS gated on
 * computeHelpGuideContentHash() matching the hash stashed in app_meta from
 * the last time this actually ran, though: checked (cheap: one SELECT, no
 * disk writes) on literally every startup, but the real reseed work below
 * -- and the unfreeze/refreeze bracket around it -- only runs when a
 * shipped content change (or a first run, with no stored hash yet) means
 * there's actually something new to write. Safe to re-run at all: every id
 * touched here is one of this module's own fixed constants
 * (HELP_GUIDE_ROOT_ID / HELP_GUIDE_CHAPTERS' own ids / HELP_GUIDE_AUTO_TOC_ID)
 * -- never a user-generated one, so this can never collide with or
 * overwrite a real note. `addChapter` (the one non-idempotent primitive
 * involved -- a plain INSERT) is guarded by checking `listChaptersForNote`
 * first, so re-running this on an install that already has the guide never
 * creates duplicate chapter links.
 *
 * Must run after `noteLifecycleService` exists (i.e. from
 * `registerIpcHandlers()` in main.ts, not `DatabaseService.initialize()`,
 * which runs first and constructs only the database layer) -- regenerating
 * the auto-TOC chapter needs `NoteLifecycleService.regenerateAutoTocChapter`,
 * the exact same heading-walking code path a real note's own TOC chapter
 * uses, not a second, hand-rolled copy of it.
 *
 * The whole family is timeless (databaseService.ts's `isTimeless` column --
 * see HelpModeOverlay's removal in favor of loading this family through the
 * real editor) so it's permanently protected from a user's own edits, but
 * that same protection would otherwise block this very reseed: every write
 * below (`upsertNoteContent`, `setNoteAssignedId`, `addChapter`,
 * `setChapterId`) goes through the identical `DatabaseService` primitives a
 * real edit would, guarded by `assertNotTimeless`. So this brackets its own
 * writes with an explicit unfreeze-before/refreeze-after, rather than a
 * special bypass path -- seeding uses the exact same public
 * freeze/unfreeze operation a user's own "unfreeze this note" action would.
 */
export async function ensureHelpGuide(db: DatabaseService, noteLifecycle: NoteLifecycleService): Promise<void> {
  const contentHash = computeHelpGuideContentHash();
  if (db.getAppMeta(HELP_GUIDE_CONTENT_HASH_KEY) === contentHash) {
    return;
  }

  const now = HELP_GUIDE_TIME_MS;

  db.unfreezeNoteFamily(HELP_GUIDE_ROOT_ID);

  const root = await writeNoteFile(db, HELP_GUIDE_ROOT_ID, HELP_GUIDE_INTRO_CONTENT);
  db.upsertNoteContent({
    id: HELP_GUIDE_ROOT_ID,
    title: deriveTitle(HELP_GUIDE_INTRO_CONTENT),
    filePath: root.filePath,
    text: root.sanitized,
    createdAtMs: now,
    updatedAtMs: now,
  });
  db.setNoteAssignedId(HELP_GUIDE_ROOT_ID, HELP_GUIDE_ASSIGNED_ID);

  const existingChapterNoteIds = new Set(db.listChaptersForNote(HELP_GUIDE_ROOT_ID).map((chapter) => chapter.chapterNoteId));

  for (const chapter of HELP_GUIDE_CHAPTERS) {
    const written = await writeNoteFile(db, chapter.noteId, chapter.content);
    db.upsertNoteContent({
      id: chapter.noteId,
      title: deriveTitle(chapter.content),
      filePath: written.filePath,
      text: written.sanitized,
      createdAtMs: now,
      updatedAtMs: now,
    });
    db.setNoteChapterOnly(chapter.noteId, true);
    if (!existingChapterNoteIds.has(chapter.noteId)) {
      db.addChapter(HELP_GUIDE_ROOT_ID, chapter.noteId);
    }
    db.setChapterId(HELP_GUIDE_ROOT_ID, chapter.noteId, chapter.chapterId);
  }

  // Auto-TOC chapter: seeded once as an empty placeholder, pinned to the
  // front like any other note's own auto-TOC chapter, then immediately
  // populated below via the real regeneration code path -- never
  // hand-written content of its own.
  if (!db.getAutoTocChapterNoteId(HELP_GUIDE_ROOT_ID)) {
    const placeholder = '# Table of Contents\n';
    const written = await writeNoteFile(db, HELP_GUIDE_AUTO_TOC_ID, placeholder);
    db.upsertNoteContent({
      id: HELP_GUIDE_AUTO_TOC_ID,
      title: 'Table of Contents',
      filePath: written.filePath,
      text: written.sanitized,
      createdAtMs: now,
      updatedAtMs: now,
    });
    db.setNoteChapterOnly(HELP_GUIDE_AUTO_TOC_ID, true);
    db.setNoteAutoToc(HELP_GUIDE_AUTO_TOC_ID, true);
    if (!existingChapterNoteIds.has(HELP_GUIDE_AUTO_TOC_ID)) {
      db.addChapter(HELP_GUIDE_ROOT_ID, HELP_GUIDE_AUTO_TOC_ID);
    }
    db.pinChapterToFront(HELP_GUIDE_ROOT_ID, HELP_GUIDE_AUTO_TOC_ID);
  }

  // regenerateAutoTocChapter writes through NoteLifecycleService.saveNote,
  // which (correctly, for a real edit) stamps the real current time --
  // confirmed live: on a fresh install this made the auto-TOC chapter sort
  // as the single most-recently-updated note in the whole database, ahead
  // of even the Welcome note. App.tsx's refreshNotes fallback now excludes
  // the whole guide family from ever being selected as the default note
  // regardless, but re-pinning this note's own timestamp back to the
  // guide's fixed seed time (rather than leaving it drifting to "now" on
  // every restart that happens to touch its content) keeps its DB row
  // honest: it was never really "edited," just regenerated.
  const { created: tocDoc } = await noteLifecycle.regenerateAutoTocChapter(HELP_GUIDE_ROOT_ID);
  db.upsertNoteContent({
    id: HELP_GUIDE_AUTO_TOC_ID,
    title: tocDoc.title,
    filePath: path.join(db.getNotesDir(), tocDoc.fileName),
    text: tocDoc.text,
    createdAtMs: now,
    updatedAtMs: now,
  });

  // Freeze the whole family back up now that this run's reseed is done --
  // stamps isTimeless on the root + every real chapter + the auto-TOC
  // chapter, and clears their (never meaningfully populated) snapshot
  // history. See freezeNoteFamily's own doc comment.
  db.freezeNoteFamily(HELP_GUIDE_ROOT_ID);

  // Recorded last, only once every write above has actually landed -- if
  // this ran (or the process) died partway through, the stale/missing hash
  // means the next startup's check above sees a mismatch and redoes the
  // whole reseed rather than wrongly believing it's already current.
  db.setAppMeta(HELP_GUIDE_CONTENT_HASH_KEY, contentHash);
}
