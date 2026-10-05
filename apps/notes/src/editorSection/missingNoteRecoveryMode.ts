import type { EscapeMenuCell, EscapeMenuMode } from '../escapeMenu/escapeMenuContract'
import type { NoteSummary } from '../shared/noteLifecycle'

/**
 * Which note is asking to be recovered, and in which slot the ring asking
 * about it is drawn: the slot the reader tried to open it in.
 */
export interface MissingNoteRecovery {
  noteId: string
  sectionId: string
}

export interface MissingNoteRecoveryActs {
  restore: () => void | Promise<void>
  specify: () => void | Promise<void>
  remove: () => void | Promise<void>
  dismiss: () => void
}

export const MISSING_NOTE_RECOVERY_MODE_ID = 'missing-note-file'

/** The narration vocabulary's markers (escapeMenu/narrationMarkup.ts) are taken out of a title, which is the reader's text. */
function plainTitle(title: string): string {
  return title.replace(/[*[\]]/g, '').trim() || 'Untitled'
}

/**
 * What the escape ring offers in place of a note whose file is missing
 * (NoteSummary.missingFile), as a mode over the slot it was opened in.
 *
 * The first cell is the default, because a mode's dial starts at its first
 * cell: restoring from the database's copy when there is one, since it
 * gives back exactly the note that went missing, and pointing at a file
 * otherwise. Deleting the entry is last and never the default -- it is the
 * one choice here that cannot be taken back.
 */
export function missingNoteRecoveryMode(note: NoteSummary, acts: MissingNoteRecoveryActs): EscapeMenuMode {
  const cells: EscapeMenuCell[] = []
  if (note.missingFile?.hasStoredCopy) {
    cells.push({ id: 'restore', label: 'Restore from saved copy', icon: 'fa-solid fa-clock-rotate-left', onSelect: acts.restore })
  }
  cells.push({ id: 'specify', label: 'Specify missing file', icon: 'fa-solid fa-file-import', onSelect: acts.specify })
  cells.push({ id: 'delete', label: 'Delete database entry', icon: 'fa-solid fa-trash-can', onSelect: acts.remove })
  return {
    id: MISSING_NOTE_RECOVERY_MODE_ID,
    stepKey: note.id,
    cells,
    status: {
      title: 'Missing file',
      narration: [`**${plainTitle(note.title)}:** *its file is missing from the notes folder*`],
      readouts: [],
    },
    onDismiss: acts.dismiss,
  }
}
