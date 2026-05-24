import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { Editor } from './components/Editor'
import './App.css'
import type {
  EditorAdapter,
  EditorBindings,
  EditorTextChangeEvent,
  EditorViewportChangeEvent,
} from './editor/EditorContract'
import type { PersistedViewportState } from './shared/appState'
import type { NoteSummary } from './shared/noteLifecycle'
import { CELL_WIDTH_PX, LINE_HEIGHT_PX } from './editor/LayoutConstants'

const SAVE_DEBOUNCE_MS = 350

function newlineRuns(text: string): number[] {
  const matches = text.match(/\n+/g)
  if (!matches) return []
  return matches.map((run) => run.length)
}

// Lexical plain-text extraction uses doubled paragraph separators.
// Persist canonical text with single separators while preserving intentional blank lines.
function toPersistenceText(editorText: string): string {
  return editorText.replace(/\n{2,}/g, (run) => '\n'.repeat(Math.ceil(run.length / 2)))
}

// Migrate legacy files that were previously persisted with Lexical's doubled separators.
function fromPersistenceText(storedText: string): string {
  const runs = newlineRuns(storedText)
  const hasRuns = runs.length > 0
  const hasSingleRun = runs.some((len) => len === 1)
  const allRunsEven = runs.every((len) => len % 2 === 0)

  if (hasRuns && !hasSingleRun && allRunsEven) {
    return storedText.replace(/\n{2,}/g, (run) => '\n'.repeat(run.length / 2))
  }

  return storedText
}

function titleSegment(text: string): string {
  const firstNewline = text.indexOf('\n')
  if (firstNewline === -1) return text
  return text.slice(0, firstNewline)
}

function didTitleSegmentChange(previousText: string, nextText: string): boolean {
  return titleSegment(previousText) !== titleSegment(nextText)
}

function isSameNoteSummary(a: NoteSummary, b: NoteSummary): boolean {
  return (
    a.id === b.id &&
    a.fileName === b.fileName &&
    a.title === b.title &&
    a.createdAtMs === b.createdAtMs &&
    a.updatedAtMs === b.updatedAtMs &&
    a.sizeBytes === b.sizeBytes
  )
}

function mergeNoteSummaries(previous: NoteSummary[], next: NoteSummary[]): NoteSummary[] {
  const previousById = new Map(previous.map((note) => [note.id, note]))
  const merged: NoteSummary[] = []
  let changed = previous.length !== next.length

  for (let index = 0; index < next.length; index += 1) {
    const nextNote = next[index]
    const existing = previousById.get(nextNote.id)

    if (existing && isSameNoteSummary(existing, nextNote)) {
      merged.push(existing)
      if (previous[index] !== existing) {
        changed = true
      }
      continue
    }

    merged.push(nextNote)
    changed = true
  }

  return changed ? merged : previous
}

async function waitForNotesBridge(timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (window.measlyNotes) return true
    await new Promise((resolve) => window.setTimeout(resolve, 40))
  }
  return Boolean(window.measlyNotes)
}

type NoteListItemProps = {
  note: NoteSummary
  isActive: boolean
  persistenceReady: boolean
  onSelect: (noteId: string) => void
  onDelete: (noteId: string) => void
}

const NoteListItem = memo(function NoteListItem({
  note,
  isActive,
  persistenceReady,
  onSelect,
  onDelete,
}: NoteListItemProps) {
  const handleSelect = useCallback(() => {
    onSelect(note.id)
  }, [note.id, onSelect])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(note.id)
    }
  }, [note.id, onSelect])

  const handleDelete = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onDelete(note.id)
  }, [note.id, onDelete])

  return (
    <div
      className={`note-list-item${isActive ? ' is-active' : ''}`}
      role="option"
      aria-selected={isActive}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div className="note-list-content">
        <div className="note-list-title">{note.title || 'Untitled'}</div>
        <div className="note-list-meta">{new Date(note.updatedAtMs).toLocaleDateString()}</div>
      </div>
      <button
        className="note-delete-button"
        type="button"
        onClick={handleDelete}
        disabled={!persistenceReady}
        aria-label={`Delete note ${note.title || note.fileName}`}
      >
        Delete
      </button>
    </div>
  )
})

