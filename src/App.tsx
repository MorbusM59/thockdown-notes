import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react'
import { Editor } from './components/Editor'
import './App.css'
import type {
  EditorAdapter,
  EditorBindings,
  EditorTextChangeEvent,
  EditorViewportChangeEvent,
} from './editor/EditorContract'
import type { PersistedMenuState, PersistedViewportState } from './shared/appState'
import type { NoteSummary } from './shared/noteLifecycle'
import { CELL_WIDTH_PX, LINE_HEIGHT_PX } from './editor/LayoutConstants'
import {
  FILTER_MONTHS,
  FILTER_YEARS,
  handleMultiSelect,
} from './shared/filterConstants'

const SAVE_DEBOUNCE_MS = 350
const NEW_NOTE_TEMPLATE = '# '
const FALLBACK_NEW_NOTE_TITLE = 'Untitled'
const PROTECTED_TAGS = new Set(['archived', 'deleted', 'external'])
const GRID_DIVIDER_PX = 8
const SIDEBAR_MIN_WIDTH_PX = 232
const SIDEBAR_MAX_WIDTH_PX = 520
const TAG_INPUT_MIN_WIDTH_PX = 320
const SUGGESTED_MIN_WIDTH_PX = 220
const UTILITY_WIDTH_PX = 160
const DEFAULT_SIDEBAR_RATIO = 0.306
const DEFAULT_TAG_SPLIT_RATIO = 0.645
const SCROLL_TRACK_MIN_THUMB_HEIGHT_PX = 28
const SCROLL_TRACK_EDGE_GAP_PX = 3

type SidebarMode = 'date' | 'category' | 'archive' | 'trash'

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

function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-')
}

function isProtectedTagName(name: string): boolean {
  return PROTECTED_TAGS.has(normalizeTagName(name))
}

function isExternalTagName(name: string): boolean {
  return normalizeTagName(name) === 'external'
}

function sanitizeClipboardTitle(raw: string): string {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const firstLine = normalized.split('\n').map((line) => line.trim()).find((line) => line.length > 0)
  if (!firstLine) return FALLBACK_NEW_NOTE_TITLE

  const withoutHeadingPrefix = firstLine.replace(/^#+\s*/, '').trim()
  return withoutHeadingPrefix || FALLBACK_NEW_NOTE_TITLE
}

function titleFromFileBasename(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^./\\]+$/, '').trim()
  if (!withoutExtension) return FALLBACK_NEW_NOTE_TITLE

  const normalized = withoutExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized || FALLBACK_NEW_NOTE_TITLE
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatCreatedDate(timestampMs: number): string {
  const date = new Date(timestampMs)
  const day = pad2(date.getDate())
  const month = date.toLocaleString(undefined, { month: 'long' })
  const year2 = String(date.getFullYear()).slice(-2)
  return `${day} ${month} ${year2}`
}

function formatModifiedDate(timestampMs: number): string {
  const date = new Date(timestampMs)
  const year = date.getFullYear()
  const month = pad2(date.getMonth() + 1)
  const day = pad2(date.getDate())
  const hours = pad2(date.getHours())
  const minutes = pad2(date.getMinutes())
  return `[ ${year}/${month}/${day} | ${hours}:${minutes} ]`
}

async function waitForNotesBridge(shouldStop: () => boolean): Promise<boolean> {
  while (!shouldStop()) {
    if (window.measlyNotes) {
      return true
    }
    await new Promise((resolve) => window.setTimeout(resolve, 40))
  }
  return false
}

type NoteListItemProps = {
  note: NoteSummary
  isActive: boolean
  onSelect: (noteId: string) => void
  variant?: 'default' | 'tree'
}

const NoteListItem = memo(function NoteListItem({
  note,
  isActive,
  onSelect,
  variant = 'default',
}: NoteListItemProps) {
  const isTreeVariant = variant === 'tree'
  const createdDate = isTreeVariant ? '' : formatCreatedDate(note.createdAtMs)

  const handleSelect = useCallback(() => {
    onSelect(note.id)
  }, [note.id, onSelect])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(note.id)
    }
  }, [note.id, onSelect])

  return (
    <div
      className={`note-list-item${isActive ? ' is-active' : ''}${isTreeVariant ? ' is-tree-card' : ''}`}
      role="option"
      aria-selected={isActive}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div className="note-list-content">
        <div className="note-list-title">{note.title || 'Untitled'}</div>
        {isTreeVariant ? null : (
          <div className="note-list-meta-row">
            <span className="note-list-meta-left">{createdDate}</span>
            <span className="note-list-meta-right">{formatModifiedDate(note.updatedAtMs)}</span>
          </div>
        )}
      </div>
    </div>
  )
})

type CategoryTreeViewProps = {
  groups: PrimaryGroup[]
  activeNoteId: string | null
  onSelect: (noteId: string) => void
}

