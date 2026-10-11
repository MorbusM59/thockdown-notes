import { HELP_GUIDE_NOTE_IDS } from '../../src/shared/helpGuide';
import { sanitizeDocumentText } from '../../src/shared/textSanitization';
import type { DatabaseService } from '../databaseService';
import { HELP_NOTE_CONTENT } from './helpNoteContent';

const HELP_NOTE_ID = '26-07-04_00-00_WELCOME00';
/** The welcome note's user-facing id, mirroring the User Guide's own 'HELP' (src/shared/helpGuide.ts). */
const WELCOME_NOTE_ASSIGNED_ID = 'WELCOME';
const HELP_NOTE_TITLE = 'Welcome to Thockdown Notes';

/**
 * Creates a help note if the database is empty.
 * This ensures new users have a welcoming guide on first launch.
 *
 * @param db The database service instance
 */
export async function ensureHelpNote(db: DatabaseService): Promise<void> {
  const notes = db.listNoteRecords();
  const realNotes = notes.filter((note) => !HELP_GUIDE_NOTE_IDS.has(note.id));
  console.log(`[ensureHelpNote] Database contains ${realNotes.length} real user notes (excluding built-in guide family)`);

  // Only create the welcome note if the database has no real user notes
  // beyond the app-owned User Guide family.
  if (realNotes.length > 0) {
    console.log(`[ensureHelpNote] Real user notes already present, skipping welcome note creation`);
    return;
  }

  console.log(`[ensureHelpNote] Creating welcome help note...`);

  // Create the help note with a fixed timestamp (July 4, 2026, 00:00)
  const helpNoteTime = new Date(2026, 6, 4, 0, 0, 0, 0).getTime();

  const text = sanitizeDocumentText(HELP_NOTE_CONTENT);

  db.upsertNoteContent({
    id: HELP_NOTE_ID,
    title: HELP_NOTE_TITLE,
    text,
    createdAtMs: helpNoteTime,
    updatedAtMs: helpNoteTime,
    isTemp: false,
    externalPath: null,
    hasUnsavedChanges: false,
    syncMode: false,
  });

  // A real, user-facing id from birth -- the same treatment the User Guide
  // gets ('HELP'). Without it the welcome note would be handed a provisional
  // NOTE-#n by the startup backfill, i.e. the very first note a new user sees
  // would be asking them to name it.
  db.setNoteAssignedId(HELP_NOTE_ID, WELCOME_NOTE_ASSIGNED_ID);

  console.log(`[ensureHelpNote] Help note created successfully`);
}
