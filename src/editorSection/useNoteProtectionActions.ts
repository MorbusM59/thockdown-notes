import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, MutableRefObject } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import { isArchivedNote, isChapterOnlyNote, isDeletedNote, isExternalNote, isSameNoteSummary } from '../shared/noteLifecycle'
import { applyProtectedTagDestination } from '../shared/protectedTagActions'
import { normalizeInternalText } from '../editor/TextPolicy'
import { armHold, HOLD_CONFIRM_MS } from '../shared/holdTiming'

// A right-press on a note, or on the trash-view button, that means "this
// one" rather than the ordinary click -- the app's CONFIRM threshold
// (`shared/holdTiming.ts`), which also announces the completion in the
// cursor. Was 200ms of its own.
const NOTE_RIGHT_CLICK_HOLD_MS = HOLD_CONFIRM_MS

type NotePrimedAction = 'archive' | 'deletion'
type ProtectedQuickReleaseAction = 'remove-archived' | 'remove-deleted' | null
type SidebarModeForRemoval = 'date' | 'trash' | 'category' | 'archive' | 'find' | 'options'

export interface UseNoteProtectionActionsOptions {
  notes: NoteSummary[]
  activeNoteId: string | null
  /** The displayed note's text, read when needed -- see useDisplayedNoteText.ts. */
  readEditorText: () => string
  setNotes: (updater: (previous: NoteSummary[]) => NoteSummary[]) => void
  setActiveNoteId: (noteId: string | null) => void
  /** useDisplayedNoteText's writer. */
  commitEditorText: (text?: string) => void
  activateNote: (noteId: string, overrideCursorPos?: number) => Promise<void>
  flushPendingSaveNow: () => Promise<void>
  cancelPendingSave: () => void
  persistenceReady: boolean
  refreshNotes: (preferredId?: string | null) => Promise<string | null>
  noteTransitionLockRef: MutableRefObject<boolean>
  sidebarMode: SidebarModeForRemoval
  activeNoteExternalPathRef: MutableRefObject<string | null>
  externalNoteOriginalTextByIdRef: MutableRefObject<Map<string, string>>
  /** Called once a note is *permanently* removed from the DB (not archived/trashed) -- lets EditorSection.tsx evict any per-note-id caches (edit-mode restore snapshot, etc.) that would otherwise hold onto that id forever. */
  onNotePermanentlyDeleted?: (noteId: string) => void
  /** The chapter-aware "menu identity" note currently open in this section -- see useNoteChapters.ts's own doc comment. Used only to know whether a just-restored chapter's parent is the family currently on screen, so its chapter bar can be refreshed. */
  menuIdentityNoteId: string | null
  /** useNoteChapters.ts's own re-fetch -- called after restoring a deleted chapter whose parent is menuIdentityNoteId, so the chapter bar picks up the reattached chapter without waiting for an unrelated refresh. */
  refreshChapters: () => Promise<void>
}

/**
 * Archive/delete protection for sidebar note-list items -- the arm-and-hold
 * right-click gesture (with quick-release for already-archived/deleted
 * notes), the Empty Trash button's own arm-and-hold, and the underlying
 * tag-mutation + external-file-save actions they trigger. Extracted
 * verbatim from App.tsx with zero behavior change.
 */
/**
 * What a right press on a note row means -- the ONE statement of it, read
 * both by the row (to declare whether the gesture does anything at all, see
 * `shared/pressTracking.ts`) and by the handler below (to decide what to do).
 *
 * `hasOwnActionButtons` is the whole reason this takes an argument. The flat
 * note rows (Date, Find, Trash) carry archive and trash BUTTONS; the tree
 * cards (Category, Archive) do not, because there is no room for them. A
 * right-press-hold that archives or deletes is therefore a duplicate control
 * on one and the only control on the other -- and the duplicate is worse than
 * redundant: it has no visible affordance, so a stray right-click on a row
 * that already offers buttons could file a note away with nothing to say it
 * had happened.
 *
 * Restoring is not in that bargain and stays everywhere: no view renders a
 * restore BUTTON, so the quick right-click is the only way back out of Trash
 * or the Archive.
 */
