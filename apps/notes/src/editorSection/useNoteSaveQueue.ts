import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import { isExternalNote } from '../shared/noteLifecycle'
import { withSavedNote } from '../shared/noteContentStore'
import type { PreviewBlockSplitCache } from '../editor/PreviewBlockSplit'
import { buildPersistedBlockMap } from '../editor/persistedBlockMap'
import type { NoteDocumentStore } from './noteDocumentStore'

export interface UseNoteSaveQueueOptions {
  sectionId: string
  /** The open notes' documents (noteDocumentStore.ts), which own the debounce and the order of writes. */
  noteDocuments: NoteDocumentStore
  activeNoteId: string | null
  persistenceReady: boolean
  /** The full shared notes list, mirrored into a ref for the same reason the rest of the app reads it this way -- avoids re-subscribing the debounce timer callback to `notes` itself. */
  notesRef: MutableRefObject<NoteSummary[]>
  /** Warm-start cache from useEditorSectionMount's background preview-block parse. Used to persist the structural split alongside the note text so the next startup can warm-start. */
  previewBlockSplitCacheRef: MutableRefObject<PreviewBlockSplitCache | null>
  setNotes: Dispatch<SetStateAction<NoteSummary[]>>
  /**
   * Fires after every successful save with the saved note's id. The chapter
   * bar's own `chapters` state (useNoteChapters.ts) has no other way to
   * learn about the auto-Open-Items chapter being lazily created/patched/
   * torn down in the background by this same save (see
   * noteLifecycleService.ts's saveNote checklist-diff hook) -- unlike the
   * auto-TOC chapter, whose creation/removal is driven by a reactive effect
   * already watching `chapters` state directly. Optional: only EditorSection.tsx
   * wires this today, not e.g. tests instantiating this hook standalone.
   * The note's OTHER views learn of the save from the document's `saved`
   * event instead.
   */
  onSaveCompleted?: (noteId: string) => void
}

export interface UseNoteSaveQueueResult {
  /**
   * Debounces a write of the active note. What is written is the note's
   * document as it is when the write starts (noteDocumentStore.ts, rule 2),
   * so no text is passed. `cursorPos`, when provided, piggybacks onto the
   * write (see databaseService.ts's upsertNoteContent doc comment) -- the
   * value from the latest call before the write starts is the one used.
   * Scroll position is never piggybacked here -- see
   * saveNoteUiState/docs/editor-contract.md.
   */
  queueSave: (cursorPos?: number | null) => void
  /** Starts any debounced write of the active note now and resolves once every write of it has finished -- used before operations that need the disk state current (tag mutations, note switches, Time Machine navigation). */
  flushPendingSaveNow: () => Promise<void>
  /** Drops a debounced write of the active note that has not started -- used when deliberately abandoning unsaved changes (closing an external note without saving) or tearing down. */
  cancelPendingSave: () => void
}

/**
 * One section's way to ask for its note to be written. The debounce and the
 * writes themselves belong to the note's document, shared by every section
 * showing it; what this hook adds is how THIS section writes: the cursor
 * position, the section's own preview-block split, and the notes list update.
 */
export function useNoteSaveQueue(options: UseNoteSaveQueueOptions): UseNoteSaveQueueResult {
  const { sectionId, noteDocuments, activeNoteId, persistenceReady, notesRef, previewBlockSplitCacheRef, setNotes, onSaveCompleted } = options

  const writerFor = useCallback((noteId: string, cursorPos: number | null) => async (text: string) => {
    if (!window.thockdownNotes) return
    const noteSummary = notesRef.current.find((note) => note.id === noteId)
    const isExternal = noteSummary ? isExternalNote(noteSummary) : false
    // Already canonical, not re-normalized here: a document's text is the
    // editor's own text, which CanonicalTextFilter keeps canonical at every
    // ingress, or programmatic text normalized before it is published. A pass
    // here cost the whole document on every save (~10 ms on a 2 MB note
    // since the single-cell rule joined the canonical form), and the main
    // process applies the same rule on save regardless (sanitizeDocumentText).
    const previewBlockCache = await buildPersistedBlockMap(previewBlockSplitCacheRef.current, text)

    if (typeof window !== 'undefined' && window.localStorage.getItem('thockdown:debug-input-lag') === '1') {
      console.log('[preview-block-cache] piggybacking on saveNote', {
        noteId,
        textLength: text.length,
        hasCache: !!previewBlockCache,
        ranges: previewBlockCache?.ranges.length,
      })
    }

    const savedSummary = await window.thockdownNotes.saveNote({
      id: noteId,
      text,
      cursorPos,
      previewBlockCache,
    })

    if (isExternal) {
      await window.thockdownNotes.saveNoteSnapshot({ id: noteId, content: text, isManual: false })
    }

    // The saved text rides along into the note-content store: a save
    // returns no content (it is this text), and an unchanged summary still
    // has new content to record -- App's setNotes keeps the old list when
    // nothing but content changed.
    setNotes((previous) => withSavedNote(previous, savedSummary, text))

    onSaveCompleted?.(noteId)
  }, [notesRef, previewBlockSplitCacheRef, setNotes, onSaveCompleted])

  const queueSave = useCallback((cursorPos?: number | null) => {
    if (!persistenceReady || !activeNoteId) return
    // The store writes the note this section is a view of; the writer is
    // addressed to the active note. They are the same note except in the
    // instant of a switch, and then there is nothing of this section's to save.
    if (noteDocuments.boundNoteOf(sectionId) !== activeNoteId) return
    noteDocuments.scheduleSave(sectionId, writerFor(activeNoteId, cursorPos ?? null))
  }, [activeNoteId, noteDocuments, persistenceReady, sectionId, writerFor])

  const flushPendingSaveNow = useCallback(async () => {
    if (!activeNoteId) return
    await noteDocuments.flushSave(activeNoteId)
  }, [activeNoteId, noteDocuments])

  const cancelPendingSave = useCallback(() => {
    if (!activeNoteId) return
    noteDocuments.cancelSave(activeNoteId)
  }, [activeNoteId, noteDocuments])

  return { queueSave, flushPendingSaveNow, cancelPendingSave }
}
