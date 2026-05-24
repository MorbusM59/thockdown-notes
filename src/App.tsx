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
const NEW_NOTE_TEMPLATE = '# '

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const PROTECTED_TAGS = new Set(['archived', 'deleted', 'temp'])

type SidebarMode = 'date' | 'category' | 'archive' | 'trash'
type DateFilterValue = 'all' | number

const SIDEBAR_MODES: Array<{ mode: SidebarMode; label: string }> = [
  { mode: 'date', label: 'Date' },
  { mode: 'category', label: 'Category' },
  { mode: 'archive', label: 'Archive' },
  { mode: 'trash', label: 'Trash' },
]

type TertiaryGroup = {
  name: string
  notes: NoteSummary[]
}

type SecondaryGroup = {
  name: string
  tertiary: TertiaryGroup[]
}

type PrimaryGroup = {
  name: string
  secondary: SecondaryGroup[]
}

function hierarchyFromTags(tags: string[]): { primary: string; secondary: string; tertiary: string } {
  const nonProtected = tags.filter((tag) => !PROTECTED_TAGS.has(tag))
  return {
    primary: nonProtected[0] ?? 'Uncategorized',
    secondary: nonProtected[1] ?? 'General',
    tertiary: nonProtected[2] ?? 'Notes',
  }
}

function buildHierarchyGroups(notes: NoteSummary[]): PrimaryGroup[] {
  const sortedNotes = [...notes].sort((a, b) => b.updatedAtMs - a.updatedAtMs)
  const primaryMap = new Map<string, Map<string, Map<string, NoteSummary[]>>>()

  for (const note of sortedNotes) {
    const { primary, secondary, tertiary } = hierarchyFromTags(note.tags)

    if (!primaryMap.has(primary)) {
      primaryMap.set(primary, new Map())
    }
    const secondaryMap = primaryMap.get(primary)!

    if (!secondaryMap.has(secondary)) {
      secondaryMap.set(secondary, new Map())
    }
    const tertiaryMap = secondaryMap.get(secondary)!

    if (!tertiaryMap.has(tertiary)) {
      tertiaryMap.set(tertiary, [])
    }
    tertiaryMap.get(tertiary)!.push(note)
  }

  const compareLabel = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })

  return [...primaryMap.entries()]
    .sort(([a], [b]) => compareLabel(a, b))
    .map(([primaryName, secondaryMap]) => ({
      name: primaryName,
      secondary: [...secondaryMap.entries()]
        .sort(([a], [b]) => compareLabel(a, b))
        .map(([secondaryName, tertiaryMap]) => ({
          name: secondaryName,
          tertiary: [...tertiaryMap.entries()]
            .sort(([a], [b]) => compareLabel(a, b))
            .map(([tertiaryName, groupedNotes]) => ({
              name: tertiaryName,
              notes: groupedNotes,
            })),
        })),
    }))
}

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

function deriveNoteTitleFromText(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const heading = lines.find((line) => line.startsWith('# ') && line.trim().length > 2)
  if (heading) {
    return heading.slice(2).trim()
  }

  const firstContent = lines.find((line) => {
    const trimmed = line.trim()
    return trimmed.length > 0 && trimmed !== '#'
  })

  return firstContent?.trim() ?? 'Untitled'
}