function App() {
  const adapterRef = useRef<EditorAdapter | null>(null)
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [activeNoteText, setActiveNoteText] = useState('')
  const [persistenceReady, setPersistenceReady] = useState(false)
  const [lastSavedAtMs, setLastSavedAtMs] = useState<number | null>(null)
  const pendingSaveTextRef = useRef<string | null>(null)
  const latestEditorTextRef = useRef('')
  const isTitleSavePausedRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const appStateSaveTimerRef = useRef<number | null>(null)
  const noteTransitionLockRef = useRef(false)
  const pendingViewportRestoreRef = useRef<PersistedViewportState | null>(null)
  const latestViewportRef = useRef<PersistedViewportState | null>(null)
  const isApplyingInitialViewportRef = useRef(false)

  const queueAppStateSave = useCallback((selectedNoteId: string | null) => {
    if (!window.measlyState) return
    if (!persistenceReady) return
    if (isApplyingInitialViewportRef.current) return

    if (appStateSaveTimerRef.current !== null) {
      window.clearTimeout(appStateSaveTimerRef.current)
    }

    appStateSaveTimerRef.current = window.setTimeout(() => {
      appStateSaveTimerRef.current = null
      void window.measlyState?.saveAppState({
        selectedNoteId,
        viewport: latestViewportRef.current ?? undefined,
      })
    }, 150)
  }, [persistenceReady])

  const flushSave = useCallback(async () => {
    if (!window.measlyNotes || !activeNoteId) return
    const nextText = pendingSaveTextRef.current
    if (nextText === null) return

    pendingSaveTextRef.current = null
    try {
      await window.measlyNotes.saveNote({ id: activeNoteId, text: nextText })
      setLastSavedAtMs(Date.now())
    } catch (error) {
      console.error('Failed to persist note', error)
    }
  }, [activeNoteId])

  const flushPendingSaveNow = useCallback(async () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    await flushSave()
  }, [flushSave])

  const saveSelectedNoteState = useCallback(async (selectedNoteId: string | null) => {
    if (!window.measlyState) return
    await window.measlyState.saveAppState({
      selectedNoteId,
      viewport: latestViewportRef.current ?? undefined,
    })
  }, [])

  const activateNote = useCallback(async (noteId: string) => {
    if (!window.measlyNotes) return

    const loaded = await window.measlyNotes.loadNote({ id: noteId })
    const hydratedText = fromPersistenceText(loaded.text)
    latestEditorTextRef.current = hydratedText
    setActiveNoteId(loaded.id)
    setActiveNoteText(hydratedText)
    setLastSavedAtMs(loaded.updatedAtMs)
    pendingViewportRestoreRef.current = null
    await saveSelectedNoteState(loaded.id)
  }, [saveSelectedNoteState])

  const refreshNotes = useCallback(async (preferredId?: string | null) => {
    if (!window.measlyNotes) return null

    const listed = await window.measlyNotes.listNotes()
    setNotes((previous) => mergeNoteSummaries(previous, listed))
    if (listed.length === 0) {
      return null
    }

    if (preferredId) {
      const preferred = listed.find((note) => note.id === preferredId)
      if (preferred) {
        return preferred.id
      }
    }

    return listed[0].id
  }, [])

  const selectNote = useCallback(async (noteId: string) => {
    if (!window.measlyNotes) return
    if (!persistenceReady) return
    if (noteId === activeNoteId) return
    if (noteTransitionLockRef.current) return

    noteTransitionLockRef.current = true
    try {
      await flushPendingSaveNow()
      await activateNote(noteId)
    } catch (error) {
      console.error('Failed to select note', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [activeNoteId, activateNote, flushPendingSaveNow, persistenceReady])

  const createNote = useCallback(async () => {
    if (!window.measlyNotes) return
    if (!persistenceReady) return
    if (noteTransitionLockRef.current) return

    noteTransitionLockRef.current = true
    try {
      await flushPendingSaveNow()
      const created = await window.measlyNotes.createNote({ initialText: '' })
      await refreshNotes(created.id)
      await activateNote(created.id)
    } catch (error) {
      console.error('Failed to create note', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [activateNote, flushPendingSaveNow, persistenceReady, refreshNotes])

  const deleteNote = useCallback(async (noteId: string) => {
    if (!window.measlyNotes) return
    if (!persistenceReady) return
    if (noteTransitionLockRef.current) return

    const deletingActive = noteId === activeNoteId
    const noteIndex = notes.findIndex((note) => note.id === noteId)
    const fallbackId = noteIndex >= 0
      ? (notes[noteIndex + 1]?.id ?? notes[noteIndex - 1]?.id ?? null)
      : null

    noteTransitionLockRef.current = true
    try {
      if (deletingActive) {
        await flushPendingSaveNow()
      }

      if (notes.length <= 1) {
        const replacement = await window.measlyNotes.createNote({ initialText: '' })
        await window.measlyNotes.deleteNote({ id: noteId })
        await refreshNotes(replacement.id)
        await activateNote(replacement.id)
      } else {
        await window.measlyNotes.deleteNote({ id: noteId })
        const nextId = await refreshNotes(fallbackId)
        if (deletingActive && nextId) {
          await activateNote(nextId)
        }
      }
    } catch (error) {
      console.error('Failed to delete note', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [activeNoteId, activateNote, flushPendingSaveNow, notes, persistenceReady, refreshNotes])

  const handleSelectNote = useCallback((noteId: string) => {
    void selectNote(noteId)
  }, [selectNote])

  const handleDeleteNote = useCallback((noteId: string) => {
    void deleteNote(noteId)
  }, [deleteNote])

  const handleCreateNote = useCallback(() => {
    void createNote()
  }, [createNote])

  const queueSave = useCallback((text: string) => {
    if (!persistenceReady) return
    pendingSaveTextRef.current = toPersistenceText(text)
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void flushSave()
    }, SAVE_DEBOUNCE_MS)
  }, [flushSave, persistenceReady])

  useEffect(() => {
    let disposed = false

    const bootstrap = async () => {
      const hasBridge = await waitForNotesBridge(2000)
      if (!hasBridge) {
        return
      }
      const measlyNotes = window.measlyNotes
      if (!measlyNotes) {
        return
      }

      try {
        setPersistenceReady(false)
        const notes = await measlyNotes.listNotes()
        if (disposed) return
        setNotes((previous) => mergeNoteSummaries(previous, notes))

        const appState = window.measlyState ? await window.measlyState.loadAppState() : { selectedNoteId: null }
        if (disposed) return
        pendingViewportRestoreRef.current = appState.viewport ?? null
        latestViewportRef.current = appState.viewport ?? null

        if (notes.length === 0) {
          const created = await measlyNotes.createNote({ initialText: '' })
          if (disposed) return
          setNotes((previous) => mergeNoteSummaries(previous, [created]))
          setActiveNoteId(created.id)
          const hydratedText = fromPersistenceText(created.text)
          latestEditorTextRef.current = hydratedText
          setActiveNoteText(hydratedText)
          if (window.measlyState) {
            await window.measlyState.saveAppState({ selectedNoteId: created.id })
          }
          setPersistenceReady(true)
          setLastSavedAtMs(created.updatedAtMs)
          return
        }

        const preferredId = appState.selectedNoteId
        const selectedSummary = (
          preferredId
            ? notes.find((note) => note.id === preferredId)
            : undefined
        ) ?? notes[0]

        const loaded = await measlyNotes.loadNote({ id: selectedSummary.id })
        if (disposed) return
        setActiveNoteId(loaded.id)
        const hydratedText = fromPersistenceText(loaded.text)
        latestEditorTextRef.current = hydratedText
        setActiveNoteText(hydratedText)
        if (window.measlyState) {
          await window.measlyState.saveAppState({ selectedNoteId: loaded.id })
        }
        setPersistenceReady(true)
        setLastSavedAtMs(loaded.updatedAtMs)
      } catch (error) {
        console.error('Failed to initialize note lifecycle', error)
      }
    }

    void bootstrap()

    return () => {
      disposed = true
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      if (appStateSaveTimerRef.current !== null) {
        window.clearTimeout(appStateSaveTimerRef.current)
        appStateSaveTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!persistenceReady) return
    const pending = pendingViewportRestoreRef.current
    if (!pending) return

    let cancelled = false
    isApplyingInitialViewportRef.current = true

    const applyViewport = () => {
      if (cancelled) return
      const adapter = adapterRef.current
      if (!adapter) {
        requestAnimationFrame(applyViewport)
        return
      }

      adapter.applySnapshot({
        viewport: {
          topBoundaryPx: pending.topBoundaryPx,
          bottomBoundaryPx: pending.bottomBoundaryPx,
          scrollTopPx: pending.scrollTopPx,
          lineHeightPx: LINE_HEIGHT_PX,
          cellWidthPx: CELL_WIDTH_PX,
        },
      })

      pendingViewportRestoreRef.current = null
      isApplyingInitialViewportRef.current = false
    }

    requestAnimationFrame(applyViewport)

    return () => {
      cancelled = true
      isApplyingInitialViewportRef.current = false
    }
  }, [persistenceReady, activeNoteId])

  const bindings = useMemo<EditorBindings>(() => ({
    onTextChange: (event: EditorTextChangeEvent) => {
      if (!activeNoteId || !persistenceReady) return
      latestEditorTextRef.current = event.text

      const isUserEditableSource =
        event.source === 'user-input' || event.source === 'history-undo' || event.source === 'history-redo'

      if (!isUserEditableSource) {
        // Do not derive save/pause transitions from hydration/programmatic events.
        return
      }

      // Pause autosave whenever the title segment itself is changing.
      // This avoids boundary-offset ambiguity at the first line break.
      if (didTitleSegmentChange(event.previousText, event.text)) {
        isTitleSavePausedRef.current = true
        pendingSaveTextRef.current = toPersistenceText(event.text)
        return
      }

      isTitleSavePausedRef.current = false
      queueSave(event.text)
    },
    onViewportChange: (event: EditorViewportChangeEvent) => {
      latestViewportRef.current = {
        topBoundaryPx: Math.round(event.viewport.topBoundaryPx),
        bottomBoundaryPx: Math.round(event.viewport.bottomBoundaryPx),
        scrollTopPx: Math.round(event.viewport.scrollTopPx),
      }
      queueAppStateSave(activeNoteId)
    },
  }), [activeNoteId, persistenceReady, queueSave, queueAppStateSave])

  useEffect(() => {
    if (!window.measlyState || !activeNoteId) return
    queueAppStateSave(activeNoteId)
  }, [activeNoteId, queueAppStateSave])

  const lastSaveLabel = useMemo(() => {
    if (!lastSavedAtMs) return 'Last save: --'
    return `Last save: ${new Date(lastSavedAtMs).toLocaleString()}`
  }, [lastSavedAtMs])

  return (
    <div className="app-shell">
      <aside className="notes-sidebar">
        <div className="notes-sidebar-header">
          <h1 className="notes-sidebar-title">Notes</h1>
          <button
            className="notes-action-button"
            type="button"
            onClick={handleCreateNote}
            disabled={!persistenceReady}
          >
            New
          </button>
        </div>
        <div className="notes-list" role="listbox" aria-label="Note list">
          {notes.map((note) => {
            const isActive = note.id === activeNoteId
            return (
              <NoteListItem
                key={note.id}
                note={note}
                isActive={isActive}
                persistenceReady={persistenceReady}
                onSelect={handleSelectNote}
                onDelete={handleDeleteNote}
              />
            )
          })}
        </div>
      </aside>

      <main className="editor-shell">
        <div className="save-indicator">{lastSaveLabel}</div>
        <div className="editor-stage">
          <Editor
            key={activeNoteId ?? 'note-bootstrap'}
            bindings={bindings}
            adapterRef={adapterRef}
            initialText={activeNoteText}
          />
        </div>
      </main>
    </div>
  )
}

export default App


