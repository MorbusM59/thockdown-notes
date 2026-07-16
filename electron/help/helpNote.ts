import { promises as fs } from 'node:fs';
import path from 'node:path';
import { sanitizeDocumentText } from '../../src/shared/textSanitization';
import type { DatabaseService } from '../databaseService';
import { HELP_NOTE_CONTENT } from './helpNoteContent';

const HELP_NOTE_ID = '26-07-04_00-00_WELCOME00';
const HELP_NOTE_TITLE = 'Welcome to Thockdown Notes';
const HELP_NOTE_FILE_NAME = `${HELP_NOTE_ID}.md`;

/**
 * Creates a help note if the database is empty.
 * This ensures new users have a welcoming guide on first launch.
 *
 * @param db The database service instance
 */
export async function ensureHelpNote(db: DatabaseService): Promise<void> {
  // Get all notes from the database
  const notes = db.listNoteRecords();
  console.log(`[ensureHelpNote] Database contains ${notes.length} notes`);

  // Only create help note if database is truly empty
  if (notes.length > 0) {
    console.log(`[ensureHelpNote] Database not empty, skipping help note creation`);
    return;
  }

  console.log(`[ensureHelpNote] Creating welcome help note...`);

  // Create the help note with a fixed timestamp (July 4, 2026, 00:00)
  const helpNoteTime = new Date(2026, 6, 4, 0, 0, 0, 0).getTime();

  // upsertNoteContent only writes the notes-table row and the FTS search
  // index; it never touches the filesystem. Every other note-creation path
  // (see NoteLifecycleService.createNote) writes the actual body text to a
  // file under the notes directory *before* calling upsertNoteContent, and
  // the app reads that file back when the note is opened. Passing
  // filePath: '' skipped that write entirely, so the note row existed with
  // no backing file — which is exactly why it opened empty.
  const notesDir = db.getNotesDir();
  await fs.mkdir(notesDir, { recursive: true });

  const filePath = path.join(notesDir, HELP_NOTE_FILE_NAME);
  const text = sanitizeDocumentText(HELP_NOTE_CONTENT);
  await fs.writeFile(filePath, text, 'utf8');

  db.upsertNoteContent({
    id: HELP_NOTE_ID,
    title: HELP_NOTE_TITLE,
    filePath,
    text,
    createdAtMs: helpNoteTime,
    updatedAtMs: helpNoteTime,
    isTemp: false,
    externalPath: null,
    hasUnsavedChanges: false,
    syncMode: false,
  });

  console.log(`[ensureHelpNote] Help note created successfully`);
}