function isSameNoteSummary(a: NoteSummary, b: NoteSummary): boolean {
  return (
    a.id === b.id &&
    a.fileName === b.fileName &&
    a.title === b.title &&
    a.tags.length === b.tags.length &&
    a.tags.every((tag, index) => tag === b.tags[index]) &&
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

type CategoryTreeViewProps = {
  groups: PrimaryGroup[]
  activeNoteId: string | null
  persistenceReady: boolean
  onSelect: (noteId: string) => void
  onDelete: (noteId: string) => void
}

const CategoryTreeView = memo(function CategoryTreeView({
  groups,
  activeNoteId,
  persistenceReady,
  onSelect,
  onDelete,
}: CategoryTreeViewProps) {
  if (groups.length === 0) {
    return <div className="notes-empty-state">No notes available for this category view.</div>
  }

  return (
    <div className="category-tree-root" aria-label="Category tree">
      {groups.map((primary) => (
        <details key={primary.name} className="category-primary" open>
          <summary className="category-primary-summary">{primary.name}</summary>
          {primary.secondary.map((secondary) => (
            <details key={`${primary.name}:${secondary.name}`} className="category-secondary" open>
              <summary className="category-secondary-summary">{secondary.name}</summary>
              {secondary.tertiary.map((tertiary) => (
                <div key={`${primary.name}:${secondary.name}:${tertiary.name}`} className="category-tertiary-block">
                  <div className="category-tertiary-heading">{tertiary.name}</div>
                  {tertiary.notes.map((note) => (
                    <NoteListItem
                      key={note.id}
                      note={note}
                      isActive={note.id === activeNoteId}
                      persistenceReady={persistenceReady}
                      onSelect={onSelect}
                      onDelete={onDelete}
                    />
                  ))}
                </div>
              ))}
            </details>
          ))}
        </details>
      ))}
    </div>
  )
})

function isArchivedNote(note: NoteSummary): boolean {
  return note.tags.includes('archived')
}

function isDeletedNote(note: NoteSummary): boolean {
  return note.tags.includes('deleted')
}

function matchesSearchQuery(note: NoteSummary, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true

  if (normalized.startsWith('#')) {
    const tagQuery = normalized.slice(1).trim()
    if (!tagQuery) return true
    return note.tags.some((tag) => tag.toLowerCase().includes(tagQuery))
  }

  return (
    note.title.toLowerCase().includes(normalized) ||
    note.fileName.toLowerCase().includes(normalized) ||
    note.tags.some((tag) => tag.toLowerCase().includes(normalized))
  )
}

function App() {
  const adapterRef = useRef<EditorAdapter | null>(null)
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [newTagName, setNewTagName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [isTagMutationPending, setIsTagMutationPending] = useState(false)
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('date')
  const [dateFilterYear, setDateFilterYear] = useState<DateFilterValue>('all')
  const [dateFilterMonth, setDateFilterMonth] = useState<DateFilterValue>('all')
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [activeNoteText, setActiveNoteText] = useState('')
  const [persistenceReady, setPersistenceReady] = useState(false)
  const [lastSavedAtMs, setLastSavedAtMs] = useState<number | null>(null)
  const pendingSaveTextRef = useRef<string | null>(null)
  const latestEditorTextRef = useRef('')
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
      const savedSummary = await window.measlyNotes.saveNote({ id: activeNoteId, text: nextText })
      setNotes((previous) => {
        const index = previous.findIndex((note) => note.id === savedSummary.id)
        if (index < 0) return previous

        const existing = previous[index]
        if (isSameNoteSummary(existing, savedSummary)) {
          return previous
        }

        const next = [...previous]
        next[index] = savedSummary
        return next
      })
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
        const replacement = await window.measlyNotes.createNote({ initialText: NEW_NOTE_TEMPLATE })
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

  const updateActiveNoteTitlePreview = useCallback((nextText: string) => {
    if (!activeNoteId) return

    const nextTitle = deriveNoteTitleFromText(nextText)
    setNotes((previous) => {
      const index = previous.findIndex((note) => note.id === activeNoteId)
      if (index < 0) return previous

      const existing = previous[index]
      if (existing.title === nextTitle) {
        return previous
      }

      const next = [...previous]
      next[index] = {
        ...existing,
        title: nextTitle,
      }
      return next
    })
  }, [activeNoteId])

  const createNote = useCallback(async () => {
    if (!window.measlyNotes) return
    if (!persistenceReady) return
    if (noteTransitionLockRef.current) return

    noteTransitionLockRef.current = true
    try {
      await flushPendingSaveNow()
      const created = await window.measlyNotes.createNote({ initialText: NEW_NOTE_TEMPLATE })
      await refreshNotes(created.id)
      await activateNote(created.id)
      setSidebarMode('date')
    } catch (error) {
      console.error('Failed to create note', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [activateNote, flushPendingSaveNow, persistenceReady, refreshNotes])

  const activeNoteSummary = useMemo(() => {
    if (!activeNoteId) return null
    return notes.find((note) => note.id === activeNoteId) ?? null
  }, [activeNoteId, notes])

  const orderedActiveTags = activeNoteSummary?.tags ?? []

  const runActiveNoteTagMutation = useCallback(async (mutate: (noteId: string) => Promise<void>) => {
    if (!window.measlyNotes) return
    if (!persistenceReady) return
    if (!activeNoteId) return
    if (noteTransitionLockRef.current) return

    noteTransitionLockRef.current = true
    setIsTagMutationPending(true)
    try {
      await flushPendingSaveNow()
      await mutate(activeNoteId)
      await refreshNotes(activeNoteId)
      await activateNote(activeNoteId)
    } catch (error) {
      console.error('Failed to mutate active note tags', error)
    } finally {
      setIsTagMutationPending(false)
      noteTransitionLockRef.current = false
    }
  }, [activeNoteId, activateNote, flushPendingSaveNow, persistenceReady, refreshNotes])

  const handleAddTag = useCallback(() => {
    const tagName = newTagName.trim()
    if (!tagName) return
    void runActiveNoteTagMutation(async (noteId) => {
      await window.measlyNotes!.addTagToNote({
        id: noteId,
        tagName,
        position: orderedActiveTags.length,
      })
    })
    setNewTagName('')
  }, [newTagName, orderedActiveTags.length, runActiveNoteTagMutation])

  const handleRemoveTag = useCallback((tagName: string) => {
    void runActiveNoteTagMutation(async (noteId) => {
      await window.measlyNotes!.removeTagFromNote({ id: noteId, tagName })
    })
  }, [runActiveNoteTagMutation])

  const handleMoveTag = useCallback((tagName: string, direction: -1 | 1) => {
    const currentIndex = orderedActiveTags.indexOf(tagName)
    if (currentIndex < 0) return
    const targetIndex = currentIndex + direction
    if (targetIndex < 0 || targetIndex >= orderedActiveTags.length) return

    const reordered = [...orderedActiveTags]
    const [tag] = reordered.splice(currentIndex, 1)
    reordered.splice(targetIndex, 0, tag)

    void runActiveNoteTagMutation(async (noteId) => {
      await window.measlyNotes!.reorderNoteTags({ id: noteId, tagNames: reordered })
    })
  }, [orderedActiveTags, runActiveNoteTagMutation])

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
          const created = await measlyNotes.createNote({ initialText: NEW_NOTE_TEMPLATE })
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

      updateActiveNoteTitlePreview(event.text)
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
  }), [activeNoteId, persistenceReady, queueSave, queueAppStateSave, updateActiveNoteTitlePreview])

  useEffect(() => {
    if (!window.measlyState || !activeNoteId) return
    queueAppStateSave(activeNoteId)
  }, [activeNoteId, queueAppStateSave])

  const lastSaveLabel = useMemo(() => {
    if (!lastSavedAtMs) return 'Last save: --'
    return `Last save: ${new Date(lastSavedAtMs).toLocaleString()}`
  }, [lastSavedAtMs])

  const sortedNotes = useMemo(() => {
    return [...notes].sort((a, b) => b.updatedAtMs - a.updatedAtMs)
  }, [notes])

  const searchedNotes = useMemo(() => {
    return sortedNotes.filter((note) => matchesSearchQuery(note, searchQuery))
  }, [searchQuery, sortedNotes])

  const dateEligibleNotes = useMemo(() => {
    return searchedNotes.filter((note) => !isArchivedNote(note) && !isDeletedNote(note))
  }, [searchedNotes])

  const categoryEligibleNotes = useMemo(() => {
    return dateEligibleNotes
  }, [dateEligibleNotes])

  const archiveEligibleNotes = useMemo(() => {
    return searchedNotes.filter((note) => isArchivedNote(note) && !isDeletedNote(note))
  }, [searchedNotes])

  const trashEligibleNotes = useMemo(() => {
    return searchedNotes.filter((note) => isDeletedNote(note))
  }, [searchedNotes])

  const availableYears = useMemo(() => {
    const years = new Set<number>()
    for (const note of dateEligibleNotes) {
      years.add(new Date(note.updatedAtMs).getFullYear())
    }
    return [...years].sort((a, b) => b - a)
  }, [dateEligibleNotes])

  const availableMonths = useMemo(() => {
    const months = new Set<number>()
    for (const note of dateEligibleNotes) {
      const date = new Date(note.updatedAtMs)
      if (dateFilterYear === 'all' || date.getFullYear() === dateFilterYear) {
        months.add(date.getMonth() + 1)
      }
    }
    return [...months].sort((a, b) => a - b)
  }, [dateEligibleNotes, dateFilterYear])

  const dateFilteredNotes = useMemo(() => {
    return dateEligibleNotes.filter((note) => {
      const date = new Date(note.updatedAtMs)
      if (dateFilterYear !== 'all' && date.getFullYear() !== dateFilterYear) {
        return false
      }
      if (dateFilterMonth !== 'all' && date.getMonth() + 1 !== dateFilterMonth) {
        return false
      }
      return true
    })
  }, [dateEligibleNotes, dateFilterMonth, dateFilterYear])

  const trashFilteredNotes = useMemo(() => {
    return trashEligibleNotes.filter((note) => {
      const date = new Date(note.updatedAtMs)
      if (dateFilterYear !== 'all' && date.getFullYear() !== dateFilterYear) {
        return false
      }
      if (dateFilterMonth !== 'all' && date.getMonth() + 1 !== dateFilterMonth) {
        return false
      }
      return true
    })
  }, [dateFilterMonth, dateFilterYear, trashEligibleNotes])

  const categoryTree = useMemo<PrimaryGroup[]>(() => {
    return buildHierarchyGroups(categoryEligibleNotes)
  }, [categoryEligibleNotes])

  const archiveTree = useMemo<PrimaryGroup[]>(() => {
    return buildHierarchyGroups(archiveEligibleNotes)
  }, [archiveEligibleNotes])

  const modeCounts = useMemo(() => {
    return {
      date: dateEligibleNotes.length,
      category: categoryEligibleNotes.length,
      archive: archiveEligibleNotes.length,
      trash: trashEligibleNotes.length,
    }
  }, [archiveEligibleNotes.length, categoryEligibleNotes.length, dateEligibleNotes.length, trashEligibleNotes.length])

  const visibleNotes = useMemo(() => {
    if (sidebarMode === 'date') {
      return dateFilteredNotes
    }

    if (sidebarMode === 'trash') {
      return trashFilteredNotes
    }

    return []
  }, [dateFilteredNotes, sidebarMode, trashFilteredNotes])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void createNote()
        return
      }

      if (event.key === 'Escape' && sidebarMode !== 'date') {
        setSidebarMode('date')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [createNote, sidebarMode])

  return (
    <div className="app-shell app-grid">
      <aside className="notes-sidebar" style={{ gridArea: 'sidebar' }}>
        <div className="search-box" aria-label="Search panel">
          <input
            type="text"
            placeholder="Search notes or #tag..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>

        <div className="view-toggle" role="tablist" aria-label="Note view modes">
          {SIDEBAR_MODES.map(({ mode, label }) => {
            const isActive = sidebarMode === mode
            const count = modeCounts[mode]
            return (
              <button
                key={mode}
                className={`toggle-btn notes-mode-button${isActive ? ' is-active' : ''}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                title={label}
                aria-label={label}
                onClick={() => setSidebarMode(mode)}
              >
                <span>{label}</span>
                <span className="notes-mode-count">{count}</span>
              </button>
            )
          })}
        </div>

        <div className="sidebar-content">
          {(sidebarMode === 'date' || sidebarMode === 'trash') ? (
            <div className="notes-list" role="listbox" aria-label="Note list">
              {visibleNotes.map((note) => {
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
              {visibleNotes.length === 0 ? (
                <div className="notes-empty-state">
                  {searchQuery.trim()
                    ? 'No notes match the current search.'
                    : 'No notes match the current date filters.'}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="notes-list">
              <CategoryTreeView
                groups={sidebarMode === 'category' ? categoryTree : archiveTree}
                activeNoteId={activeNoteId}
                persistenceReady={persistenceReady}
                onSelect={handleSelectNote}
                onDelete={handleDeleteNote}
              />
            </div>
          )}
        </div>

        {(sidebarMode === 'date' || sidebarMode === 'trash') ? (
          <div className="date-filter-rail" aria-label="Date filters">
            <div className="date-filter-line">
              <button
                type="button"
                className={`date-filter-chip${dateFilterYear === 'all' ? ' is-active' : ''}`}
                onClick={() => {
                  setDateFilterYear('all')
                  setDateFilterMonth('all')
                }}
              >
                All Years
              </button>
              {availableYears.map((year) => (
                <button
                  key={year}
                  type="button"
                  className={`date-filter-chip${dateFilterYear === year ? ' is-active' : ''}`}
                  onClick={() => {
                    setDateFilterYear(year)
                    setDateFilterMonth('all')
                  }}
                >
                  {year}
                </button>
              ))}
            </div>
            <div className="date-filter-line">
              <button
                type="button"
                className={`date-filter-chip${dateFilterMonth === 'all' ? ' is-active' : ''}`}
                onClick={() => setDateFilterMonth('all')}
              >
                All Months
              </button>
              {availableMonths.map((month) => (
                <button
                  key={month}
                  type="button"
                  className={`date-filter-chip${dateFilterMonth === month ? ' is-active' : ''}`}
                  onClick={() => setDateFilterMonth(month)}
                >
                  {MONTH_LABELS[month - 1]}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </aside>

      <div className="grid-divider divider-sidebar" style={{ gridArea: 'd-sidebar' }} aria-hidden="true" />

      <section className="tag-input-grid" style={{ gridArea: 'taginput' }} aria-label="Tag input manager">
        <div className="tag-input-shell">
          <div className="tag-manager-header">Tags</div>
          <div className="tag-input-bar-row">
            <div className="tag-manager-input-row">
              <input
                className="tag-manager-input"
                type="text"
                value={newTagName}
                placeholder="Add tag"
                onChange={(event) => setNewTagName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    handleAddTag()
                  }
                }}
                disabled={!persistenceReady || !activeNoteId || isTagMutationPending}
              />
              <button
                className="notes-mini-action"
                type="button"
                onClick={handleAddTag}
                disabled={!persistenceReady || !activeNoteId || !newTagName.trim() || isTagMutationPending}
              >
                Add
              </button>
            </div>
            <div className="tag-collection-inline-placeholder" role="note" aria-label="Tag collection placeholder">
              Tag collection placeholder
            </div>
          </div>
          <div className="tag-manager-list">
            {orderedActiveTags.length === 0 ? (
              <div className="tag-manager-empty">No tags on active note.</div>
            ) : (
              orderedActiveTags.map((tagName, index) => (
                <div key={tagName} className="tag-row">
                  <span className={`tag-name${PROTECTED_TAGS.has(tagName) ? ' is-protected' : ''}`}>{tagName}</span>
                  <div className="tag-row-actions">
                    <button
                      type="button"
                      className="tag-mini-btn"
                      onClick={() => handleMoveTag(tagName, -1)}
                      disabled={isTagMutationPending || index === 0}
                      aria-label={`Move ${tagName} up`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="tag-mini-btn"
                      onClick={() => handleMoveTag(tagName, 1)}
                      disabled={isTagMutationPending || index === orderedActiveTags.length - 1}
                      aria-label={`Move ${tagName} down`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="tag-mini-btn"
                      onClick={() => handleRemoveTag(tagName)}
                      disabled={isTagMutationPending}
                      aria-label={`Remove ${tagName}`}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <div className="grid-divider divider-left" style={{ gridArea: 'd-left' }} aria-hidden="true" />

      <section className="suggested-grid" style={{ gridArea: 'suggested' }} aria-label="Tag collection panel placeholder">
        <div className="panel-placeholder">
          <div className="panel-placeholder-title">Tag Collection</div>
          <div className="panel-placeholder-text">Placeholder for the right-side tag collection panel.</div>
        </div>
      </section>

      <div className="grid-divider divider-right" style={{ gridArea: 'd-right' }} aria-hidden="true" />

      <section className="utility-grid" style={{ gridArea: 'utility' }} aria-label="Utility grid placeholder">
        <div className="panel-placeholder utility-panel-placeholder">
          <div className="panel-placeholder-title">Utility Grid</div>
          <div className="panel-placeholder-text">Placeholder for utility actions and controls.</div>
        </div>
      </section>

      <section className="toolbar-grid" style={{ gridArea: 'toolbar' }} aria-label="Toolbar panel placeholder">
        <div className="toolbar-placeholder">Toolbar panel placeholder between tag manager and editor.</div>
      </section>

      <main className="editor-shell" style={{ gridArea: 'viewer' }}>
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