export type NoteRightPressAction = 'arm-removal' | 'restore'

export function noteRightPressAction(
  note: NoteSummary | undefined,
  hasOwnActionButtons: boolean,
): NoteRightPressAction | null {
  if (!note || isExternalNote(note)) return null

  const isNoteDeleted = isDeletedNote(note)
  const isNoteArchived = isArchivedNote(note)
  // Chapters have no tag life of their own -- archiving/deleting only makes
  // sense on their parent note (see the tag-bar identity comment in
  // useSectionTabs.ts). The exception is a chapter already sitting detached
  // (Trash, or an Archive-tree fold-out row): it needs the same quick
  // right-click restore a deleted/archived note gets, so only block chapters
  // that are not currently protected either way. A plain, unprotected chapter
  // can still surface here via search results.
  if (isChapterOnlyNote(note) && !isNoteDeleted && !isNoteArchived) return null

  if (isNoteDeleted || isNoteArchived) return 'restore'
  return hasOwnActionButtons ? null : 'arm-removal'
}

export function useNoteProtectionActions({
  notes,
  activeNoteId,
  readEditorText,
  setNotes,
  setActiveNoteId,
  commitEditorText,
  activateNote,
  flushPendingSaveNow,
  cancelPendingSave,
  persistenceReady,
  refreshNotes,
  noteTransitionLockRef,
  sidebarMode,
  activeNoteExternalPathRef,
  externalNoteOriginalTextByIdRef,
  onNotePermanentlyDeleted,
  menuIdentityNoteId,
  refreshChapters,
}: UseNoteProtectionActionsOptions) {
  const [primedNoteActionState, setPrimedNoteActionState] = useState<{ noteId: string; action: NotePrimedAction } | null>(null)
  const noteArmTimerRef = useRef<{ noteId: string; button: 0 | 2; cancelHold: () => void; quickReleaseAction: ProtectedQuickReleaseAction | null } | null>(null)
  const [isTrashViewDeletePrimed, setIsTrashViewDeletePrimed] = useState(false)
  const trashButtonArmTimerRef = useRef<(() => void) | null>(null)

  const primedNoteActionById = useMemo(() => {
    if (!primedNoteActionState) {
      return new Map<string, NotePrimedAction>()
    }

    return new Map<string, NotePrimedAction>([[primedNoteActionState.noteId, primedNoteActionState.action]])
  }, [primedNoteActionState])

  const clearNoteArmTimer = useCallback(() => {
    if (!noteArmTimerRef.current) return
    noteArmTimerRef.current.cancelHold()
    noteArmTimerRef.current = null
  }, [])

  const clearTrashButtonArmTimer = useCallback(() => {
    if (trashButtonArmTimerRef.current === null) return
    trashButtonArmTimerRef.current()
    trashButtonArmTimerRef.current = null
  }, [])

  const applyProtectedNoteDestination = useCallback(async (noteId: string, destination: 'archived' | 'deleted') => {
    const summary = notes.find((note) => note.id === noteId)
    await applyProtectedTagDestination(noteId, summary?.tags ?? [], destination)

    // Trashing a parent un-archives any of its own archived chapters: an
    // archived chapter is only ever reachable through its parent's Archive
    // fold-out row (App.tsx's archivedChaptersByParentId), and a trashed
    // parent has no such row, so leaving them archived would strand them
    // out of sight until the parent came back. Reattaching them instead
    // (clear the tag, restoreDetachedChapter to their remembered position)
    // folds them back into the parent's own chapter family, so they travel
    // with it -- into Trash now, and back out again if it's restored.
    if (destination === 'deleted' && summary && !isChapterOnlyNote(summary) && window.thockdownNotes && window.thockdownChapters) {
      const archivedChapters = notes.filter((note) => (
        note.chapterOnly && note.detachedChapterParentId === noteId && isArchivedNote(note)
      ))
      for (const chapter of archivedChapters) {
        await window.thockdownNotes.removeTagFromNote({ id: chapter.id, tagName: 'archived' })
        await window.thockdownChapters.restoreDetachedChapter(chapter.id)
      }
      if (archivedChapters.length > 0 && noteId === menuIdentityNoteId) {
        await refreshChapters()
      }
    }
  }, [notes, menuIdentityNoteId, refreshChapters])

  const saveExternalNoteToFile = useCallback(async (noteId: string) => {
    if (!window.thockdownNotes || !window.thockdownExternalFiles) return

    const summary = notes.find((note) => note.id === noteId)
    let externalPath = summary?.externalPath ?? activeNoteExternalPathRef.current ?? null
    if (!externalPath) {
      console.warn('[external-note] saveExternalNoteToFile missing externalPath on summary, attempting loadNote fallback', { noteId, summary })
      try {
        const loadedNote = await window.thockdownNotes.loadNote({ id: noteId })
        externalPath = loadedNote.externalPath ?? null
        console.debug('[external-note] saveExternalNoteToFile loaded note path fallback', { noteId, loadedExternalPath: externalPath, loadedNote })
        if (externalPath) {
          activeNoteExternalPathRef.current = externalPath
        }
        if (externalPath && summary) {
          setNotes((previous) => {
            const index = previous.findIndex((note) => note.id === noteId)
            if (index < 0) return previous
            const next = [...previous]
            next[index] = { ...next[index], externalPath }
            return next
          })
        }
      } catch (error) {
        console.error('[external-note] saveExternalNoteToFile fallback loadNote failed', { noteId, error })
      }
    }

    if (!externalPath) {
      console.error('[external-note] saveExternalNoteToFile missing externalPath', { noteId, noteSummary: summary })
      return
    }

    const currentText = readEditorText()

    /**
     * Whether the reader has typed since this save took its snapshot above.
     *
     * `currentText` is a photograph of the document taken before a long chain
     * of awaits: a SHA-256 of the whole note, a file write with a read-back
     * verification, an IPC round trip, and a database save. On a large note
     * that chain runs for hundreds of milliseconds or more, and the reader is
     * still typing through all of it.
     *
     * Every write-back below used to publish that photograph unconditionally
     * -- into the section's text store, and so, by way of
     * CM6Editor's hydration effect, into the LIVE DOCUMENT. Anything typed
     * during the save was deleted by it. That is the reported bug: hold Enter
     * on a large external note and the blank lines are taken back off you, in
     * one case 54 of them at once, sometimes permanently.
     *
     * So the rule is: this save may report what it WROTE, but it may never
     * roll the editor back to it. The bytes on disk are still correct -- they
     * are `currentText` -- the note simply has unsaved changes again the
     * instant the reader types during a save, which is exactly true.
     */
    const hasLiveTextMovedOn = (): boolean => (
      readEditorText() !== currentText
    )

    console.debug('[external-note] explicit save path starting', {
      noteId,
      externalPath,
      textLength: currentText.length,
      activeNoteId,
    })

    // ---- Reconcile with the file BEFORE overwriting it -------------------
    //
    // The note's baseline is the last recorded state of the file. If what is
    // on disk now differs from it, somebody else edited the file since this
    // app last looked, and the write below is about to destroy that. So it
    // goes onto the timeline first, stamped with the FILE's own modified time
    // and marked as coming from disk -- a heavier mark the reader can find and
    // restore from. Preserving it costs one read; not preserving it costs
    // somebody else's work.
    //
    // Deliberately before the write and not after: a check that runs after the
    // overwrite can only ever confirm its own handiwork.
    const baselineText = externalNoteOriginalTextByIdRef.current.get(noteId)
    try {
      const diskBefore = await window.thockdownExternalFiles.readFileSnapshot(externalPath)
      if (diskBefore) {
        const diskBeforeNormalized = normalizeInternalText(diskBefore.content)
        if (baselineText !== undefined && diskBeforeNormalized !== baselineText) {
          await window.thockdownNotes.saveNoteSnapshot({
            id: noteId,
            content: diskBeforeNormalized,
            isManual: true,
            isFromDisk: true,
            timestamp: new Date(diskBefore.modifiedAtMs).toISOString(),
          })
          console.warn('[external-note] file changed on disk since this note last saw it -- preserved on the timeline before overwriting', {
            noteId,
            externalPath,
            diskLength: diskBeforeNormalized.length,
            baselineLength: baselineText.length,
            modifiedAtMs: diskBefore.modifiedAtMs,
          })
        }
      }
    } catch (error) {
      // A failed reconciliation must not block the save -- the reader's own
      // content is the thing that must not be lost here.
      console.error('[external-note] pre-write disk reconciliation failed', { noteId, externalPath, error })
    }

    let diskSanityText: string | null = null
    // The file's own modified time as of the post-write read, so the baseline
    // snapshot recorded below is stamped with when the FILE changed rather
    // than when this code happened to run.
    let diskSanityModifiedAtMs: number | null = null
    let writeSucceeded = false
    let writeAttemptedViaNoteApi = false
    let writeAttemptedViaExternalApi = false

    let syncedSummary: NoteSummary | null = null
    try {
      writeAttemptedViaNoteApi = true
      writeSucceeded = await window.thockdownNotes.syncExternalNoteToFile({ id: noteId, content: currentText })
      console.debug('[external-note] syncExternalNoteToFile result', { noteId, externalPath, writeSucceeded })
      if (writeSucceeded) {
        syncedSummary = await window.thockdownNotes.updateExternalNoteState({ id: noteId, hasUnsavedChanges: false, syncMode: true })
      }
    } catch (error) {
      console.error('[external-note] syncExternalNoteToFile exception', { noteId, externalPath, error })
    }

    if (!writeSucceeded) {
      try {
        writeAttemptedViaExternalApi = true
        writeSucceeded = await window.thockdownExternalFiles.writeFileContent(externalPath, currentText)
        console.debug('[external-note] writeFileContent fallback result', { noteId, externalPath, writeSucceeded })
        if (writeSucceeded) {
          syncedSummary = await window.thockdownNotes.updateExternalNoteState({ id: noteId, hasUnsavedChanges: false, syncMode: true })
        }
      } catch (error) {
        console.error('[external-note] writeFileContent fallback exception', { noteId, externalPath, error })
      }
    }

    if (!writeSucceeded) {
      console.error('[external-note] external save failed, no write method succeeded', {
        noteId,
        externalPath,
        writeAttemptedViaNoteApi,
        writeAttemptedViaExternalApi,
      })
    }

    // Persisted into the database only AFTER the new baseline is recorded
    // below: the main process's saveNote decides whether an external note
    // is clean by comparing against its latest from-disk snapshot, so run
    // before that snapshot it compares against the file as it was BEFORE
    // this save and stores the note as unsaved -- which is what every
    // restart then showed, for a file the disk already matched.
    const persistSavedText = async () => {
      if (!writeSucceeded || !window.thockdownNotes) return
      // Nothing is written back into the editor's text, here or below. Only
      // two cases exist: nothing was typed since the snapshot, and the text
      // already IS `currentText`; or something was, and writing it would walk
      // the text BACKWARDS, taking the editor (through its hydration path)
      // with it. The first write is a no-op and the second is the bug above.
      try {
        const savedSummary = await window.thockdownNotes.saveNote({ id: noteId, text: currentText })
        console.debug('[external-note] saveExternalNoteToFile persisted temp note text into DB', { noteId, externalPath, savedSummary })

        const nextSummary = syncedSummary ?? savedSummary
        // Typing during the save means the note genuinely HAS unsaved changes
        // again -- what went to disk is already one edit behind.
        const normalizedNextSummary = {
          ...nextSummary,
          hasUnsavedChanges: hasLiveTextMovedOn(),
        }

        setNotes((previous) => {
          const index = previous.findIndex((note) => note.id === normalizedNextSummary.id)
          if (index < 0) return previous

          const existing = previous[index]
          if (isSameNoteSummary(existing, normalizedNextSummary)) {
            return previous
          }

          const next = [...previous]
          next[index] = normalizedNextSummary
          return next
        })

      } catch (error) {
        console.error('[external-note] saveExternalNoteToFile failed to persist temp note in DB', { noteId, externalPath, error })
      }
    }

    try {
      const diskAfter = await window.thockdownExternalFiles.readFileSnapshot(externalPath)
      console.debug('[external-note] read file after save', { noteId, externalPath, diskContentLength: diskAfter?.content.length ?? null, diskIsNull: diskAfter === null })
      if (diskAfter !== null) {
        diskSanityText = diskAfter.content
        diskSanityModifiedAtMs = diskAfter.modifiedAtMs
      } else {
        console.error('[external-note] failed to read disk content for sanity snapshot', { noteId, externalPath })
      }
    } catch (error) {
      console.error('[external-note] failed to read disk content for sanity snapshot', { noteId, externalPath, error })
    }

    if (diskSanityText === null) {
      await persistSavedText()
      return
    }

    const diskSanityNormalized = normalizeInternalText(diskSanityText)
    const isDiskEqual = currentText === diskSanityNormalized

    try {
      if (isDiskEqual) {
        // The file now holds exactly what was written, so THIS is the note's
        // new baseline -- recorded as a from-disk snapshot carrying the file's
        // own modified time, which is what every later "has it changed since
        // it came off disk" question is answered against.
        await window.thockdownNotes.saveNoteSnapshot({
          id: noteId,
          content: currentText,
          isManual: true,
          isFromDisk: true,
          timestamp: diskSanityModifiedAtMs !== null
            ? new Date(diskSanityModifiedAtMs).toISOString()
            : undefined,
        })
        externalNoteOriginalTextByIdRef.current.set(noteId, currentText)
        setNotes((previous) => {
          const index = previous.findIndex((note) => note.id === noteId)
          if (index < 0) return previous

          const next = [...previous]
          next[index] = {
            ...next[index],
            updatedAtMs: Date.now(),
          }
          return next
        })
      } else {
        // The write did not land what was asked of it -- the file holds
        // something else entirely. Record what is actually there as the
        // baseline, because that is the truth the next save must reconcile
        // against, and say so loudly.
        await window.thockdownNotes.saveNoteSnapshot({
          id: noteId,
          content: diskSanityNormalized,
          isManual: true,
          isFromDisk: true,
          timestamp: diskSanityModifiedAtMs !== null
            ? new Date(diskSanityModifiedAtMs).toISOString()
            : undefined,
        })
        externalNoteOriginalTextByIdRef.current.set(noteId, diskSanityNormalized)
        console.error('[external-note] disk sanity mismatch after save', { noteId, writeSucceeded })
      }
    } catch (error) {
      console.error('[external-note] failed to persist external note snapshots', { noteId, error })
    }
    await persistSavedText()
  }, [
    activeNoteId,
    notes,
    activeNoteExternalPathRef,
    externalNoteOriginalTextByIdRef,
    readEditorText,
    setNotes,
  ])

  const executePrimedNoteAction = useCallback(async (noteId: string, action: NotePrimedAction) => {
    if (!window.thockdownNotes) return
    if (!persistenceReady) return
    if (noteTransitionLockRef.current) return

    const summary = notes.find((note) => note.id === noteId)
    const isCurrentlyDeleted = summary ? isDeletedNote(summary) : false

    noteTransitionLockRef.current = true
    try {
      await flushPendingSaveNow()

      if (action === 'deletion' && isCurrentlyDeleted) {
        await window.thockdownNotes.deleteNote({ id: noteId })
        onNotePermanentlyDeleted?.(noteId)
        await refreshNotes(activeNoteId === noteId ? null : activeNoteId)

        if (activeNoteId === noteId) {
          setActiveNoteId(null)
          commitEditorText('')
        }

        return
      }

      if (action === 'archive') {
        await applyProtectedNoteDestination(noteId, 'archived')
      } else {
        await applyProtectedNoteDestination(noteId, 'deleted')
      }

      await refreshNotes(activeNoteId ?? noteId)
      if (activeNoteId === noteId) {
        setActiveNoteId(null)
        commitEditorText('')
      }
    } catch (error) {
      console.error('Failed to apply note action', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [activeNoteId, applyProtectedNoteDestination, flushPendingSaveNow, notes, persistenceReady, refreshNotes, noteTransitionLockRef, setActiveNoteId, commitEditorText, onNotePermanentlyDeleted])

  const applyQuickProtectedRightClickAction = useCallback(async (noteId: string, action: Exclude<ProtectedQuickReleaseAction, null>) => {
    if (!window.thockdownNotes) return
    if (!persistenceReady) return
    if (noteTransitionLockRef.current) return

    noteTransitionLockRef.current = true
    try {
      await flushPendingSaveNow()

      await window.thockdownNotes.removeTagFromNote({ id: noteId, tagName: action === 'remove-archived' ? 'archived' : 'deleted' })

      // Whichever protected tag was just cleared, a chapter carrying it was
      // detached (see detachChapter) -- reattach it at its remembered
      // position, and refresh the chapter bar if its parent is the family
      // currently on screen.
      const summary = notes.find((note) => note.id === noteId)
      const isChapterOnly = summary ? isChapterOnlyNote(summary) : false
      if (isChapterOnly && window.thockdownChapters) {
        const restored = await window.thockdownChapters.restoreDetachedChapter(noteId)
        if (restored && restored.parentNoteId === menuIdentityNoteId) {
          await refreshChapters()
        }
      }

      await refreshNotes(activeNoteId ?? noteId)
      if (activeNoteId === noteId) {
        await activateNote(noteId)
      }
    } catch (error) {
      console.error('Failed to apply protected right-click action', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [activateNote, activeNoteId, flushPendingSaveNow, persistenceReady, refreshNotes, noteTransitionLockRef, notes, menuIdentityNoteId, refreshChapters])

  const closeExternalNoteWithoutSaving = useCallback(async (noteId: string) => {
    if (!window.thockdownNotes) return

    cancelPendingSave()

    clearNoteArmTimer()

    externalNoteOriginalTextByIdRef.current.delete(noteId)

    try {
      await window.thockdownNotes.deleteNote({ id: noteId })
      onNotePermanentlyDeleted?.(noteId)
      setNotes((previous) => previous.filter((note) => note.id !== noteId))

      if (activeNoteId === noteId) {
        setActiveNoteId(null)
        commitEditorText('')
      }
    } catch (error) {
      console.error('Failed to delete external temp note', error)
    }
  }, [activeNoteId, cancelPendingSave, clearNoteArmTimer, externalNoteOriginalTextByIdRef, setNotes, setActiveNoteId, commitEditorText, onNotePermanentlyDeleted])

  const handleNoteRightPressStart = useCallback((
    noteId: string,
    event: MouseEvent<HTMLDivElement>,
    hasOwnActionButtons: boolean,
  ) => {
    event.preventDefault()

    const summary = notes.find((note) => note.id === noteId)
    const action = noteRightPressAction(summary, hasOwnActionButtons)
    if (!action) return

    clearNoteArmTimer()
    if (action === 'restore') {
      setPrimedNoteActionState(null)
    } else {
      setPrimedNoteActionState({ noteId, action: 'archive' })
    }

    const quickReleaseAction: ProtectedQuickReleaseAction = action === 'restore'
      ? (summary && isDeletedNote(summary) ? 'remove-deleted' : 'remove-archived')
      : null

    // No hold at all in trash mode -- the gesture means something else
    // there, so there is nothing to arm and nothing to acknowledge.
    let cancelHold: () => void = () => {}
    if (sidebarMode !== 'trash') {
      cancelHold = armHold(() => {
        setPrimedNoteActionState((previous) => {
          if (quickReleaseAction) {
            return {
              noteId,
              action: 'deletion',
            }
          }

          if (!previous || previous.noteId !== noteId) {
            return previous
          }

          return {
            noteId,
            action: 'deletion',
          }
        })

        if (noteArmTimerRef.current?.noteId === noteId) {
          noteArmTimerRef.current = null
        }
      }, NOTE_RIGHT_CLICK_HOLD_MS)
    }

    noteArmTimerRef.current = { noteId, button: 2, cancelHold, quickReleaseAction }
  }, [clearNoteArmTimer, notes, sidebarMode])


  const handleNoteRightPressEnd = useCallback((noteId: string, event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()

    const pendingArm = noteArmTimerRef.current
    if (!pendingArm || pendingArm.noteId !== noteId) {
      return
    }

    const quickReleaseAction = pendingArm.quickReleaseAction
    clearNoteArmTimer()

    if (quickReleaseAction) {
      setPrimedNoteActionState(null)
      void applyQuickProtectedRightClickAction(noteId, quickReleaseAction)
    }
  }, [applyQuickProtectedRightClickAction, clearNoteArmTimer])

  const handleNoteMouseLeave = useCallback((noteId: string) => {
    if (primedNoteActionState?.noteId === noteId) {
      setPrimedNoteActionState(null)
    }
    clearNoteArmTimer()
  }, [primedNoteActionState, clearNoteArmTimer])

  const handlePrimedNoteLeftClick = useCallback((noteId: string) => {
    const primed = primedNoteActionState
    if (!primed || primed.noteId !== noteId) {
      return
    }

    clearNoteArmTimer()
    setPrimedNoteActionState(null)
    void executePrimedNoteAction(noteId, primed.action)
  }, [primedNoteActionState, clearNoteArmTimer, executePrimedNoteAction])

  const handleSaveButtonClick = useCallback(async (noteId: string) => {
    if (!isExternalNote(notes.find((note) => note.id === noteId)!)) {
      return
    }

    if (activeNoteId !== noteId) {
      await activateNote(noteId)
    }

    await saveExternalNoteToFile(noteId)
  }, [activateNote, activeNoteId, notes, saveExternalNoteToFile])

  const handleCloseButtonClick = useCallback((noteId: string) => {
    void closeExternalNoteWithoutSaving(noteId)
  }, [closeExternalNoteWithoutSaving])

  const handleArchiveClick = useCallback(async (noteId: string) => {
    if (!window.thockdownNotes || !persistenceReady) return
    if (noteTransitionLockRef.current) return

    noteTransitionLockRef.current = true
    try {
      await flushPendingSaveNow()
      await applyProtectedNoteDestination(noteId, 'archived')
      await refreshNotes(activeNoteId ?? noteId)
      if (activeNoteId === noteId) {
        setActiveNoteId(null)
        commitEditorText('')
      }
    } catch (error) {
      console.error('Failed to archive note', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [activeNoteId, applyProtectedNoteDestination, flushPendingSaveNow, persistenceReady, refreshNotes, noteTransitionLockRef, setActiveNoteId, commitEditorText])

  const handleTrashClick = useCallback(async (noteId: string) => {
    if (!window.thockdownNotes || !persistenceReady) return
    if (noteTransitionLockRef.current) return

    const summary = notes.find((note) => note.id === noteId)
    const isCurrentlyDeleted = summary ? isDeletedNote(summary) : false

    noteTransitionLockRef.current = true
    try {
      await flushPendingSaveNow()

      if (isCurrentlyDeleted) {
        await window.thockdownNotes.deleteNote({ id: noteId })
        onNotePermanentlyDeleted?.(noteId)
      } else {
        await applyProtectedNoteDestination(noteId, 'deleted')
      }

      await refreshNotes(activeNoteId ?? noteId)
      if (activeNoteId === noteId) {
        setActiveNoteId(null)
        commitEditorText('')
      }
    } catch (error) {
      console.error('Failed to trash note', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [activeNoteId, applyProtectedNoteDestination, flushPendingSaveNow, notes, persistenceReady, refreshNotes, noteTransitionLockRef, setActiveNoteId, commitEditorText, onNotePermanentlyDeleted])

  const purgeDeletedNotesPermanently = useCallback(async () => {
    if (!window.thockdownNotes) return
    if (!persistenceReady) return
    if (noteTransitionLockRef.current) return

    const deletedNoteIds = notes
      .filter((note) => isDeletedNote(note))
      .map((note) => note.id)

    if (deletedNoteIds.length === 0) {
      return
    }

    noteTransitionLockRef.current = true
    try {
      await flushPendingSaveNow()

      for (const noteId of deletedNoteIds) {
        await window.thockdownNotes.deleteNote({ id: noteId })
        onNotePermanentlyDeleted?.(noteId)
      }

      const activeDeleted = activeNoteId ? deletedNoteIds.includes(activeNoteId) : false
      await refreshNotes(activeDeleted ? null : activeNoteId)

      if (activeDeleted) {
        setActiveNoteId(null)
        commitEditorText('')
      }
    } catch (error) {
      console.error('Failed to permanently purge deleted notes', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [activeNoteId, flushPendingSaveNow, notes, persistenceReady, refreshNotes, noteTransitionLockRef, setActiveNoteId, commitEditorText, onNotePermanentlyDeleted])

  const handleTrashViewButtonMouseDown = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 2) return
    event.preventDefault()
    event.stopPropagation()
    clearTrashButtonArmTimer()
    setIsTrashViewDeletePrimed(false)

    trashButtonArmTimerRef.current = armHold(() => {
      setIsTrashViewDeletePrimed(true)
      trashButtonArmTimerRef.current = null
    }, NOTE_RIGHT_CLICK_HOLD_MS)
  }, [clearTrashButtonArmTimer])

  const handleTrashViewButtonMouseUp = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 2) return
    event.preventDefault()
    event.stopPropagation()

    // Quick release before timeout should not arm the trash purge action.
    if (trashButtonArmTimerRef.current !== null) {
      clearTrashButtonArmTimer()
      setIsTrashViewDeletePrimed(false)
    }
  }, [clearTrashButtonArmTimer])

  const handleTrashViewButtonContextMenu = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  useEffect(() => {
    if (!primedNoteActionState) return
    if (!notes.some((note) => note.id === primedNoteActionState.noteId)) {
      clearNoteArmTimer()
      setPrimedNoteActionState(null)
    }
  }, [primedNoteActionState, clearNoteArmTimer, notes])

  useEffect(() => {
    if (!isTrashViewDeletePrimed) return
    if (!notes.some((note) => isDeletedNote(note))) {
      setIsTrashViewDeletePrimed(false)
    }
  }, [isTrashViewDeletePrimed, notes])

  useEffect(() => {
    return () => {
      clearNoteArmTimer()
      clearTrashButtonArmTimer()
    }
  }, [clearNoteArmTimer, clearTrashButtonArmTimer])

  return {
    primedNoteActionById,
    isTrashViewDeletePrimed,
    setIsTrashViewDeletePrimed,
    clearTrashButtonArmTimer,
    handleNoteRightPressStart,
    handleNoteRightPressEnd,
    handleNoteMouseLeave,
    handlePrimedNoteLeftClick,
    handleSaveButtonClick,
    handleCloseButtonClick,
    handleArchiveClick,
    handleTrashClick,
    purgeDeletedNotesPermanently,
    handleTrashViewButtonMouseDown,
    handleTrashViewButtonMouseUp,
    handleTrashViewButtonContextMenu,
  }
}

export type UseNoteProtectionActionsResult = ReturnType<typeof useNoteProtectionActions>
