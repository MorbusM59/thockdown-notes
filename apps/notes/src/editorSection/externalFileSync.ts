import { sanitizeDocumentText } from '../shared/textSanitization'
import { reconcileExternalFile } from '../shared/externalFileReconcile'
import type { ExternalFilesApi } from '../shared/externalFiles'
import type { NoteLifecycleApi, NoteSummaryWithContent } from '../shared/noteLifecycle'
import type { NoteDocumentStore } from './noteDocumentStore'

export interface ExternalFileSyncOptions {
  noteDocuments: NoteDocumentStore
  externalFiles: Pick<ExternalFilesApi, 'watchNoteFiles' | 'readNoteFile' | 'onNoteFileChanged'>
  notes: Pick<NoteLifecycleApi, 'getFromDiskBaseline' | 'saveNoteSnapshot' | 'updateExternalNoteState'>
  /** The note's file was recorded as holding `text` -- its new baseline. */
  onBaseline: (noteId: string, text: string) => void
  /** The note's summary changed without its text changing (it became clean). */
  onSummary: (summary: NoteSummaryWithContent, text: string) => void
  /** The note's edits now stand against a newer file (true), or the note was brought into step with its file (false). */
  onConflict: (noteId: string, conflicted: boolean) => void
}

/**
 * Keeps every OPEN external note in step with its file
 * (src/shared/externalFileReconcile.ts has the rule). A note is reconciled
 * when its document opens -- which covers opening the file again, a slot
 * restored at launch, and choosing the note in the sidebar -- and whenever
 * the main process reports that its file changed while it is open. Closed
 * notes are not watched: the next open reconciles them.
 *
 * Returns the function that stops it.
 */
export function installExternalFileSync(options: ExternalFileSyncOptions): () => void {
  const { noteDocuments, externalFiles, notes, onBaseline, onSummary, onConflict } = options
  let stopped = false
  let open = new Set<string>()
  // One reconciliation per note at a time: two reports of one change would
  // otherwise both read the old baseline and both act on it.
  const running = new Map<string, Promise<void>>()

  const reconcile = (noteId: string): Promise<void> => {
    const previous = running.get(noteId) ?? Promise.resolve()
    const next = previous.then(() => reconcileNow(noteId)).catch((error) => {
      console.error('[external-files] failed to reconcile a note with its file', { noteId, error })
    })
    running.set(noteId, next)
    void next.finally(() => { if (running.get(noteId) === next) running.delete(noteId) })
    return next
  }

  const reconcileNow = async (noteId: string) => {
    if (stopped) return
    // Every note that opens comes through here, and most are not external:
    // the file is asked for first, and answers null for those at once.
    const file = await externalFiles.readNoteFile(noteId)
    // Not an external note, or its file is gone or unreadable: nothing to
    // compare with, and a missing file is no reason to touch the note.
    if (!file || stopped) return
    const baselineRow = await notes.getFromDiskBaseline({ id: noteId })
    // In the form the note's text is stored in (main's saveNote applies the
    // same function), or a file holding anything the note cannot hold would
    // never compare equal to the note it became.
    const disk = sanitizeDocumentText(file.content)
    const baseline = baselineRow ? sanitizeDocumentText(baselineRow.content) : null
    const liveBefore = noteDocuments.read(noteId)
    if (liveBefore === null) return
    if (reconcileExternalFile(baseline, disk, liveBefore) === 'unchanged') return

    // The file's text is recorded before anything is saved against it: a
    // save decides whether the note is clean by comparing with the newest
    // from-disk snapshot, so the snapshot has to be there first.
    await notes.saveNoteSnapshot({
      id: noteId,
      content: disk,
      isManual: true,
      isFromDisk: true,
      timestamp: new Date(file.modifiedAtMs).toISOString(),
    })
    onBaseline(noteId, disk)

    // Decided again on the text as it is NOW: the reader may have typed
    // while the snapshot was written, which makes a quiet adoption a
    // conflict. Against the OLD baseline, which is what "edited" means here.
    const live = noteDocuments.read(noteId)
    if (live === null) return
    const outcome = reconcileExternalFile(baseline, disk, live)
    if (outcome === 'adopt') {
      // Through the document, so every slot showing the note follows and
      // the write is the store's (it lands clean against the new baseline).
      noteDocuments.change(noteId, () => disk)
      onConflict(noteId, false)
    } else if (outcome === 'inSync') {
      const summary = await notes.updateExternalNoteState({ id: noteId, hasUnsavedChanges: false, syncMode: true })
      onSummary(summary, disk)
      onConflict(noteId, false)
    } else if (outcome === 'conflict') {
      // The note keeps its text; written again so it is judged against the
      // file's new version, which marks it unsaved.
      await noteDocuments.resave(noteId)
      onConflict(noteId, true)
    }
  }

  const syncOpenNotes = () => {
    if (stopped) return
    const now = new Set(noteDocuments.openNoteIds())
    const opened = [...now].filter((noteId) => !open.has(noteId))
    const changed = opened.length > 0 || [...open].some((noteId) => !now.has(noteId))
    open = now
    if (!changed) return
    // The main process ignores the ids of notes that are not external.
    void externalFiles.watchNoteFiles([...now]).catch((error) => {
      console.error('[external-files] failed to update the watched files', { error })
    })
    for (const noteId of opened) void reconcile(noteId)
  }

  const unsubscribeOpen = noteDocuments.subscribeOpenNotes(syncOpenNotes)
  const unsubscribeChanged = externalFiles.onNoteFileChanged((noteId) => {
    if (open.has(noteId)) void reconcile(noteId)
  })
  syncOpenNotes()

  return () => {
    stopped = true
    unsubscribeOpen()
    unsubscribeChanged()
    void externalFiles.watchNoteFiles([]).catch(() => {})
  }
}