const CategoryTreeView = memo(function CategoryTreeView({
  groups,
  activeNoteId,
  onSelect,
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
                      onSelect={onSelect}
                      variant="tree"
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

function isExternalNote(note: NoteSummary): boolean {
  return note.tags.some((tag) => isExternalTagName(tag))
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
  const appShellRef = useRef<HTMLDivElement | null>(null)
  const sidebarContentRef = useRef<HTMLDivElement | null>(null)
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [tagInputValue, setTagInputValue] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [isTagMutationPending, setIsTagMutationPending] = useState(false)
  const [deleteArmedTagName, setDeleteArmedTagName] = useState<string | null>(null)
  const [renamingTagName, setRenamingTagName] = useState<string | null>(null)
  const [draggedTagIndex, setDraggedTagIndex] = useState<number | null>(null)
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('date')
  const [selectedMonths, setSelectedMonths] = useState<Set<number>>(new Set())
  const [selectedYears, setSelectedYears] = useState<Set<number | 'older'>>(new Set())
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(20)
  const [showPagination, setShowPagination] = useState(false)
  const [scrollbarHostEl, setScrollbarHostEl] = useState<HTMLDivElement | null>(null)
  const [sidebarTreeScrollerEl, setSidebarTreeScrollerEl] = useState<HTMLDivElement | null>(null)
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [activeNoteText, setActiveNoteText] = useState('')
  const [persistenceReady, setPersistenceReady] = useState(false)
  const [appShellWidthPx, setAppShellWidthPx] = useState(980)
  const [sidebarWidthRatio, setSidebarWidthRatio] = useState(DEFAULT_SIDEBAR_RATIO)
  const [tagSplitRatio, setTagSplitRatio] = useState(DEFAULT_TAG_SPLIT_RATIO)
  const [activeDividerDrag, setActiveDividerDrag] = useState<'sidebar' | 'tag-split' | null>(null)
  const pendingSaveTextRef = useRef<string | null>(null)
  const latestEditorTextRef = useRef('')
  const saveTimerRef = useRef<number | null>(null)
  const appStateSaveTimerRef = useRef<number | null>(null)
  const noteTransitionLockRef = useRef(false)
  const pendingViewportRestoreRef = useRef<PersistedViewportState | null>(null)
  const latestViewportRef = useRef<PersistedViewportState | null>(null)
  const isApplyingInitialViewportRef = useRef(false)
  const dividerDragStartXRef = useRef(0)
  const dividerStartSidebarWidthRef = useRef(0)
  const dividerStartTagInputWidthRef = useRef(0)
  const dividerStartMainWidthRef = useRef(0)
  const externalOpenQueueRef = useRef<Promise<void>>(Promise.resolve())
  const sidebarScrollbarTrackRef = useRef<HTMLDivElement | null>(null)
  const sidebarScrollbarRafRef = useRef<number | null>(null)
  const sidebarScrollbarDragOriginRef = useRef<{ pointerY: number; thumbTopPx: number } | null>(null)
  const [sidebarScrollThumbTopPx, setSidebarScrollThumbTopPx] = useState(0)
  const [sidebarScrollThumbHeightPx, setSidebarScrollThumbHeightPx] = useState(0)
  const [isSidebarScrollThumbActive, setIsSidebarScrollThumbActive] = useState(false)
  const [isDraggingSidebarScrollThumb, setIsDraggingSidebarScrollThumb] = useState(false)

  const menuState = useMemo<PersistedMenuState>(() => ({
    sidebarMode,
    selectedMonths: [...selectedMonths],
    selectedYears: [...selectedYears],
    searchQuery,
    sidebarWidthRatio,
    tagSplitRatio,
  }), [searchQuery, selectedMonths, selectedYears, sidebarMode, sidebarWidthRatio, tagSplitRatio])

  const layout = useMemo(() => {
    const dividerTotalWidthPx = GRID_DIVIDER_PX * 3
    const maxSidebarWidthPx = Math.max(
      SIDEBAR_MIN_WIDTH_PX,
      Math.min(
        SIDEBAR_MAX_WIDTH_PX,
        appShellWidthPx - dividerTotalWidthPx - UTILITY_WIDTH_PX - TAG_INPUT_MIN_WIDTH_PX - SUGGESTED_MIN_WIDTH_PX,
      ),
    )

    const sidebarWidthPx = clamp(appShellWidthPx * sidebarWidthRatio, SIDEBAR_MIN_WIDTH_PX, maxSidebarWidthPx)
    const mainColumnsWidthPx = Math.max(
      TAG_INPUT_MIN_WIDTH_PX + SUGGESTED_MIN_WIDTH_PX,
      appShellWidthPx - dividerTotalWidthPx - UTILITY_WIDTH_PX - sidebarWidthPx,
    )

    const tagInputWidthPx = clamp(mainColumnsWidthPx * tagSplitRatio, TAG_INPUT_MIN_WIDTH_PX, mainColumnsWidthPx - SUGGESTED_MIN_WIDTH_PX)
    const suggestedWidthPx = Math.max(SUGGESTED_MIN_WIDTH_PX, mainColumnsWidthPx - tagInputWidthPx)

    return {
      sidebarWidthPx,
      mainColumnsWidthPx,
      tagInputWidthPx,
      suggestedWidthPx,
      gridTemplateColumns: `${Math.round(sidebarWidthPx)}px ${GRID_DIVIDER_PX}px ${Math.round(tagInputWidthPx)}px ${GRID_DIVIDER_PX}px ${Math.round(suggestedWidthPx)}px ${GRID_DIVIDER_PX}px ${UTILITY_WIDTH_PX}px`,
    }
  }, [appShellWidthPx, sidebarWidthRatio, tagSplitRatio])

  const queueAppStateSave = useCallback((selectedNoteId: string | null, menuOverride?: PersistedMenuState) => {
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
        menu: menuOverride ?? menuState,
      })
    }, 150)
  }, [menuState, persistenceReady])

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
      menu: menuState,
    })
  }, [menuState])

  const activateNote = useCallback(async (noteId: string) => {
    if (!window.measlyNotes) return

    const loaded = await window.measlyNotes.loadNote({ id: noteId })
    const hydratedText = fromPersistenceText(loaded.text)
    latestEditorTextRef.current = hydratedText
    setActiveNoteId(loaded.id)
    setActiveNoteText(hydratedText)
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

  const handleSelectNote = useCallback((noteId: string) => {
    void selectNote(noteId)
  }, [selectNote])

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

  const createNote = useCallback(async (initialText = NEW_NOTE_TEMPLATE) => {
    if (!window.measlyNotes) return
    if (!persistenceReady) return
    if (noteTransitionLockRef.current) return

    noteTransitionLockRef.current = true
    try {
      await flushPendingSaveNow()
      const created = await window.measlyNotes.createNote({ initialText })
      await refreshNotes(created.id)
      await activateNote(created.id)
      setSidebarMode('date')
    } catch (error) {
      console.error('Failed to create note', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [activateNote, flushPendingSaveNow, persistenceReady, refreshNotes])

  const createNoteFromClipboardTitle = useCallback(async () => {
    let title = FALLBACK_NEW_NOTE_TITLE

    try {
      const clipboardText = await navigator.clipboard.readText()
      title = sanitizeClipboardTitle(clipboardText)
    } catch {
      title = FALLBACK_NEW_NOTE_TITLE
    }

    await createNote(`# ${title}\n\n`)
  }, [createNote])

  const importExternalFileAsTempNote = useCallback(async (filePath: string) => {
    const externalApi = window.measlyExternalFiles
    const legacyDbApi = window.measlyLegacyDb
    const notesApi = window.measlyNotes
    if (!externalApi || !legacyDbApi || !notesApi) return
    if (!persistenceReady) return

    if (noteTransitionLockRef.current) {
      return
    }

    noteTransitionLockRef.current = true
    try {
      await flushPendingSaveNow()

      const [fileName, content] = await Promise.all([
        externalApi.getFileBasename(filePath),
        externalApi.readFileContent(filePath),
      ])

      if (content === null) {
        return
      }

      const initialTitle = titleFromFileBasename(fileName)
      let noteId = await legacyDbApi.getTempNoteIdByExternalPath(filePath)

      if (!noteId) {
        noteId = await legacyDbApi.createTempNote(initialTitle, filePath, 'utf8')
      }

      await notesApi.saveNote({ id: noteId, text: toPersistenceText(content) })
      await legacyDbApi.updateTempNoteState(noteId, false, true)
      await refreshNotes(noteId)
      await activateNote(noteId)
      setSidebarMode('date')
    } catch (error) {
      console.error('Failed to import external file', error)
    } finally {
      noteTransitionLockRef.current = false
    }
  }, [activateNote, flushPendingSaveNow, persistenceReady, refreshNotes])

  const enqueueExternalFileImport = useCallback((filePath: string) => {
    const queue = externalOpenQueueRef.current
    externalOpenQueueRef.current = queue
      .then(() => importExternalFileAsTempNote(filePath))
      .catch((error) => {
        console.error('External file import queue error', error)
      })
  }, [importExternalFileAsTempNote])

  const activeNoteSummary = useMemo(() => {
    if (!activeNoteId) return null
    return notes.find((note) => note.id === activeNoteId) ?? null
  }, [activeNoteId, notes])

  const orderedActiveTags = activeNoteSummary?.tags ?? []
  const activeNoteIsExternal = orderedActiveTags.some((tag) => isExternalTagName(tag))

  const suggestedTags = useMemo(() => {
    const usageByName = new Map<string, number>()

    for (const note of notes) {
      for (const tag of note.tags) {
        usageByName.set(tag, (usageByName.get(tag) ?? 0) + 1)
      }
    }

    const activeTagSet = new Set(orderedActiveTags)

    return [...usageByName.entries()]
      .filter(([name]) => !PROTECTED_TAGS.has(normalizeTagName(name)) && !activeTagSet.has(name))
      .sort((a, b) => {
        if (b[1] !== a[1]) {
          return b[1] - a[1]
        }
        return a[0].localeCompare(b[0], undefined, { sensitivity: 'base' })
      })
      .map(([name]) => name)
        .slice(0, 15)
  }, [notes, orderedActiveTags])

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

  const handleAddSuggestedTag = useCallback((tagName: string) => {
    if (activeNoteIsExternal) return
    if (orderedActiveTags.includes(tagName)) return

    void runActiveNoteTagMutation(async (noteId) => {
      await window.measlyNotes!.addTagToNote({
        id: noteId,
        tagName,
        position: orderedActiveTags.length,
      })
    })
  }, [activeNoteIsExternal, orderedActiveTags, runActiveNoteTagMutation])

  const handleTagInputEnter = useCallback(() => {
    if (!activeNoteId || !persistenceReady) return
    if (activeNoteIsExternal) return

    const normalized = normalizeTagName(tagInputValue)
    if (!normalized) return

    if (renamingTagName) {
      const fromName = normalizeTagName(renamingTagName)
      const toName = normalized
      setRenamingTagName(null)
      setTagInputValue('')

      if (fromName === toName) {
        return
      }

      if (isProtectedTagName(fromName)) {
        return
      }

      if (!window.measlyNotes) return
      if (noteTransitionLockRef.current) return

      noteTransitionLockRef.current = true
      setIsTagMutationPending(true)
      void (async () => {
        try {
          await flushPendingSaveNow()
          await window.measlyNotes!.renameTag({ fromName, toName })
          await refreshNotes(activeNoteId)
          await activateNote(activeNoteId)
        } catch (error) {
          console.error('Failed to rename tag', error)
        } finally {
          setIsTagMutationPending(false)
          noteTransitionLockRef.current = false
        }
      })()
      return
    }

    if (isProtectedTagName(normalized)) {
      setTagInputValue('')
      return
    }

    if (orderedActiveTags.map(normalizeTagName).includes(normalized)) {
      setTagInputValue('')
      return
    }

    void runActiveNoteTagMutation(async (noteId) => {
      await window.measlyNotes!.addTagToNote({
        id: noteId,
        tagName: normalized,
        position: orderedActiveTags.length,
      })
    })
    setTagInputValue('')
  }, [
    activeNoteId,
    activateNote,
    flushPendingSaveNow,
    orderedActiveTags,
    persistenceReady,
    refreshNotes,
    renamingTagName,
    runActiveNoteTagMutation,
    tagInputValue,
    activeNoteIsExternal,
  ])

  const handleTagChipClick = useCallback((tagName: string) => {
    if (deleteArmedTagName === tagName) {
      setDeleteArmedTagName(null)
      void runActiveNoteTagMutation(async (noteId) => {
        await window.measlyNotes!.removeTagFromNote({ id: noteId, tagName })
      })
      return
    }

    setDeleteArmedTagName(tagName)
  }, [deleteArmedTagName, runActiveNoteTagMutation])

  const handleTagChipMouseLeave = useCallback((tagName: string) => {
    if (deleteArmedTagName === tagName) {
      setDeleteArmedTagName(null)
    }
  }, [deleteArmedTagName])

  const handleTagDragStart = useCallback((index: number) => {
    const tagName = orderedActiveTags[index] ?? ''
    if (isProtectedTagName(tagName)) return
    setDraggedTagIndex(index)
  }, [orderedActiveTags])

  const handleTagDrop = useCallback((event: DragEvent<HTMLDivElement>, targetIndex: number) => {
    event.preventDefault()

    if (draggedTagIndex === null || draggedTagIndex === targetIndex) {
      setDraggedTagIndex(null)
      return
    }

    const targetTag = orderedActiveTags[targetIndex] ?? ''
    if (isProtectedTagName(targetTag)) {
      setDraggedTagIndex(null)
      return
    }

    const reordered = [...orderedActiveTags]
    const [moved] = reordered.splice(draggedTagIndex, 1)
    reordered.splice(targetIndex, 0, moved)
    setDraggedTagIndex(null)

    void runActiveNoteTagMutation(async (noteId) => {
      await window.measlyNotes!.reorderNoteTags({ id: noteId, tagNames: reordered })
    })
  }, [draggedTagIndex, orderedActiveTags, runActiveNoteTagMutation])

  const handleTagContextMenu = useCallback((event: MouseEvent<HTMLDivElement>, tagName: string) => {
    event.preventDefault()
    if (isProtectedTagName(tagName)) return

    setRenamingTagName(tagName)
    setTagInputValue(tagName)
  }, [])

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
      const hasBridge = await waitForNotesBridge(() => disposed)
      if (!hasBridge) {
        return
      }
      const measlyNotes = window.measlyNotes
      if (!measlyNotes) {
        return
      }

      setPersistenceReady(false)

      let attempt = 0
      while (!disposed) {
        try {
          let listed = await measlyNotes.listNotes()
          if (disposed) return

          if (listed.length === 0) {
            await measlyNotes.createNote({ initialText: NEW_NOTE_TEMPLATE })
            listed = await measlyNotes.listNotes()
            if (listed.length === 0) {
              throw new Error('Notes list remained empty after creating bootstrap note')
            }
          }

          const appState = window.measlyState ? await window.measlyState.loadAppState() : { selectedNoteId: null }
          if (disposed) return

          if (appState.menu) {
            setSidebarMode(appState.menu.sidebarMode)
            setSelectedMonths(new Set(appState.menu.selectedMonths))
            setSelectedYears(new Set(appState.menu.selectedYears))
            setSearchQuery(appState.menu.searchQuery)
            setSidebarWidthRatio(appState.menu.sidebarWidthRatio)
            setTagSplitRatio(appState.menu.tagSplitRatio)
          }

          const preferredId = appState.selectedNoteId
          const selectedSummary = (
            preferredId
              ? listed.find((note) => note.id === preferredId)
              : undefined
          ) ?? listed[0]

          const loaded = await measlyNotes.loadNote({ id: selectedSummary.id })
          if (disposed) return

          setNotes((previous) => mergeNoteSummaries(previous, listed))
          setActiveNoteId(loaded.id)

          const hydratedText = fromPersistenceText(loaded.text)
          latestEditorTextRef.current = hydratedText
          setActiveNoteText(hydratedText)

          pendingViewportRestoreRef.current = appState.viewport ?? null
          latestViewportRef.current = appState.viewport ?? null

          if (window.measlyState) {
            await window.measlyState.saveAppState({
              selectedNoteId: loaded.id,
              viewport: appState.viewport,
              menu: appState.menu,
            })
          }

          setPersistenceReady(true)
          return
        } catch (error) {
          attempt += 1
          console.error(`Failed to initialize note lifecycle (attempt ${attempt})`, error)
          await new Promise((resolve) => window.setTimeout(resolve, Math.min(1500, 200 * attempt)))
        }
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
  }, [activeNoteId, menuState, queueAppStateSave])

  useEffect(() => {
    if (!persistenceReady) return

    const externalApi = window.measlyExternalFiles
    if (!externalApi || !window.measlyLegacyDb || !window.measlyNotes) return

    let disposed = false

    const processPending = async () => {
      const pendingPaths = await externalApi.getPendingFilePaths()
      if (disposed) return
      for (const filePath of pendingPaths) {
        enqueueExternalFileImport(filePath)
      }
    }

    void processPending()

    const unsubscribe = externalApi.onOpenFile((filePath) => {
      if (disposed) return
      enqueueExternalFileImport(filePath)
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [enqueueExternalFileImport, persistenceReady])

  useEffect(() => {
    const shellElement = appShellRef.current
    if (!shellElement) return

    const updateShellWidth = () => {
      setAppShellWidthPx(Math.max(980, Math.round(shellElement.clientWidth)))
    }

    updateShellWidth()

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setAppShellWidthPx(Math.max(980, Math.round(entry.contentRect.width)))
    })

    observer.observe(shellElement)
    return () => observer.disconnect()
  }, [])

  const handleDividerMouseDown = useCallback((divider: 'sidebar' | 'tag-split', event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    dividerDragStartXRef.current = event.clientX
    dividerStartSidebarWidthRef.current = layout.sidebarWidthPx
    dividerStartTagInputWidthRef.current = layout.tagInputWidthPx
    dividerStartMainWidthRef.current = layout.mainColumnsWidthPx
    setActiveDividerDrag(divider)
  }, [layout.mainColumnsWidthPx, layout.sidebarWidthPx, layout.tagInputWidthPx])

  useEffect(() => {
    if (!activeDividerDrag) return

    const onPointerMove = (event: globalThis.MouseEvent) => {
      const deltaX = event.clientX - dividerDragStartXRef.current

      if (activeDividerDrag === 'sidebar') {
        const maxSidebarWidthPx = Math.max(
          SIDEBAR_MIN_WIDTH_PX,
          Math.min(
            SIDEBAR_MAX_WIDTH_PX,
            appShellWidthPx - (GRID_DIVIDER_PX * 3) - UTILITY_WIDTH_PX - TAG_INPUT_MIN_WIDTH_PX - SUGGESTED_MIN_WIDTH_PX,
          ),
        )

        const nextSidebarWidthPx = clamp(
          dividerStartSidebarWidthRef.current + deltaX,
          SIDEBAR_MIN_WIDTH_PX,
          maxSidebarWidthPx,
        )

        setSidebarWidthRatio(nextSidebarWidthPx / appShellWidthPx)
        return
      }

      const nextTagInputWidthPx = clamp(
        dividerStartTagInputWidthRef.current + deltaX,
        TAG_INPUT_MIN_WIDTH_PX,
        dividerStartMainWidthRef.current - SUGGESTED_MIN_WIDTH_PX,
      )

      setTagSplitRatio(nextTagInputWidthPx / dividerStartMainWidthRef.current)
    }

    const onPointerUp = () => {
      setActiveDividerDrag(null)
    }

    document.body.classList.add('splitter-dragging')
    window.addEventListener('mousemove', onPointerMove)
    window.addEventListener('mouseup', onPointerUp)

    return () => {
      document.body.classList.remove('splitter-dragging')
      window.removeEventListener('mousemove', onPointerMove)
      window.removeEventListener('mouseup', onPointerUp)
    }
  }, [activeDividerDrag, appShellWidthPx])

  const sortedNotes = useMemo(() => {
    return [...notes].sort((a, b) => b.updatedAtMs - a.updatedAtMs)
  }, [notes])

  const searchedNotes = useMemo(() => {
    return sortedNotes.filter((note) => matchesSearchQuery(note, searchQuery))
  }, [searchQuery, sortedNotes])

  const hasMonthFilter = selectedMonths.size > 0
  const hasYearFilter = selectedYears.size > 0
  const hasDateFilter = hasMonthFilter || hasYearFilter

  const dateEligibleNotes = useMemo(() => {
    return searchedNotes.filter((note) => {
      if (isDeletedNote(note)) {
        return false
      }
      if (isArchivedNote(note) && !hasDateFilter) {
        return false
      }
      return true
    })
  }, [hasDateFilter, searchedNotes])

  const categoryEligibleNotes = useMemo(() => {
    return dateEligibleNotes.filter((note) => !isExternalNote(note))
  }, [dateEligibleNotes])

  const archiveEligibleNotes = useMemo(() => {
    return searchedNotes.filter((note) => isArchivedNote(note) && !isDeletedNote(note) && !isExternalNote(note))
  }, [searchedNotes])

  const trashEligibleNotes = useMemo(() => {
    return searchedNotes.filter((note) => isDeletedNote(note) && !isExternalNote(note))
  }, [searchedNotes])

  const dateFilteredNotes = useMemo(() => {
    return dateEligibleNotes.filter((note) => {
      const date = new Date(note.updatedAtMs)
      const noteMonth = date.getMonth() + 1
      const noteYear = date.getFullYear()

      const monthMatch = !hasMonthFilter || selectedMonths.has(noteMonth)

      let yearMatch = !hasYearFilter
      if (hasYearFilter) {
        if (selectedYears.has(noteYear)) {
          yearMatch = true
        } else if (selectedYears.has('older') && noteYear <= 2021) {
          yearMatch = true
        }
      }

      return monthMatch && yearMatch
    })
  }, [dateEligibleNotes, hasMonthFilter, hasYearFilter, selectedMonths, selectedYears])

  const trashFilteredNotes = useMemo(() => {
    return trashEligibleNotes
  }, [trashEligibleNotes])

  const categoryTree = useMemo<PrimaryGroup[]>(() => {
    return buildHierarchyGroups(categoryEligibleNotes)
  }, [categoryEligibleNotes])

  const archiveTree = useMemo<PrimaryGroup[]>(() => {
    return buildHierarchyGroups(archiveEligibleNotes)
  }, [archiveEligibleNotes])

  const visibleNotes = useMemo(() => {
    if (sidebarMode === 'date') {
      return dateFilteredNotes
    }

    if (sidebarMode === 'trash') {
      return trashFilteredNotes
    }

    return []
  }, [dateFilteredNotes, sidebarMode, trashFilteredNotes])

  const totalPagedNotes = (sidebarMode === 'date' || sidebarMode === 'trash')
    ? visibleNotes.length
    : 0
  const totalPages = Math.max(1, Math.ceil(totalPagedNotes / Math.max(1, itemsPerPage)))
  const isSidebarTreeMode = sidebarMode === 'category' || sidebarMode === 'archive'

  const syncSidebarCustomScrollbar = useCallback(() => {
    if (!isSidebarTreeMode) {
      setSidebarScrollThumbHeightPx(0)
      setSidebarScrollThumbTopPx(0)
      setIsSidebarScrollThumbActive(false)
      return
    }

    const scroller = sidebarTreeScrollerEl
    const track = sidebarScrollbarTrackRef.current
    if (!scroller || !track) return

    const viewportHeight = scroller.clientHeight
    const contentHeight = scroller.scrollHeight
    const trackHeight = track.clientHeight
    const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2))
    if (viewportHeight <= 0 || contentHeight <= 0 || trackHeight <= 0) {
      setSidebarScrollThumbHeightPx(0)
      setSidebarScrollThumbTopPx(0)
      setIsSidebarScrollThumbActive(false)
      return
    }

    if (contentHeight <= viewportHeight) {
      setSidebarScrollThumbHeightPx(usableTrackHeight)
      setSidebarScrollThumbTopPx(SCROLL_TRACK_EDGE_GAP_PX)
      setIsSidebarScrollThumbActive(false)
      return
    }

    const visibleRatio = viewportHeight / contentHeight
    const nextThumbHeight = Math.max(
      SCROLL_TRACK_MIN_THUMB_HEIGHT_PX,
      Math.min(usableTrackHeight, Math.round(usableTrackHeight * visibleRatio)),
    )

    const maxScrollTop = contentHeight - viewportHeight
    const maxThumbTop = Math.max(0, usableTrackHeight - nextThumbHeight)
    const scrollRatio = maxScrollTop > 0 ? scroller.scrollTop / maxScrollTop : 0
    const nextThumbTop = SCROLL_TRACK_EDGE_GAP_PX + Math.round(maxThumbTop * scrollRatio)

    setSidebarScrollThumbHeightPx(nextThumbHeight)
    setSidebarScrollThumbTopPx(nextThumbTop)
    setIsSidebarScrollThumbActive(true)
  }, [isSidebarTreeMode, sidebarTreeScrollerEl])

  const sidebarScrollFromThumbTop = useCallback((thumbTopPx: number) => {
    const scroller = sidebarTreeScrollerEl
    const track = sidebarScrollbarTrackRef.current
    if (!scroller || !track) return

    const trackHeight = track.clientHeight
    const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2))
    const maxThumbTravel = Math.max(0, usableTrackHeight - sidebarScrollThumbHeightPx)
    const minThumbTop = SCROLL_TRACK_EDGE_GAP_PX
    const maxThumbTop = SCROLL_TRACK_EDGE_GAP_PX + maxThumbTravel
    const clampedTop = Math.max(minThumbTop, Math.min(thumbTopPx, maxThumbTop))
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    const ratio = maxThumbTravel > 0 ? (clampedTop - SCROLL_TRACK_EDGE_GAP_PX) / maxThumbTravel : 0
    scroller.scrollTop = ratio * maxScrollTop
  }, [sidebarScrollThumbHeightPx, sidebarTreeScrollerEl])

  const pagedVisibleNotes = useMemo(() => {
    if (sidebarMode !== 'date' && sidebarMode !== 'trash') {
      return visibleNotes
    }

    const startIndex = (currentPage - 1) * itemsPerPage
    return visibleNotes.slice(startIndex, startIndex + itemsPerPage)
  }, [currentPage, itemsPerPage, sidebarMode, visibleNotes])

  const handleMonthToggle = useCallback((month: number, event: MouseEvent<HTMLButtonElement>) => {
    handleMultiSelect(month, event, selectedMonths, FILTER_MONTHS, setSelectedMonths)
  }, [selectedMonths])

  const handleYearToggle = useCallback((year: number | 'older', event: MouseEvent<HTMLButtonElement>) => {
    handleMultiSelect(year, event, selectedYears, FILTER_YEARS, setSelectedYears)
  }, [selectedYears])

  const handleMonthRowContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    setSelectedMonths(new Set())
  }, [])

  const handleYearRowContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    setSelectedYears(new Set())
  }, [])

  useEffect(() => {
    setCurrentPage(1)
  }, [sidebarMode, selectedMonths, selectedYears, searchQuery])

  useEffect(() => {
    setDeleteArmedTagName(null)
  }, [activeNoteId, orderedActiveTags])

  useEffect(() => {
    const ITEM_HEIGHT = 56
    const ITEM_GAP = 8
    const ITEM_TOTAL = ITEM_HEIGHT + ITEM_GAP
    const PAGINATION_HEIGHT = 40

    const compute = () => {
      const container = sidebarContentRef.current
      if (!container) return

      const contentHeight = container.clientHeight
      let nextItemsPerPage = Math.floor(contentHeight / ITEM_TOTAL)
      if (nextItemsPerPage < 1) nextItemsPerPage = 1

      if (totalPagedNotes > nextItemsPerPage) {
        while (nextItemsPerPage > 1 && (nextItemsPerPage * ITEM_TOTAL + PAGINATION_HEIGHT) > contentHeight) {
          nextItemsPerPage -= 1
        }
      }

      if (nextItemsPerPage !== itemsPerPage) {
        setItemsPerPage(nextItemsPerPage)
      }

      const shouldShowPagination =
        (sidebarMode === 'date' || sidebarMode === 'trash') &&
        Math.ceil(totalPagedNotes / Math.max(1, nextItemsPerPage)) > 1

      setShowPagination(shouldShowPagination)
    }

    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [itemsPerPage, sidebarMode, totalPagedNotes])

  useEffect(() => {
    if (!isSidebarTreeMode) return
    syncSidebarCustomScrollbar()
  }, [isSidebarTreeMode, syncSidebarCustomScrollbar, sidebarMode, categoryTree, archiveTree])

  useEffect(() => {
    if (!isSidebarTreeMode || !sidebarTreeScrollerEl) return

    const onScroll = () => {
      syncSidebarCustomScrollbar()
    }

    sidebarTreeScrollerEl.addEventListener('scroll', onScroll, { passive: true })
    return () => sidebarTreeScrollerEl.removeEventListener('scroll', onScroll)
  }, [isSidebarTreeMode, sidebarTreeScrollerEl, syncSidebarCustomScrollbar])

  useEffect(() => {
    if (!isSidebarTreeMode || !sidebarTreeScrollerEl) return

    const scheduleSync = () => {
      if (sidebarScrollbarRafRef.current !== null) {
        cancelAnimationFrame(sidebarScrollbarRafRef.current)
      }

      sidebarScrollbarRafRef.current = requestAnimationFrame(() => {
        sidebarScrollbarRafRef.current = null
        syncSidebarCustomScrollbar()
      })
    }

    scheduleSync()

    const resizeObserver = new ResizeObserver(() => scheduleSync())
    resizeObserver.observe(sidebarTreeScrollerEl)

    const mutationObserver = new MutationObserver(() => scheduleSync())
    mutationObserver.observe(sidebarTreeScrollerEl, {
      subtree: true,
      childList: true,
      characterData: true,
    })

    return () => {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      if (sidebarScrollbarRafRef.current !== null) {
        cancelAnimationFrame(sidebarScrollbarRafRef.current)
        sidebarScrollbarRafRef.current = null
      }
    }
  }, [isSidebarTreeMode, sidebarTreeScrollerEl, syncSidebarCustomScrollbar])

  useEffect(() => {
    if (!isDraggingSidebarScrollThumb) return

    const onMouseMove = (event: globalThis.MouseEvent) => {
      const origin = sidebarScrollbarDragOriginRef.current
      if (!origin) return
      const deltaY = event.clientY - origin.pointerY
      sidebarScrollFromThumbTop(origin.thumbTopPx + deltaY)
      syncSidebarCustomScrollbar()
    }

    const onMouseUp = () => {
      setIsDraggingSidebarScrollThumb(false)
      sidebarScrollbarDragOriginRef.current = null
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDraggingSidebarScrollThumb, sidebarScrollFromThumbTop, syncSidebarCustomScrollbar])

  const handleSidebarTrackMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const track = sidebarScrollbarTrackRef.current
    if (!track) return

    const rect = track.getBoundingClientRect()
    const clickY = event.clientY - rect.top
    const targetThumbTop = clickY - (sidebarScrollThumbHeightPx / 2)
    sidebarScrollFromThumbTop(targetThumbTop)
    syncSidebarCustomScrollbar()
  }, [sidebarScrollFromThumbTop, sidebarScrollThumbHeightPx, syncSidebarCustomScrollbar])

  const handleSidebarThumbMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDraggingSidebarScrollThumb(true)
    sidebarScrollbarDragOriginRef.current = {
      pointerY: event.clientY,
      thumbTopPx: sidebarScrollThumbTopPx,
    }
  }, [sidebarScrollThumbTopPx])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void createNoteFromClipboardTitle()
        return
      }

      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void createNote()
        return
      }

      if (event.key === 'Escape') {
        if (searchQuery.trim().length > 0) {
          event.preventDefault()
          setSearchQuery('')
          return
        }

        if (sidebarMode !== 'date') {
          event.preventDefault()
          setSidebarMode('date')
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [createNote, createNoteFromClipboardTitle, searchQuery, sidebarMode])

  return (
    <div
      className="app-shell app-grid"
      ref={appShellRef}
      style={{ gridTemplateColumns: layout.gridTemplateColumns }}
    >
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
            const iconClassByMode: Record<SidebarMode, string> = {
              date: 'btn-date',
              category: 'btn-category',
              archive: 'btn-archived',
              trash: 'btn-deleted',
            }
            return (
              <button
                key={mode}
                className={`toggle-btn notes-mode-button icon-btn ${iconClassByMode[mode]}${isActive ? ' is-active' : ''}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                title={label}
                aria-label={label}
                onClick={() => setSidebarMode(mode)}
              >
                <span className="sr-only-mode-label">{label}</span>
              </button>
            )
          })}
        </div>

        <div className={`sidebar-scroll-frame${isSidebarTreeMode ? ' is-tree-mode' : ''}`}>
          <div
            className={`sidebar-content${(sidebarMode === 'date' || sidebarMode === 'trash') ? ' is-paged-mode' : ''}${isSidebarTreeMode ? ' is-tree-mode' : ''}`}
            ref={sidebarContentRef}
          >
            {(sidebarMode === 'date' || sidebarMode === 'trash') ? (
              <div className="notes-list date-view" role="listbox" aria-label="Note list">
                {pagedVisibleNotes.map((note) => {
                  const isActive = note.id === activeNoteId
                  return (
                    <NoteListItem
                      key={note.id}
                      note={note}
                      isActive={isActive}
                      onSelect={handleSelectNote}
                    />
                  )
                })}
                {pagedVisibleNotes.length === 0 ? (
                  <div className="notes-empty-state">
                    {searchQuery.trim()
                      ? 'No notes match the current search.'
                      : 'No notes match the current date filters.'}
                  </div>
                ) : null}
              </div>
            ) : (
              <div
                className="notes-list tree-view measly-custom-scrollbar"
                ref={setSidebarTreeScrollerEl}
              >
                <CategoryTreeView
                  groups={sidebarMode === 'category' ? categoryTree : archiveTree}
                  activeNoteId={activeNoteId}
                  onSelect={handleSelectNote}
                />
              </div>
            )}
          </div>

          {isSidebarTreeMode ? (
            <aside className="sidebar-scrollbar-slot" aria-hidden="true">
              <div className="sidebar-scrollbar-slot-inner">
                <div className="measly-scroll-rail sidebar-measly-scroll-rail">
                  <div
                    ref={sidebarScrollbarTrackRef}
                    className="measly-scroll-track"
                    onMouseDown={handleSidebarTrackMouseDown}
                  >
                    <div
                      className={`measly-scroll-thumb${isDraggingSidebarScrollThumb ? ' is-dragging' : ''}${isSidebarScrollThumbActive ? '' : ' is-inactive'}`}
                      style={{
                        top: `${sidebarScrollThumbTopPx}px`,
                        height: `${Math.max(0, sidebarScrollThumbHeightPx)}px`,
                      }}
                      onMouseDown={handleSidebarThumbMouseDown}
                    />
                  </div>
                </div>
              </div>
            </aside>
          ) : null}
        </div>

        {showPagination ? (
          <div className="sidebar-pagination" aria-label="Sidebar pagination">
            <button
              type="button"
              className="sidebar-page-btn"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((previous) => Math.max(1, previous - 1))}
            >
              &lt;
            </button>
            <span className="sidebar-page-number">{currentPage}</span>
            <button
              type="button"
              className="sidebar-page-btn"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((previous) => Math.min(totalPages, previous + 1))}
            >
              &gt;
            </button>
          </div>
        ) : null}

        {(sidebarMode === 'date' || sidebarMode === 'trash') ? (
          <div className="date-filter-rail" aria-label="Date filters">
            <div
              className="date-filter-line"
              onContextMenu={handleMonthRowContextMenu}
            >
              {FILTER_MONTHS.map((month) => (
                <button
                  key={month}
                  type="button"
                  className={`date-filter-chip${selectedMonths.has(month) ? ' is-active' : ''}`}
                  onClick={(event) => handleMonthToggle(month, event)}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  {month}
                </button>
              ))}
            </div>
            <div
              className="date-filter-line"
              onContextMenu={handleYearRowContextMenu}
            >
              {FILTER_YEARS.map((year) => (
                <button
                  key={year}
                  type="button"
                  className={`date-filter-chip${selectedYears.has(year) ? ' is-active' : ''}`}
                  onClick={(event) => handleYearToggle(year, event)}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  {year === 'older' ? 'Older' : year}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </aside>

      <div
        className={`grid-divider divider-sidebar divider-handle${activeDividerDrag === 'sidebar' ? ' is-dragging' : ''}`}
        style={{ gridArea: 'd-sidebar' }}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={(event) => handleDividerMouseDown('sidebar', event)}
      />

      <section className="tag-input-grid" style={{ gridArea: 'taginput' }} aria-label="Tag input manager">
        <div className="tag-input-container">
          <div className="tag-input-section">
            <div className="tag-input-bar">
              <div className="tag-input-wrapper">
                <input
                  className="tag-input"
                  type="text"
                  value={tagInputValue}
                  placeholder={
                    !activeNoteId
                      ? (notes.length > 0 ? 'Select a note to edit tags.' : 'Once you have created a note, you can add tags here.')
                      : (renamingTagName ? 'Rename tag and press Enter...' : 'Type to add tag...')
                  }
                  onChange={(event) => setTagInputValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      handleTagInputEnter()
                    }
                    if (event.key === 'Escape' && renamingTagName) {
                      event.preventDefault()
                      setRenamingTagName(null)
                      setTagInputValue('')
                    }
                  }}
                  disabled={!persistenceReady || !activeNoteId || isTagMutationPending || activeNoteIsExternal}
                  aria-label="Tag input"
                />
              </div>
            </div>

            <div className="tags-display" aria-live="polite">
              {!activeNoteId ? (
                <div className="tag-empty-state">Tags appear here. Drag to change order, left click to remove or right click to rename across all notes.</div>
              ) : orderedActiveTags.length === 0 ? (
                <div className="tag-empty-state">No tags on active note.</div>
              ) : (
                orderedActiveTags.map((tagName, index) => {
                  const normalized = normalizeTagName(tagName)
                  const isProtected = isProtectedTagName(tagName)
                  return (
                    <div
                      key={tagName}
                      className={`tag-pill active${deleteArmedTagName === tagName ? ' armed' : ''}${isProtected ? ` protected ${normalized}` : ''}`}
                      draggable={!isProtected}
                      onDragStart={() => handleTagDragStart(index)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => handleTagDrop(event, index)}
                      onClick={() => handleTagChipClick(tagName)}
                      onContextMenu={(event) => handleTagContextMenu(event, tagName)}
                      onMouseLeave={() => handleTagChipMouseLeave(tagName)}
                      title={deleteArmedTagName === tagName ? 'Click again to delete or move cursor away to cancel' : 'Click to arm deletion'}
                    >
                      {tagName}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </section>

      <div
        className={`grid-divider divider-left divider-handle${activeDividerDrag === 'tag-split' ? ' is-dragging' : ''}`}
        style={{ gridArea: 'd-left' }}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize tag panels"
        onMouseDown={(event) => handleDividerMouseDown('tag-split', event)}
      />

      <section className="suggested-grid" style={{ gridArea: 'suggested' }} aria-label="Suggested tags panel">
        <div className="suggested-tags" aria-hidden={suggestedTags.length === 0}>
          {suggestedTags.map((tagName) => (
            <div
              key={tagName}
              className="tag-pill suggested"
              onClick={() => handleAddSuggestedTag(tagName)}
              title={`Add ${tagName}`}
              aria-disabled={!activeNoteId || isTagMutationPending || activeNoteIsExternal}
            >
              {tagName}
            </div>
          ))}
          {suggestedTags.length === 0 ? (
            <div className="suggested-empty">
              {activeNoteId
                ? ''
                : 'Tags you have used before will appear here. Click them to quickly assign them to your current note. If a tag is no longer in use, it will disappear from this list.'}
            </div>
          ) : null}
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

      <div className="editor-viewer-frame" style={{ gridArea: 'viewer' }}>
        <main className="editor-shell">
          <div className="editor-stage">
            <Editor
              bindings={bindings}
              adapterRef={adapterRef}
              initialText={activeNoteText}
              scrollbarHost={scrollbarHostEl}
            />
          </div>
        </main>
        <aside className="editor-scrollbar-slot" aria-hidden="true">
          <div className="editor-scrollbar-slot-inner" ref={setScrollbarHostEl} />
        </aside>
      </div>
    </div>
  )
}

export default App


