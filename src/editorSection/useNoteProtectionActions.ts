import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, MutableRefObject } from 'react'
import type { NoteSummary } from '../shared/noteLifecycle'
import { isArchivedNote, isDeletedNote, isExternalNote, isSameNoteSummary } from '../shared/noteLifecycle'
import { normalizeTagName } from '../shared/tags'
import { normalizeInternalText } from '../editor/TextPolicy'

const NOTE_RIGHT_CLICK_HOLD_MS = 200

type NotePrimedAction = 'archive' | 'deletion'
type ProtectedQuickReleaseAction = 'remove-archived' | 'remove-deleted' | null
type SidebarModeForRemoval = 'date' | 'trash' | 'category' | 'archive' | 'find' | 'options'

type NoteTreeGroup = {
  secondary: Array<{
    tertiary: Array<{
      notes: NoteSummary[]
    }>
  }>
}

async function hashNormalizedText(text: string): Promise<string> {
  const normalized = normalizeInternalText(text)
  const encoder = new TextEncoder()
  const data = encoder.encode(normalized)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export interface UseNoteProtectionActionsOptions {
  notes: NoteSummary[]
  activeNoteId: string | null
  activeNoteText: string
  latestEditorTextRef: MutableRefObject<string>
  setNotes: (updater: (previous: NoteSummary[]) => NoteSummary[]) => void
  setActiveNoteId: (noteId: string | null) => void
  setActiveNoteText: (text: string) => void
  activateNote: (noteId: string, overrideCursorPos?: number) => Promise<void>
  flushPendingSaveNow: () => Promise<void>
  cancelPendingSave: () => void
  persistenceReady: boolean
  refreshNotes: (preferredId?: string | null) => Promise<string | null>
  noteTransitionLockRef: MutableRefObject<boolean>
  sidebarMode: SidebarModeForRemoval
  dateFilteredNotesRef: MutableRefObject<NoteSummary[]>
  trashFilteredNotesRef: MutableRefObject<NoteSummary[]>
  categoryTreeRef: MutableRefObject<NoteTreeGroup[]>
  archiveTreeRef: MutableRefObject<NoteTreeGroup[]>
  activeNoteExternalPathRef: MutableRefObject<string | null>
  externalNoteOriginalTextByIdRef: MutableRefObject<Map<string, string>>
  externalNoteOriginalHashByIdRef: MutableRefObject<Map<string, string>>
  currentExternalNoteHash: string | null
  setCurrentExternalNoteHash: (updater: string | null | ((current: string | null) => string | null)) => void
}

/**
 * Archive/delete protection for sidebar note-list items -- the arm-and-hold
 * right-click gesture (with quick-release for already-archived/deleted
 * notes), the Empty Trash button's own arm-and-hold, and the underlying
 * tag-mutation + external-file-save actions they trigger. Extracted
 * verbatim from App.tsx with zero behavior change.
 */
export function useNoteProtectionActions({
  notes,
  activeNoteId,
  activeNoteText,
  latestEditorTextRef,
  setNotes,
  setActiveNoteId,
  setActiveNoteText,
  activateNote,
  flushPendingSaveNow,
  cancelPendingSave,
  persistenceReady,
  refreshNotes,
  noteTransitionLockRef,
  sidebarMode,
  dateFilteredNotesRef,
  trashFilteredNotesRef,
  categoryTreeRef,
  archiveTreeRef,
  activeNoteExternalPathRef,
  externalNoteOriginalTextByIdRef,
  externalNoteOriginalHashByIdRef,
  currentExternalNoteHash,
  setCurrentExternalNoteHash,
}: UseNoteProtectionActionsOptions) {
  const [primedNoteActionState, setPrimedNoteActionState] = useState<{ noteId: string; action: NotePrimedAction } | null>(null)
  const noteArmTimerRef = useRef<{ noteId: string; button: 0 | 2; timeoutId: number; quickReleaseAction: ProtectedQuickReleaseAction | null } | null>(null)
  const [isTrashViewDeletePrimed, setIsTrashViewDeletePrimed] = useState(false)
  const trashButtonArmTimerRef = useRef<number | null>(null)

  const primedNoteActionById = useMemo(() => {
    if (!primedNoteActionState) {
      return new Map<string, NotePrimedAction>()
    }

    return new Map<string, NotePrimedAction>([[primedNoteActionState.noteId, primedNoteActionState.action]])
  }, [primedNoteActionState])

  const clearNoteArmTimer = useCallback(() => {
    if (!noteArmTimerRef.current) return
    window.clearTimeout(noteArmTimerRef.current.timeoutId)
    noteArmTimerRef.current = null
  }, [])

  const clearTrashButtonArmTimer = useCallback(() => {
    if (trashButtonArmTimerRef.current === null) return
    window.clearTimeout(trashButtonArmTimerRef.current)
    trashButtonArmTimerRef.current = null
  }, [])

  const applyProtectedNoteDestination = useCallback(async (noteId: string, destination: 'archived' | 'deleted') => {
    if (!window.thockdownNotes) return

    const summary = notes.find((note) => note.id === noteId)
    const existingTags = summary?.tags ?? []
    const opposite = destination === 'archived' ? 'deleted' : 'archived'

    const hasDestination = existingTags.some((tag) => normalizeTagName(tag) === destination)
    const hasOpposite = existingTags.some((tag) => normalizeTagName(tag) === opposite)

    if (hasOpposite) {
      await window.thockdownNotes.removeTagFromNote({ id: noteId, tagName: opposite })
    }

    if (!hasDestination) {
      await window.thockdownNotes.addTagToNote({
        id: noteId,
        tagName: destination,
        position: 0,
      })
    }

    const reordered = [
      destination,
      ...existingTags.filter((tag) => {
        const normalized = normalizeTagName(tag)
        return normalized !== destination && normalized !== opposite
      }),
    ]

    await window.thockdownNotes.reorderNoteTags({ id: noteId, tagNames: reordered })
  }, [notes])

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

    const currentText = normalizeInternalText(latestEditorTextRef.current || activeNoteText)
    const currentHash = await hashNormalizedText(currentText)

    console.debug('[external-note] explicit save path starting', {
      noteId,
      externalPath,
      textLength: currentText.length,
      hash: currentHash,
      activeNoteId,
    })

    let diskSanityText: string | null = null
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
    } else {
      latestEditorTextRef.current = currentText
      try {
        const savedSummary = await window.thockdownNotes.saveNote({ id: noteId, text: currentText })
        console.debug('[external-note] saveExternalNoteToFile persisted temp note text into DB', { noteId, externalPath, savedSummary })

        const nextSummary = syncedSummary ?? savedSummary
        const normalizedNextSummary = {
          ...nextSummary,
          hasUnsavedChanges: false,
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

        externalNoteOriginalHashByIdRef.current.set(noteId, currentHash)
        setCurrentExternalNoteHash(currentHash)
        if (activeNoteId === noteId) {
          setActiveNoteText(currentText)
        }
      } catch (error) {
        console.error('[external-note] saveExternalNoteToFile failed to persist temp note in DB', { noteId, externalPath, error })
      }
    }

    try {
      const diskContent = await window.thockdownExternalFiles.readFileContent(externalPath)
      console.debug('[external-note] readFileContent after save', { noteId, externalPath, diskContentLength: diskContent?.length ?? null, diskContentIsNull: diskContent === null })
      if (diskContent !== null) {
        diskSanityText = diskContent
      } else {
        console.error('[external-note] failed to read disk content for sanity snapshot', { noteId, externalPath })
      }
    } catch (error) {
      console.error('[external-note] failed to read disk content for sanity snapshot', { noteId, externalPath, error })
    }

    if (diskSanityText === null) {
      return
    }

    const diskSanityNormalized = normalizeInternalText(diskSanityText)
    const isDiskEqual = currentText === diskSanityNormalized

    try {
      if (isDiskEqual) {
        await window.thockdownNotes.saveNoteSnapshot({ id: noteId, content: currentText, isManual: false })
        externalNoteOriginalTextByIdRef.current.set(noteId, currentText)
        externalNoteOriginalHashByIdRef.current.set(noteId, currentHash)
        setCurrentExternalNoteHash(currentHash)
        if (activeNoteId === noteId) {
          setActiveNoteText(currentText)
        }
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
        const diskHash = await hashNormalizedText(diskSanityNormalized)
        await window.thockdownNotes.saveNoteSnapshot({ id: noteId, content: diskSanityNormalized, isManual: false })
        externalNoteOriginalTextByIdRef.current.set(noteId, diskSanityNormalized)
        externalNoteOriginalHashByIdRef.current.set(noteId, diskHash)
        setCurrentExternalNoteHash(currentHash)
        if (activeNoteId === noteId) {
          setActiveNoteText(currentText)
        }
        console.error('[external-note] disk sanity mismatch after save', { noteId, currentHash, diskHash, writeSucceeded })
      }
    } catch (error) {
      console.error('[external-note] failed to persist external note snapshots', { noteId, error })
    }
  }, [activeNoteId, activeNoteText, notes])

  const getNextActiveNoteIdAfterRemoval = useCallback((removedNoteId: string): string | null => {
    if (sidebarMode === 'date') {
      return dateFilteredNotesRef.current.find((note) => note.id !== removedNoteId)?.id ?? null
    }

    if (sidebarMode === 'trash') {
      return trashFilteredNotesRef.current.find((note) => note.id !== removedNoteId)?.id ?? null
    }

    if (sidebarMode === 'category') {
      for (const primary of categoryTreeRef.current) {
        for (const secondary of primary.secondary) {
          for (const tertiary of secondary.tertiary) {
            for (const note of tertiary.notes) {
              if (note.id !== removedNoteId) {
                return note.id
              }
            }
          }
        }
      }
      return null
    }

    if (sidebarMode === 'archive') {
      for (const primary of archiveTreeRef.current) {
        for (const secondary of primary.secondary) {
          for (const tertiary of secondary.tertiary) {
            for (const note of tertiary.notes) {
              if (note.id !== removedNoteId) {
                return note.id
              }
            }
          }
        }
      }
      return null
    }

    return null
  }, [sidebarMode, dateFilteredNotesRef, trashFilteredNotesRef, categoryTreeRef, archiveTreeRef])

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
        await refreshNotes(activeNoteId === noteId ? null : activeNoteId)

        if (activeNoteId === noteId) {
          const nextActiveId = getNextActiveNoteIdAfterRemoval(noteId)
          if (nextActiveId) {
            await activateNote(nextActiveId)
          } else {
            setActiveNoteId(null)
            setActiveNoteText('')
          }
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
        if (action === 'archive' || action === 'deletion') {
          const nextActiveId = getNextActiveNoteIdAfterRemoval(noteId)
          if (nextActiveId) {
            await activateNote(nextActiveId)
          } else {
            setActiveNoteId(null)
            setActiveNoteText('')
          }
        } else {
          await activateNote(noteId)
        }
      }
    } catch (error) {
      console.error('Failed to apply note action', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [activateNote, activeNoteId, applyProtectedNoteDestination, flushPendingSaveNow, notes, persistenceReady, refreshNotes, saveExternalNoteToFile, getNextActiveNoteIdAfterRemoval, noteTransitionLockRef, setActiveNoteId, setActiveNoteText])

  const applyQuickProtectedRightClickAction = useCallback(async (noteId: string, action: Exclude<ProtectedQuickReleaseAction, null>) => {
    if (!window.thockdownNotes) return
    if (!persistenceReady) return
    if (noteTransitionLockRef.current) return

    noteTransitionLockRef.current = true
    try {
      await flushPendingSaveNow()

      if (action === 'remove-archived') {
        await window.thockdownNotes.removeTagFromNote({ id: noteId, tagName: 'archived' })
      } else {
        await window.thockdownNotes.removeTagFromNote({ id: noteId, tagName: 'deleted' })
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
  }, [activateNote, activeNoteId, flushPendingSaveNow, persistenceReady, refreshNotes, noteTransitionLockRef])

  const closeExternalNoteWithoutSaving = useCallback(async (noteId: string) => {
    if (!window.thockdownNotes) return

    cancelPendingSave()

    clearNoteArmTimer()
    const nextActiveId = activeNoteId === noteId ? getNextActiveNoteIdAfterRemoval(noteId) : null

    externalNoteOriginalTextByIdRef.current.delete(noteId)
    externalNoteOriginalHashByIdRef.current.delete(noteId)
    setCurrentExternalNoteHash((current) => (activeNoteId === noteId ? null : current))

    try {
      await window.thockdownNotes.deleteNote({ id: noteId })
      setNotes((previous) => previous.filter((note) => note.id !== noteId))

      if (activeNoteId === noteId) {
        if (nextActiveId) {
          await activateNote(nextActiveId)
        } else {
          setActiveNoteId(null)
          setActiveNoteText('')
        }
      }
    } catch (error) {
      console.error('Failed to delete external temp note', error)
    }
  }, [activeNoteId, activateNote, cancelPendingSave, clearNoteArmTimer, getNextActiveNoteIdAfterRemoval, externalNoteOriginalTextByIdRef, externalNoteOriginalHashByIdRef, setCurrentExternalNoteHash, setNotes, setActiveNoteId, setActiveNoteText])

  const handleNoteRightPressStart = useCallback((noteId: string, event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()

    const summary = notes.find((note) => note.id === noteId)
    const isExternal = summary ? isExternalNote(summary) : false
    if (isExternal) {
      return
    }

    clearNoteArmTimer()

    const isNoteArchived = summary ? isArchivedNote(summary) : false
    const isNoteDeleted = summary ? isDeletedNote(summary) : false
    if (isNoteArchived || isNoteDeleted) {
      setPrimedNoteActionState(null)
    } else {
      setPrimedNoteActionState({ noteId, action: 'archive' })
    }

    const quickReleaseAction: ProtectedQuickReleaseAction = isNoteDeleted
      ? 'remove-deleted'
      : (isNoteArchived ? 'remove-archived' : null)

    let timeoutId = 0
    if (sidebarMode !== 'trash') {
      timeoutId = window.setTimeout(() => {
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

    noteArmTimerRef.current = { noteId, button: 2, timeoutId, quickReleaseAction }
  }, [activeNoteId, primedNoteActionState, clearNoteArmTimer, closeExternalNoteWithoutSaving, currentExternalNoteHash, notes, sidebarMode])


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
        const nextActiveId = getNextActiveNoteIdAfterRemoval(noteId)
        if (nextActiveId) {
          await activateNote(nextActiveId)
        } else {
          setActiveNoteId(null)
          setActiveNoteText('')
        }
      }
    } catch (error) {
      console.error('Failed to archive note', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [activeNoteId, activateNote, applyProtectedNoteDestination, flushPendingSaveNow, persistenceReady, refreshNotes, noteTransitionLockRef, getNextActiveNoteIdAfterRemoval, setActiveNoteId, setActiveNoteText])

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
      } else {
        await applyProtectedNoteDestination(noteId, 'deleted')
      }

      await refreshNotes(activeNoteId ?? noteId)
      if (activeNoteId === noteId) {
        const nextActiveId = getNextActiveNoteIdAfterRemoval(noteId)
        if (nextActiveId) {
          await activateNote(nextActiveId)
        } else {
          setActiveNoteId(null)
          setActiveNoteText('')
        }
      }
    } catch (error) {
      console.error('Failed to trash note', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [activeNoteId, activateNote, applyProtectedNoteDestination, flushPendingSaveNow, notes, persistenceReady, refreshNotes, noteTransitionLockRef, getNextActiveNoteIdAfterRemoval, setActiveNoteId, setActiveNoteText])

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
      }

      const activeDeleted = activeNoteId ? deletedNoteIds.includes(activeNoteId) : false
      await refreshNotes(activeDeleted ? null : activeNoteId)

      if (activeDeleted && activeNoteId) {
        const nextActiveId = getNextActiveNoteIdAfterRemoval(activeNoteId)
        if (nextActiveId) {
          await activateNote(nextActiveId)
        } else {
          setActiveNoteId(null)
          setActiveNoteText('')
        }
      }
    } catch (error) {
      console.error('Failed to permanently purge deleted notes', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [activateNote, activeNoteId, flushPendingSaveNow, notes, persistenceReady, refreshNotes, noteTransitionLockRef, getNextActiveNoteIdAfterRemoval, setActiveNoteId, setActiveNoteText])

  const handleTrashViewButtonMouseDown = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 2) return
    event.preventDefault()
    event.stopPropagation()
    clearTrashButtonArmTimer()
    setIsTrashViewDeletePrimed(false)

    trashButtonArmTimerRef.current = window.setTimeout(() => {
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
