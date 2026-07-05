import type { DatabaseService } from '../databaseService';
import { HELP_NOTE_CONTENT } from './helpNoteContent';

const HELP_NOTE_ID = '26-07-04_00-00_WELCOME00';
const HELP_NOTE_TITLE = 'Welcome to Measly Notes';

/**
 * Creates a help note if the database is empty.
 * This ensures new users have a welcoming guide on first launch.
 * 
 * @param db The database service instance
 */
export function ensureHelpNote(db: DatabaseService): void {
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

  db.upsertNoteContent({
    id: HELP_NOTE_ID,
    title: HELP_NOTE_TITLE,
    filePath: '',
    text: HELP_NOTE_CONTENT,
    createdAtMs: helpNoteTime,
    updatedAtMs: helpNoteTime,
    isTemp: false,
    externalPath: null,
    hasUnsavedChanges: false,
    syncMode: false,
  });

  console.log(`[ensureHelpNote] Help note created successfully`);
}
