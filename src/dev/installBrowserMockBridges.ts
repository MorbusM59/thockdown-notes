import type { AppState, AppStateApi, WindowState } from '../shared/appState'
import type { UiLayoutLoadout, UiLoadoutApi, UiLoadoutEntry, UiLoadoutListResult, UiLoadoutMode } from '../shared/loadouts'
import {
  idKind,
  idMode,
  modeSign,
  LOADOUT_DEFAULT_CUSTOM_ID_ABS,
  LOADOUT_PENDING_ID_ABS,
  LOADOUT_FIRST_CUSTOM_ID_ABS,
} from '../shared/loadouts'
import {
  LIGHT_FACTORY_PRESETS,
  DARK_FACTORY_PRESETS,
  DEFAULT_CUSTOM_LIGHT,
  DEFAULT_CUSTOM_DARK,
} from '../shared/presets'
import type { TextureCacheApi, TextureCacheHit, TextureCachePurgeRequest, TextureCacheRequest } from '../shared/textures'
import type { FileSyncApi } from '../shared/fileSync'
import type {
  AddTagInput,
  CreateNoteInput,
  DeleteNoteInput,
  LoadNoteInput,
  NoteDocument,
  NoteLifecycleApi,
  NoteSummary,
  NoteTagsInput,
  NoteUiState,
  NoteUiStatePayload,
  RemoveTagInput,
  RenameTagInput,
  ReorderTagsInput,
  SaveNoteInput,
  TagSummary,
} from '../shared/noteLifecycle'
import type { NoteTabEntry, NoteTabsApi } from '../shared/tabs'
import type { EditorSectionEntry, EditorSectionsApi } from '../shared/sections'
import { DEFAULT_EDITOR_SECTION_ID } from '../shared/sections'
import type { ChapterEntry, ChaptersApi } from '../shared/chapters'
import type { ReviewFlagEntry, ReviewFlagsApi } from '../shared/reviewFlags'
import { normalizeChapterHeadings } from '../shared/markdownHeadings'
import { resolveIdentityLabel } from '../shared/tabLabels'
import { computeHeadingAnchors, formatHeadingAnchorFragment, formatOutlineEntryLine } from '../shared/tableOfContentsText'
import { formatInternalNoteLink } from '../shared/internalNoteLinks'
import { deriveDefaultAssignedIdBase, normalizeAssignedIdInput } from '../shared/assignedIds'
import { assembleOpenItemsText, buildOpenItemsGroupMarkdown, checklistStateChanged, parseOpenItemsGroups } from '../shared/openItemsText'

const MOCK_STORAGE_KEY = 'thockdown-notes:browser-mock:v1'

type BrowserMockStore = {
  notes: NoteDocument[]
  noteUiStates: Record<string, NoteUiState>
  /** Mirrors databaseService.ts's note_snapshots.anchorBlockIndex -- keyed by the synthetic snapshot id saveNoteSnapshot returns (see its own doc comment: the browser mock doesn't persist snapshot history, so this is a best-effort mirror only). */
  snapshotAnchors: Record<number, number>
  appState: AppState
  windowState: WindowState
  uiLoadoutEntries: UiLoadoutEntry[]
  lastCustomIdByMode: { light: number; dark: number }
  textureCache: Record<string, { mimeType: string; dataBase64: string; createdAt: number }>
  noteTabs: NoteTabEntry[]
  editorSections: EditorSectionEntry[]
  chapters: ChapterEntry[]
  reviewFlags: ReviewFlagEntry[]
  nextReviewFlagId: number
}

type BrowserMockWindow = Window & {
  __thockdownBrowserMockInstalled?: boolean
  thockdownFileSync?: FileSyncApi
}

const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1200,
  height: 800,
  isMaximized: false,
}

const DEFAULT_APP_STATE: AppState = {
  selectedNoteId: null,
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function deriveTitle(text: string): string {
  const firstLine = (text.split('\n')[0] ?? '').trim()
  if (!firstLine) return 'Untitled'
  return firstLine.replace(/^#+\s*/, '').trim() || 'Untitled'
}

function normalizeDocument(note: NoteDocument): NoteDocument {
  const text = typeof note.text === 'string' ? note.text : ''
  const createdAtMs = Number.isFinite(note.createdAtMs) ? note.createdAtMs : Date.now()
  const updatedAtMs = Number.isFinite(note.updatedAtMs) ? note.updatedAtMs : createdAtMs
  const tags = Array.isArray(note.tags)
    ? note.tags.map((tag) => String(tag).trim()).filter((tag) => tag.length > 0)
    : []
  return {
    id: String(note.id),
    fileName: note.fileName || `${String(note.id)}.md`,
    title: deriveTitle(text),
    tags,
    createdAtMs,
    updatedAtMs,
    sizeBytes: text.length,
    text,
    chapterOnly: Boolean(note.chapterOnly),
    isAutoToc: Boolean(note.isAutoToc),
    isAutoOpenItems: Boolean(note.isAutoOpenItems),
    chapterParentId: note.chapterParentId ?? null,
  }
}

function toSummary(note: NoteDocument): NoteSummary {
  return {
    id: note.id,
    fileName: note.fileName,
    title: note.title,
    tags: [...note.tags],
    createdAtMs: note.createdAtMs,
    updatedAtMs: note.updatedAtMs,
    sizeBytes: note.sizeBytes,
    assignedId: note.assignedId ?? null,
    chapterOnly: Boolean(note.chapterOnly),
    isAutoToc: Boolean(note.isAutoToc),
    isAutoOpenItems: Boolean(note.isAutoOpenItems),
    chapterParentId: note.chapterParentId ?? null,
    // The real app derives this from the on-disk file minus any legacy
    // metadata header (readSummary in noteLifecycleService.ts); the mock has
    // no such header, so the live text itself already is the content text.
    // Needed for internal `$id#anchor-id` link navigation (and now
    // `§chapter-id`) to find anchor definitions -- without this, every such
    // link silently no-ops in the browser mock regardless of whether the
    // anchor actually exists.
    contentText: note.text,
  }
}

/** A fresh install always starts with exactly one (default, unnamed) section. */
function createDefaultEditorSections(): EditorSectionEntry[] {
  return [{ id: DEFAULT_EDITOR_SECTION_ID, name: null, position: 0, widthFraction: null, fixedWidthPx: null, lastActiveNoteId: null, noteSlotInitialized: false }]
}

function sortNotesDesc(notes: NoteDocument[]): NoteDocument[] {
  return notes
    .slice()
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs || b.createdAtMs - a.createdAtMs || a.id.localeCompare(b.id))
}

function resolveUniqueAssignedId(notes: NoteDocument[], requestedBase: string, excludeNoteId: string): string {
  const used = new Set(
    notes.filter((note) => note.id !== excludeNoteId && note.assignedId).map((note) => note.assignedId as string),
  )
  if (!used.has(requestedBase)) return requestedBase

  let attempt = 2
  while (used.has(`${requestedBase}-${attempt}`)) {
    attempt += 1
  }
  return `${requestedBase}-${attempt}`
}

function createId(): string {
  const now = Date.now()
  const stamp = new Date(now).toISOString().slice(2, 16).replace(/[-:T]/g, '').replace(/\./g, '')
  const rand = Math.random().toString(36).slice(2, 10)
  return `${stamp}_${rand}`
}

function toBase64(data: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < data.length; i += 1) {
    binary += String.fromCharCode(data[i])
  }
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

function serializeTextureKey(request: TextureCacheRequest): string {
  return JSON.stringify(request)
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
  return `{${entries.join(',')}}`
}

function seedUiLoadoutEntries(): { entries: UiLoadoutEntry[]; lastCustomIdByMode: { light: number; dark: number } } {
  const now = Date.now()
  const entries: UiLoadoutEntry[] = []

  const push = (id: number, payload: UiLayoutLoadout, isActive: boolean) => {
    entries.push({ id, isActive, signature: stableStringify(payload), payload: clone(payload), updatedAt: now })
  }

  LIGHT_FACTORY_PRESETS.forEach((preset, index) => push(index + 1, preset, false))
  DARK_FACTORY_PRESETS.forEach((preset, index) => push(-(index + 1), preset, false))

  push(LOADOUT_DEFAULT_CUSTOM_ID_ABS, DEFAULT_CUSTOM_LIGHT, true)
  push(-LOADOUT_DEFAULT_CUSTOM_ID_ABS, DEFAULT_CUSTOM_DARK, true)

  push(LOADOUT_PENDING_ID_ABS, DEFAULT_CUSTOM_LIGHT, false)
  push(-LOADOUT_PENDING_ID_ABS, DEFAULT_CUSTOM_DARK, false)

  return {
    entries,
    lastCustomIdByMode: { light: LOADOUT_DEFAULT_CUSTOM_ID_ABS, dark: -LOADOUT_DEFAULT_CUSTOM_ID_ABS },
  }
}

function loadStore(): BrowserMockStore {
  try {
    const raw = window.localStorage.getItem(MOCK_STORAGE_KEY)
    if (!raw) {
      const seeded = seedUiLoadoutEntries()
      return {
        notes: [],
        noteUiStates: {},
        snapshotAnchors: {},
        appState: clone(DEFAULT_APP_STATE),
        windowState: clone(DEFAULT_WINDOW_STATE),
        uiLoadoutEntries: seeded.entries,
        lastCustomIdByMode: seeded.lastCustomIdByMode,
        textureCache: {},
        noteTabs: [],
        editorSections: createDefaultEditorSections(),
        chapters: [],
        reviewFlags: [],
        nextReviewFlagId: 1,
      }
    }

    const parsed = JSON.parse(raw) as Partial<BrowserMockStore>
    const notes = Array.isArray(parsed.notes)
      ? parsed.notes.map((note) => normalizeDocument(note as NoteDocument))
      : []

    const noteUiStates = typeof parsed.noteUiStates === 'object' && parsed.noteUiStates !== null
      ? Object.fromEntries(
          Object.entries(parsed.noteUiStates as Record<string, NoteUiState>)
            .map(([key, value]) => [key, {
              anchorBlockIndex: value?.anchorBlockIndex ?? 0,
              cursorPos: value?.cursorPos ?? 0,
              previewBlockCache: value?.previewBlockCache ?? null,
            }]),
        )
      : {}

    const snapshotAnchors = typeof parsed.snapshotAnchors === 'object' && parsed.snapshotAnchors !== null
      ? Object.fromEntries(
          Object.entries(parsed.snapshotAnchors as Record<string, number>)
            .map(([key, value]) => [key, Number.isFinite(value) ? Number(value) : 0]),
        )
      : {}

    return {
      notes,
      noteUiStates,
      snapshotAnchors,
      appState: parsed.appState && typeof parsed.appState === 'object'
        ? clone(parsed.appState as AppState)
        : clone(DEFAULT_APP_STATE),
      windowState: parsed.windowState && typeof parsed.windowState === 'object'
        ? {
            ...DEFAULT_WINDOW_STATE,
            ...(parsed.windowState as WindowState),
          }
        : clone(DEFAULT_WINDOW_STATE),
      uiLoadoutEntries: Array.isArray(parsed.uiLoadoutEntries) && parsed.uiLoadoutEntries.length > 0
        ? clone(parsed.uiLoadoutEntries as UiLoadoutEntry[])
        : seedUiLoadoutEntries().entries,
      lastCustomIdByMode: parsed.lastCustomIdByMode && typeof parsed.lastCustomIdByMode === 'object'
        ? clone(parsed.lastCustomIdByMode as { light: number; dark: number })
        : seedUiLoadoutEntries().lastCustomIdByMode,
      textureCache: parsed.textureCache && typeof parsed.textureCache === 'object'
        ? Object.entries(parsed.textureCache as Record<string, { mimeType: string; dataBase64: string; createdAt?: number }>).reduce((acc, [key, value]) => {
            if (!value || typeof value !== 'object') return acc
            acc[key] = {
              mimeType: typeof value.mimeType === 'string' ? value.mimeType : 'image/webp',
              dataBase64: typeof value.dataBase64 === 'string' ? value.dataBase64 : '',
              createdAt: Number.isFinite(value.createdAt) ? Number(value.createdAt) : Date.now(),
            }
            return acc
          }, {} as Record<string, { mimeType: string; dataBase64: string; createdAt: number }>)
        : {},
      noteTabs: Array.isArray(parsed.noteTabs)
        ? (parsed.noteTabs as NoteTabEntry[])
            .filter((entry) => typeof entry?.noteId === 'string')
            .map((entry, index) => ({
              sectionId: typeof entry.sectionId === 'string' ? entry.sectionId : DEFAULT_EDITOR_SECTION_ID,
              noteId: entry.noteId,
              position: Number.isFinite(entry.position) ? entry.position : index,
              addedAtMs: Number.isFinite(entry.addedAtMs) ? entry.addedAtMs : Date.now(),
              lastActiveChapterNoteId: typeof entry.lastActiveChapterNoteId === 'string' ? entry.lastActiveChapterNoteId : null,
            }))
        : [],
      editorSections: Array.isArray(parsed.editorSections) && parsed.editorSections.length > 0
        ? (parsed.editorSections as EditorSectionEntry[])
            .filter((entry) => typeof entry?.id === 'string')
            .map((entry, index) => ({
              id: entry.id,
              name: typeof entry.name === 'string' ? entry.name : null,
              // Distinguish "genuinely parked" (null) from malformed/missing
              // data (fall back to index) -- Number.isFinite(null) is false,
              // so a naive fallback would force every parked section back
              // into a visible slot on every reload.
              position: entry.position === null ? null : (Number.isFinite(entry.position) ? entry.position : index),
              widthFraction: Number.isFinite(entry.widthFraction) ? entry.widthFraction : null,
              fixedWidthPx: Number.isFinite(entry.fixedWidthPx) ? entry.fixedWidthPx : null,
              lastActiveNoteId: typeof entry.lastActiveNoteId === 'string' ? entry.lastActiveNoteId : null,
              noteSlotInitialized: entry.noteSlotInitialized === true,
            }))
        : createDefaultEditorSections(),
      chapters: Array.isArray(parsed.chapters)
        ? (parsed.chapters as ChapterEntry[])
            .filter((entry) => typeof entry?.parentNoteId === 'string' && typeof entry?.chapterNoteId === 'string')
            .map((entry, index) => ({
              parentNoteId: entry.parentNoteId,
              chapterNoteId: entry.chapterNoteId,
              position: Number.isFinite(entry.position) ? entry.position : index,
              chapterId: typeof entry.chapterId === 'string' ? entry.chapterId : null,
            }))
        : [],
      reviewFlags: Array.isArray(parsed.reviewFlags)
        ? (parsed.reviewFlags as ReviewFlagEntry[])
            .filter((entry) => typeof entry?.noteId === 'string' && Number.isFinite(entry?.id))
            .map((entry) => ({
              id: entry.id,
              noteId: entry.noteId,
              lineNumber: Number.isFinite(entry.lineNumber) ? entry.lineNumber : 1,
              severity: entry.severity === 'warning' ? 'warning' : 'review',
              lineHash: typeof entry.lineHash === 'string' ? entry.lineHash : '',
            }))
        : [],
      nextReviewFlagId: Number.isFinite(parsed.nextReviewFlagId) ? Number(parsed.nextReviewFlagId) : 1,
    }
  } catch {
    const seeded = seedUiLoadoutEntries()
    return {
      notes: [],
      noteUiStates: {},
      snapshotAnchors: {},
      appState: clone(DEFAULT_APP_STATE),
      windowState: clone(DEFAULT_WINDOW_STATE),
      uiLoadoutEntries: seeded.entries,
      lastCustomIdByMode: seeded.lastCustomIdByMode,
      textureCache: {},
      noteTabs: [],
      editorSections: createDefaultEditorSections(),
      chapters: [],
      reviewFlags: [],
      nextReviewFlagId: 1,
    }
  }
}

function persistStore(store: BrowserMockStore): void {
  window.localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(store))
}

function buildNotesBridge(storeRef: { current: BrowserMockStore }): NoteLifecycleApi {
  const getById = (id: string): NoteDocument | undefined => storeRef.current.notes.find((note) => note.id === id)

  const mutate = <T,>(transform: (store: BrowserMockStore) => T): T => {
    const result = transform(storeRef.current)
    persistStore(storeRef.current)
    return result
  }

  return {
    async listNotes(): Promise<NoteSummary[]> {
      return sortNotesDesc(storeRef.current.notes).map((note) => toSummary(note))
    },

    async loadNote(input: LoadNoteInput): Promise<NoteDocument> {
      const note = getById(input.id)
      if (!note) {
        throw new Error(`Note not found: ${input.id}`)
      }
      return clone(note)
    },

    async createNote(input?: CreateNoteInput): Promise<NoteDocument> {
      return mutate((store) => {
        const now = Date.now()
        const id = createId()
        const text = typeof input?.initialText === 'string' ? input.initialText : '# '
        const created: NoteDocument = normalizeDocument({
          id,
          fileName: `${id}.md`,
          title: '',
          tags: [],
          createdAtMs: now,
          updatedAtMs: now,
          sizeBytes: 0,
          text,
          chapterOnly: false,
          isAutoToc: false,
          isAutoOpenItems: false,
          chapterParentId: null,
        })
        store.notes.push(created)
        return clone(created)
      })
    },

    async saveNote(input: SaveNoteInput): Promise<NoteSummary> {
      return mutate((store) => {
        const note = store.notes.find((entry) => entry.id === input.id)
        if (!note) {
          throw new Error(`Note not found: ${input.id}`)
        }
        const oldText = note.text
        note.text = input.text
        note.updatedAtMs = Date.now()
        note.sizeBytes = input.text.length
        note.title = deriveTitle(input.text)

        // Mirrors noteLifecycleService.ts's saveNote checklist-diff hook --
        // only ever regenerates the auto-Open-Items chapter's affected group
        // on the two events it's meant to update on (see
        // checklistStateChanged's own doc comment), never on a plain text
        // edit. Auto-generated chapters are excluded: the Open Items
        // chapter's own text is made of literal `- [ ] ...` lines, and
        // diffing those against themselves would regenerate the very group
        // that was just written.
        if (!note.isAutoToc && !note.isAutoOpenItems && checklistStateChanged(oldText, input.text)) {
          const familyParentId = note.chapterParentId
            ?? (store.chapters.some((chapter) => chapter.parentNoteId === note.id) ? note.id : null)
          if (familyParentId) {
            regenerateOpenItemsGroupInStore(store, familyParentId, note.id)
          }
        }

        // Mirrors databaseService.ts's upsertNoteContent COALESCE semantics:
        // piggybacked cursor position, only written when the caller actually
        // provided one, never clobbered by callers that don't. Scroll
        // position (anchorBlockIndex) is not piggybacked here -- see
        // saveNoteUiState.
        if (input.cursorPos != null || input.previewBlockCache != null) {
          const previousState = store.noteUiStates[input.id] ?? {
            anchorBlockIndex: 0,
            cursorPos: 0,
            previewBlockCache: null,
          }
          store.noteUiStates[input.id] = {
            ...previousState,
            cursorPos: input.cursorPos != null ? input.cursorPos : previousState.cursorPos,
            previewBlockCache: input.previewBlockCache != null ? input.previewBlockCache : previousState.previewBlockCache,
          }
        }

        return clone(toSummary(note))
      })
    },

    async saveNoteUiState(input: { id: string; payload: NoteUiStatePayload }): Promise<void> {
      return mutate((store) => {
        const previousState = store.noteUiStates[input.id] ?? {
          anchorBlockIndex: 0,
          cursorPos: 0,
          previewBlockCache: null,
        }

        const nextState: NoteUiState = {
          ...previousState,
          anchorBlockIndex: Object.prototype.hasOwnProperty.call(input.payload, 'anchorBlockIndex') ? input.payload.anchorBlockIndex ?? 0 : previousState.anchorBlockIndex,
          cursorPos: Object.prototype.hasOwnProperty.call(input.payload, 'cursorPos') ? input.payload.cursorPos ?? 0 : previousState.cursorPos,
          previewBlockCache: Object.prototype.hasOwnProperty.call(input.payload, 'previewBlockCache') ? input.payload.previewBlockCache ?? null : previousState.previewBlockCache,
        }

        store.noteUiStates[input.id] = nextState
      })
    },

    async getNoteUiState(input: LoadNoteInput): Promise<NoteUiState> {
      return storeRef.current.noteUiStates[input.id] ?? {
        anchorBlockIndex: 0,
        cursorPos: 0,
        previewBlockCache: null,
      }
    },

    async updateExternalNoteState(input: { id: string; hasUnsavedChanges: boolean; syncMode: boolean }): Promise<NoteSummary> {
      const note = getById(input.id)
      if (!note) {
        throw new Error(`Note not found: ${input.id}`)
      }
      return clone(toSummary(note))
    },

    async syncExternalNoteToFile(_input: { id: string; content: string }): Promise<boolean> {
      return true
    },

    async getNoteIdByExternalPath(input: { externalPath: string }): Promise<string | null> {
      const note = storeRef.current.notes.find((note) => note.externalPath === input.externalPath)
      return note?.id ?? null
    },

    async saveNoteSnapshot(_input: { id: string; content: string; isManual?: boolean }): Promise<number> {
      // Browser mock does not persist snapshots; synthesize an ID so callers
      // that need one (e.g. freeze-on-hibernate) still get a valid contract.
      return Date.now()
    },

    async getNoteSnapshots(_input: LoadNoteInput): Promise<Array<{ id: number; noteId: string; content: string; timestamp: string; isManual: boolean }>> {
      return []
    },

    async deleteNoteSnapshot(_input: { snapshotId: number }): Promise<void> {
      // Browser mock does not persist snapshots.
      return
    },

    async saveSnapshotAnchor(input: { snapshotId: number; anchorBlockIndex: number | null }): Promise<void> {
      // Browser mock has no real snapshot rows to attach this to (see
      // saveNoteSnapshot above), but still tracks it in-memory by the
      // synthetic id so a same-session round trip behaves consistently.
      return mutate((store) => {
        store.snapshotAnchors[input.snapshotId] = input.anchorBlockIndex ?? 0
      })
    },

    async getSnapshotAnchor(input: { snapshotId: number }): Promise<number> {
      return storeRef.current.snapshotAnchors[input.snapshotId] ?? 0
    },

    async branchNoteFromSnapshot(_input: { sourceNoteId: string; snapshotId: number }): Promise<NoteDocument> {
      // Browser mock has no real snapshot history to branch from (see getNoteSnapshots above).
      throw new Error('Branching from a snapshot is only available in the desktop app.')
    },

    async setNoteAssignedId(input: { id: string; requestedId: string }): Promise<NoteSummary | null> {
      return mutate((store) => {
        const note = store.notes.find((entry) => entry.id === input.id)
        if (!note) return null
        const base = normalizeAssignedIdInput(input.requestedId) || deriveDefaultAssignedIdBase(note.title)
        note.assignedId = resolveUniqueAssignedId(store.notes, base, note.id)
        return clone(toSummary(note))
      })
    },

    async deleteNote(input: DeleteNoteInput): Promise<void> {
      mutate((store) => {
        // Chapters have no life outside their parent -- deleting a parent
        // note deletes its chapters with it (one level only; chapters can't
        // have sub-chapters). Mirrors databaseService.ts's deleteNote.
        const chapterNoteIds = store.chapters
          .filter((chapter) => chapter.parentNoteId === input.id)
          .map((chapter) => chapter.chapterNoteId)
        const idsToDelete = new Set([input.id, ...chapterNoteIds])

        store.notes = store.notes.filter((note) => !idsToDelete.has(note.id))
        store.chapters = store.chapters.filter((chapter) => !idsToDelete.has(chapter.parentNoteId) && !idsToDelete.has(chapter.chapterNoteId))
        if (store.appState.selectedNoteId && idsToDelete.has(store.appState.selectedNoteId)) {
          store.appState.selectedNoteId = null
        }
        store.noteTabs = store.noteTabs.filter((tab) => !idsToDelete.has(tab.noteId))
      })
    },

    async getNoteTags(input: NoteTagsInput): Promise<string[]> {
      const note = getById(input.id)
      if (!note) {
        throw new Error(`Note not found: ${input.id}`)
      }
      return [...note.tags]
    },

    async addTagToNote(input: AddTagInput): Promise<string[]> {
      return mutate((store) => {
        const note = store.notes.find((entry) => entry.id === input.id)
        if (!note) {
          throw new Error(`Note not found: ${input.id}`)
        }
        const tag = input.tagName.trim()
        if (!tag) {
          return [...note.tags]
        }
        const next = note.tags.filter((entry) => entry !== tag)
        const desiredPosition = Number.isFinite(input.position) ? Math.floor(input.position) : next.length
        const position = Math.max(0, Math.min(next.length, desiredPosition))
        next.splice(position, 0, tag)
        note.tags = next
        note.updatedAtMs = Date.now()
        return [...note.tags]
      })
    },

    async removeTagFromNote(input: RemoveTagInput): Promise<string[]> {
      return mutate((store) => {
        const note = store.notes.find((entry) => entry.id === input.id)
        if (!note) {
          throw new Error(`Note not found: ${input.id}`)
        }
        note.tags = note.tags.filter((tag) => tag !== input.tagName)
        note.updatedAtMs = Date.now()
        return [...note.tags]
      })
    },

    async reorderNoteTags(input: ReorderTagsInput): Promise<string[]> {
      return mutate((store) => {
        const note = store.notes.find((entry) => entry.id === input.id)
        if (!note) {
          throw new Error(`Note not found: ${input.id}`)
        }
        note.tags = [...new Set(input.tagNames.map((tag) => tag.trim()).filter((tag) => tag.length > 0))]
        note.updatedAtMs = Date.now()
        return [...note.tags]
      })
    },

    async renameTag(input: RenameTagInput): Promise<{ updatedNoteIds: string[] }> {
      return mutate((store) => {
        const fromName = input.fromName.trim()
        const toName = input.toName.trim()
        if (!fromName || !toName || fromName === toName) {
          return { updatedNoteIds: [] }
        }

        const updatedNoteIds: string[] = []
        for (const note of store.notes) {
          if (!note.tags.includes(fromName)) {
            continue
          }
          note.tags = [...new Set(note.tags.map((tag) => (tag === fromName ? toName : tag)))]
          note.updatedAtMs = Date.now()
          updatedNoteIds.push(note.id)
        }
        return { updatedNoteIds }
      })
    },

    async listTags(): Promise<TagSummary[]> {
      const usage = new Map<string, number>()
      for (const note of storeRef.current.notes) {
        for (const tag of note.tags) {
          usage.set(tag, (usage.get(tag) ?? 0) + 1)
        }
      }
      return Array.from(usage.entries())
        .map(([name, usageCount]) => ({ name, usageCount }))
        .sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name))
    },
  }
}

function buildStateBridge(storeRef: { current: BrowserMockStore }): AppStateApi {
  const mutate = <T,>(transform: (store: BrowserMockStore) => T): T => {
    const result = transform(storeRef.current)
    persistStore(storeRef.current)
    return result
  }

  return {
    async loadAppState(): Promise<AppState> {
      return clone(storeRef.current.appState)
    },

    async saveAppState(state: AppState): Promise<void> {
      mutate((store) => {
        store.appState = clone(state)
      })
    },

    async loadWindowState(): Promise<WindowState> {
      return clone(storeRef.current.windowState)
    },

    async saveWindowState(state: WindowState): Promise<void> {
      mutate((store) => {
        store.windowState = {
          ...DEFAULT_WINDOW_STATE,
          ...clone(state),
        }
      })
    },
  }
}

function buildTextureBridge(storeRef: { current: BrowserMockStore }): TextureCacheApi {
  const mutate = <T,>(transform: (store: BrowserMockStore) => T): T => {
    const result = transform(storeRef.current)
    persistStore(storeRef.current)
    return result
  }

  return {
    async getCachedTexture(request: TextureCacheRequest): Promise<TextureCacheHit | null> {
      const key = serializeTextureKey(request)
      const entry = storeRef.current.textureCache[key]
      if (!entry) return null
      entry.createdAt = Date.now()
      persistStore(storeRef.current)
      return {
        mimeType: entry.mimeType,
        data: fromBase64(entry.dataBase64),
      }
    },

    async saveCachedTexture(request: TextureCacheRequest, payload: TextureCacheHit): Promise<void> {
      mutate((store) => {
        const key = serializeTextureKey(request)
        store.textureCache[key] = {
          mimeType: payload.mimeType,
          dataBase64: toBase64(payload.data),
          createdAt: Date.now(),
        }
      })
    },

    async purgeCachedTextures(request?: TextureCachePurgeRequest): Promise<number> {
      return mutate((store) => {
        const keepSet = new Set((request?.keep ?? []).map((item) => serializeTextureKey(item)))
        const maxEntries = Math.max(0, Math.floor(request?.maxEntries ?? 96))
        const maxAgeMs = Math.max(0, Math.floor(request?.maxAgeMs ?? 1000 * 60 * 60 * 24 * 14))
        const cutoff = Date.now() - maxAgeMs

        const entries = Object.entries(store.textureCache)
          .map(([key, value]) => ({ key, ...value }))
          .sort((a, b) => b.createdAt - a.createdAt)

        let retained = 0
        let deleted = 0
        for (const entry of entries) {
          const isProtected = keepSet.has(entry.key)
          const isExpired = entry.createdAt < cutoff
          const exceedsCap = maxEntries > 0 && retained >= maxEntries
          if (!isProtected && (isExpired || exceedsCap)) {
            delete store.textureCache[entry.key]
            deleted += 1
            continue
          }
          retained += 1
        }

        return deleted
      })
    },
  }
}

function buildLoadoutBridge(storeRef: { current: BrowserMockStore }): UiLoadoutApi {
  const mutate = <T,>(transform: (store: BrowserMockStore) => T): T => {
    const result = transform(storeRef.current)
    persistStore(storeRef.current)
    return result
  }

  const snapshot = (store: BrowserMockStore): UiLoadoutListResult => ({
    entries: clone(store.uiLoadoutEntries),
    lastCustomIdByMode: clone(store.lastCustomIdByMode),
  })

  const findEntry = (store: BrowserMockStore, id: number) =>
    store.uiLoadoutEntries.find((entry) => entry.id === id)

  const deactivateMode = (store: BrowserMockStore, sign: 1 | -1) => {
    store.uiLoadoutEntries.forEach((entry) => {
      if (entry.id * sign > 0) entry.isActive = false
    })
  }

  return {
    async list(): Promise<UiLoadoutListResult> {
      return snapshot(storeRef.current)
    },

    async setActive(id: number): Promise<UiLoadoutListResult> {
      return mutate((store) => {
        const target = findEntry(store, id)
        if (!target) return snapshot(store)

        const mode: UiLoadoutMode = idMode(id)
        const sign = modeSign(mode)
        deactivateMode(store, sign)
        target.isActive = true
        target.updatedAt = Date.now()

        const kind = idKind(id)
        if (kind === 'default-custom' || kind === 'custom') {
          store.lastCustomIdByMode[mode] = id
        }

        return snapshot(store)
      })
    },

    async updatePending(mode: UiLoadoutMode, loadout: UiLayoutLoadout): Promise<UiLoadoutListResult> {
      return mutate((store) => {
        const sign = modeSign(mode)
        const pendingId = LOADOUT_PENDING_ID_ABS * sign
        const signature = stableStringify(loadout)

        const match = store.uiLoadoutEntries.find(
          (entry) => entry.id * sign > 0 && entry.signature === signature,
        )

        deactivateMode(store, sign)

        if (match) {
          match.isActive = true
          match.updatedAt = Date.now()
          const kind = idKind(match.id)
          if (kind === 'default-custom' || kind === 'custom') {
            store.lastCustomIdByMode[mode] = match.id
          }
          return snapshot(store)
        }

        const pending = findEntry(store, pendingId)
        if (pending) {
          pending.isActive = true
          pending.signature = signature
          pending.payload = clone(loadout)
          pending.updatedAt = Date.now()
        }

        return snapshot(store)
      })
    },

    async saveCustom(mode: UiLoadoutMode): Promise<UiLoadoutListResult> {
      return mutate((store) => {
        const sign = modeSign(mode)
        const pendingId = LOADOUT_PENDING_ID_ABS * sign
        const pending = findEntry(store, pendingId)
        if (!pending || !pending.isActive) return snapshot(store)

        const existingAbs = store.uiLoadoutEntries
          .filter((entry) => entry.id * sign > 0 && Math.abs(entry.id) >= LOADOUT_FIRST_CUSTOM_ID_ABS)
          .map((entry) => Math.abs(entry.id))

        let nextAbs = LOADOUT_FIRST_CUSTOM_ID_ABS
        while (existingAbs.includes(nextAbs)) nextAbs += 1
        const newId = nextAbs * sign

        deactivateMode(store, sign)

        store.uiLoadoutEntries.push({
          id: newId,
          isActive: true,
          signature: pending.signature,
          payload: clone(pending.payload),
          updatedAt: Date.now(),
        })

        store.lastCustomIdByMode[mode] = newId

        const defaultCustomId = LOADOUT_DEFAULT_CUSTOM_ID_ABS * sign
        const defaultCustom = findEntry(store, defaultCustomId)
        if (defaultCustom) {
          pending.isActive = false
          pending.signature = defaultCustom.signature
          pending.payload = clone(defaultCustom.payload)
          pending.updatedAt = Date.now()
        }

        return snapshot(store)
      })
    },

    async deleteCustom(id: number): Promise<UiLoadoutListResult> {
      return mutate((store) => {
        if (idKind(id) !== 'custom') return snapshot(store)

        const index = store.uiLoadoutEntries.findIndex((entry) => entry.id === id)
        if (index < 0) return snapshot(store)

        const [removed] = store.uiLoadoutEntries.splice(index, 1)
        const mode: UiLoadoutMode = idMode(id)
        const sign = modeSign(mode)
        const defaultCustomId = LOADOUT_DEFAULT_CUSTOM_ID_ABS * sign

        if (removed?.isActive) {
          deactivateMode(store, sign)
          const fallback = findEntry(store, defaultCustomId)
          if (fallback) {
            fallback.isActive = true
            fallback.updatedAt = Date.now()
          }
        }

        if (store.lastCustomIdByMode[mode] === id) {
          store.lastCustomIdByMode[mode] = defaultCustomId
        }

        return snapshot(store)
      })
    },

    async resetCustom(mode: UiLoadoutMode): Promise<UiLoadoutListResult> {
      return mutate((store) => {
        const sign = modeSign(mode)
        const defaultCustomId = LOADOUT_DEFAULT_CUSTOM_ID_ABS * sign
        const target = findEntry(store, defaultCustomId)
        if (!target) return snapshot(store)

        deactivateMode(store, sign)
        target.isActive = true
        target.updatedAt = Date.now()
        store.lastCustomIdByMode[mode] = defaultCustomId

        return snapshot(store)
      })
    },
    async exportTdl(): Promise<void> {
      // No-op in browser dev mode
    },
    async exportTdlEntry(_id: number): Promise<void> {
      // No-op in browser dev mode
    },
    async importTdl(): Promise<UiLoadoutListResult> {
      return mutate((store) => snapshot(store))
    },
  }
}

function buildFileSyncBridge(): FileSyncApi {
  return {
    async syncExistingNotes() {
      return { createdNoteIds: [], updatedPaths: [], markedDeletedNoteIds: [] }
    },
    async importNotes() {
      return { imported: 0, createdNoteIds: [], errors: ['File sync is not available in browser dev.'] }
    },
    async openNotesFolder() {},
  }
}

function buildTabsBridge(storeRef: { current: BrowserMockStore }): NoteTabsApi {
  const mutate = <T,>(transform: (store: BrowserMockStore) => T): T => {
    const result = transform(storeRef.current)
    persistStore(storeRef.current)
    return result
  }

  // Excludes any note that's currently chapterOnly -- mirrors the real
  // backend's listNoteTabs doc comment: a chapter has no tab-bar identity of
  // its own, so this is the root-cause filter, not just a display nicety.
  // Also re-validates lastActiveChapterNoteId against the live chapters list
  // on every read, same as the real backend's LEFT JOIN -- a stale/foreign
  // reference reads back as null rather than trusted as-is.
  const sorted = (store: BrowserMockStore): NoteTabEntry[] => {
    const chapterOnlyNoteIds = new Set(store.notes.filter((note) => note.chapterOnly).map((note) => note.id))
    return store.noteTabs
      .filter((tab) => !chapterOnlyNoteIds.has(tab.noteId))
      .map((tab) => {
        const stillValid = tab.lastActiveChapterNoteId
          ? store.chapters.some((chapter) => chapter.parentNoteId === tab.noteId && chapter.chapterNoteId === tab.lastActiveChapterNoteId)
          : false
        return stillValid ? tab : { ...tab, lastActiveChapterNoteId: null }
      })
      .sort((a, b) => a.sectionId.localeCompare(b.sectionId) || a.position - b.position)
  }

  return {
    async listTabs(): Promise<NoteTabEntry[]> {
      return sorted(storeRef.current)
    },

    // Newly-pinned tabs join at the left edge, ahead of every existing tab.
    async addTab(sectionId: string, noteId: string): Promise<NoteTabEntry[]> {
      return mutate((store) => {
        if (!store.noteTabs.some((tab) => tab.sectionId === sectionId && tab.noteId === noteId)) {
          store.noteTabs = store.noteTabs.map((tab) => (
            tab.sectionId === sectionId ? { ...tab, position: tab.position + 1 } : tab
          ))
          store.noteTabs.push({ sectionId, noteId, position: 0, addedAtMs: Date.now(), lastActiveChapterNoteId: null })
        }
        return sorted(store)
      })
    },

    async removeTab(sectionId: string, noteId: string): Promise<NoteTabEntry[]> {
      return mutate((store) => {
        store.noteTabs = store.noteTabs.filter((tab) => !(tab.sectionId === sectionId && tab.noteId === noteId))
        return sorted(store)
      })
    },

    async reorderTabs(sectionId: string, orderedNoteIds: string[]): Promise<NoteTabEntry[]> {
      return mutate((store) => {
        const positionByNoteId = new Map(orderedNoteIds.map((noteId, index) => [noteId, index]))
        store.noteTabs = store.noteTabs.map((tab) => (
          tab.sectionId === sectionId
            ? { ...tab, position: positionByNoteId.get(tab.noteId) ?? tab.position }
            : tab
        ))
        return sorted(store)
      })
    },

    async setLastActiveChapter(sectionId: string, noteId: string, chapterNoteId: string | null): Promise<NoteTabEntry[]> {
      return mutate((store) => {
        store.noteTabs = store.noteTabs.map((tab) => (
          tab.sectionId === sectionId && tab.noteId === noteId
            ? { ...tab, lastActiveChapterNoteId: chapterNoteId }
            : tab
        ))
        return sorted(store)
      })
    },
  }
}

/**
 * Dev-mode mirror of noteLifecycleService.ts's `getRealChapterRows` -- the
 * one canonical place in this file that decides "real chapter" for
 * parentNoteId, by each chapter note's own isAutoToc/isAutoOpenItems flag
 * and nothing else. Every store-mutating function below that needs "every
 * real chapter, in bar order" (TOC regeneration, Open-Items family
 * ordering, ...) MUST call this rather than re-deriving its own filter --
 * that duplication (only excluding the TOC chapter, not also Open Items)
 * is exactly the bug this replaces; see noteLifecycleService.ts's own doc
 * comment on getRealChapterRows for the real-backend incident this mirrors.
 */
function getRealChapterRowsInStore(store: BrowserMockStore, parentNoteId: string): ChapterEntry[] {
  return store.chapters
    .filter((chapter) => chapter.parentNoteId === parentNoteId)
    .sort((a, b) => a.position - b.position)
    .filter((chapter) => {
      const chapterNote = store.notes.find((note) => note.id === chapter.chapterNoteId)
      return chapterNote ? !chapterNote.isAutoToc && !chapterNote.isAutoOpenItems : false
    })
}

/**
 * Dev-mode mirror of noteLifecycleService.ts's regenerateAutoTocChapter --
 * see that method's own doc comment for what this actually does and why,
 * including why every link is built with the internal-only `@noteId` scheme
 * (formatInternalNoteLink) rather than the user-facing assignedId-based one.
 * A no-op if `parentNoteId` has no auto-TOC chapter. Mutates `store` directly
 * rather than round-tripping through this file's own loadNote/saveNote
 * bridge methods (unlike the real backend, which has to, since chapters are
 * file-backed there) -- the mock store has no such file layer, so a direct
 * in-place update is both sufficient and faithful to what those calls would
 * produce.
 */
function regenerateAutoTocInStore(store: BrowserMockStore, parentNoteId: string): void {
  const parentNote = store.notes.find((note) => note.id === parentNoteId)
  const tocChapter = store.chapters.find((chapter) => (
    chapter.parentNoteId === parentNoteId && store.notes.find((note) => note.id === chapter.chapterNoteId)?.isAutoToc
  ))
  if (!parentNote || !tocChapter) return

  const parentHeadings = computeHeadingAnchors(parentNote.text)
  const parentHref = formatInternalNoteLink(parentNoteId)

  const lines = ['# Table of Contents', '', formatOutlineEntryLine(0, parentNote.title || 'Untitled', parentHref)]
  for (const heading of parentHeadings) {
    lines.push(formatOutlineEntryLine(1, heading.label, formatInternalNoteLink(parentNoteId, formatHeadingAnchorFragment(heading.anchorId))))
  }

  const chapterRows = getRealChapterRowsInStore(store, parentNoteId)

  for (const row of chapterRows) {
    const chapterNote = store.notes.find((note) => note.id === row.chapterNoteId)
    if (!chapterNote) continue

    const [rootHeading, ...restHeadings] = computeHeadingAnchors(chapterNote.text)
    const rootHref = formatInternalNoteLink(row.chapterNoteId)
    const rootLabel = rootHeading ? rootHeading.label : resolveIdentityLabel(row.chapterId, chapterNote.text).text
    lines.push(formatOutlineEntryLine(0, rootLabel, rootHref))
    for (const heading of restHeadings) {
      lines.push(formatOutlineEntryLine(1, heading.label, formatInternalNoteLink(row.chapterNoteId, formatHeadingAnchorFragment(heading.anchorId))))
    }
  }

  const tocText = lines.join('\n')
  const tocNote = store.notes.find((note) => note.id === tocChapter.chapterNoteId)
  if (tocNote && tocNote.text !== tocText) {
    tocNote.text = tocText
    tocNote.updatedAtMs = Date.now()
    tocNote.sizeBytes = tocText.length
    tocNote.title = deriveTitle(tocText)
  }
}

/** Dev-mode mirror of noteLifecycleService.ts's private openItemsFamilyOrder. */
function openItemsFamilyOrderInStore(store: BrowserMockStore, parentNoteId: string): string[] {
  const realChapterIds = getRealChapterRowsInStore(store, parentNoteId).map((chapter) => chapter.chapterNoteId)
  return [parentNoteId, ...realChapterIds]
}

function findOpenItemsChapterInStore(store: BrowserMockStore, parentNoteId: string): ChapterEntry | undefined {
  return store.chapters.find((chapter) => (
    chapter.parentNoteId === parentNoteId && store.notes.find((note) => note.id === chapter.chapterNoteId)?.isAutoOpenItems
  ))
}

/** Dev-mode mirror of noteLifecycleService.ts's private dropOpenItemsGroup. */
function dropOpenItemsGroupInStore(store: BrowserMockStore, parentNoteId: string, openItemsChapterNoteId: string, noteIdToRemove: string): void {
  const openItemsNote = store.notes.find((note) => note.id === openItemsChapterNoteId)
  if (!openItemsNote) return

  const remainingGroups = parseOpenItemsGroups(openItemsNote.text).filter((group) => group.noteId !== noteIdToRemove)
  const nextText = assembleOpenItemsText(remainingGroups)

  if (nextText === null) {
    const removed = store.chapters.find((chapter) => chapter.parentNoteId === parentNoteId && chapter.chapterNoteId === openItemsChapterNoteId)
    store.chapters = store.chapters
      .filter((chapter) => !(chapter.parentNoteId === parentNoteId && chapter.chapterNoteId === openItemsChapterNoteId))
      .map((chapter) => (
        chapter.parentNoteId === parentNoteId && removed && chapter.position > removed.position
          ? { ...chapter, position: chapter.position - 1 }
          : chapter
      ))
    store.notes = store.notes.filter((note) => note.id !== openItemsChapterNoteId)
    return
  }

  if (nextText !== openItemsNote.text) {
    openItemsNote.text = nextText
    openItemsNote.updatedAtMs = Date.now()
    openItemsNote.sizeBytes = nextText.length
    openItemsNote.title = deriveTitle(nextText)
  }
}

/**
 * Dev-mode mirror of noteLifecycleService.ts's regenerateOpenItemsGroup --
 * see that method's own doc comment for the full reasoning. Requires the
 * auto-TOC chapter to already exist, same precondition as the real backend.
 */
function regenerateOpenItemsGroupInStore(store: BrowserMockStore, parentNoteId: string, changedNoteId: string): void {
  const tocChapter = store.chapters.find((chapter) => (
    chapter.parentNoteId === parentNoteId && store.notes.find((note) => note.id === chapter.chapterNoteId)?.isAutoToc
  ))
  if (!tocChapter) return

  const changedNote = store.notes.find((note) => note.id === changedNoteId)
  const parentNote = store.notes.find((note) => note.id === parentNoteId)
  if (!changedNote || !parentNote) return

  // Same internal-only `@noteId` addressing regenerateAutoTocInStore uses --
  // see the real backend's regenerateOpenItemsGroup for the full rationale.
  // The label shown is a separate, purely cosmetic concern.
  const linkPrefix = formatInternalNoteLink(changedNoteId)
  let groupLabel: string
  if (changedNoteId === parentNoteId) {
    groupLabel = changedNote.title || 'Untitled'
  } else {
    const chapterRow = store.chapters.find((chapter) => chapter.parentNoteId === parentNoteId && chapter.chapterNoteId === changedNoteId)
    if (!chapterRow) return
    groupLabel = resolveIdentityLabel(chapterRow.chapterId, changedNote.text).text
  }

  const newGroupMarkdown = buildOpenItemsGroupMarkdown(changedNote.text, linkPrefix, groupLabel)

  let openItemsChapter = findOpenItemsChapterInStore(store, parentNoteId)

  if (newGroupMarkdown === null) {
    if (openItemsChapter) {
      dropOpenItemsGroupInStore(store, parentNoteId, openItemsChapter.chapterNoteId, changedNoteId)
    }
    return
  }

  if (!openItemsChapter) {
    const now = Date.now()
    const id = createId()
    const created: NoteDocument = normalizeDocument({
      id,
      fileName: `${id}.md`,
      title: '',
      tags: [],
      createdAtMs: now,
      updatedAtMs: now,
      sizeBytes: 0,
      text: '',
      chapterOnly: true,
      isAutoToc: false,
      isAutoOpenItems: true,
      chapterParentId: parentNoteId,
    })
    store.notes.push(created)

    // Pin to position 1, right after the auto-TOC chapter -- mirrors
    // databaseService.ts's pinChapterAfterAutoToc.
    store.chapters = store.chapters.map((chapter) => (
      chapter.parentNoteId === parentNoteId && chapter.position >= 1
        ? { ...chapter, position: chapter.position + 1 }
        : chapter
    ))
    store.chapters.push({ parentNoteId, chapterNoteId: id, position: 1, chapterId: null })
    openItemsChapter = { parentNoteId, chapterNoteId: id, position: 1, chapterId: null }
  }

  const openItemsNote = store.notes.find((note) => note.id === openItemsChapter!.chapterNoteId)
  if (!openItemsNote) return

  const existingGroups = parseOpenItemsGroups(openItemsNote.text).filter((group) => group.noteId !== changedNoteId)
  const familyOrder = openItemsFamilyOrderInStore(store, parentNoteId)
  const orderIndex = new Map(familyOrder.map((id, index) => [id, index]))
  const nextGroups = [...existingGroups, { noteId: changedNoteId, markdown: newGroupMarkdown }]
    .sort((a, b) => (orderIndex.get(a.noteId) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(b.noteId) ?? Number.MAX_SAFE_INTEGER))

  const nextText = assembleOpenItemsText(nextGroups)
  if (nextText !== null && nextText !== openItemsNote.text) {
    openItemsNote.text = nextText
    openItemsNote.updatedAtMs = Date.now()
    openItemsNote.sizeBytes = nextText.length
    openItemsNote.title = deriveTitle(nextText)
  }
}

/** Dev-mode mirror of noteLifecycleService.ts's private resyncOpenItemsOrder. */
function resyncOpenItemsOrderInStore(store: BrowserMockStore, parentNoteId: string): void {
  const openItemsChapter = findOpenItemsChapterInStore(store, parentNoteId)
  if (!openItemsChapter) return
  const openItemsNote = store.notes.find((note) => note.id === openItemsChapter.chapterNoteId)
  if (!openItemsNote) return

  const groups = parseOpenItemsGroups(openItemsNote.text)
  if (groups.length === 0) return

  const familyOrder = openItemsFamilyOrderInStore(store, parentNoteId)
  const orderIndex = new Map(familyOrder.map((id, index) => [id, index]))
  const sortedGroups = [...groups].sort((a, b) => (orderIndex.get(a.noteId) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(b.noteId) ?? Number.MAX_SAFE_INTEGER))
  if (sortedGroups.every((group, index) => group.noteId === groups[index].noteId)) return

  const nextText = assembleOpenItemsText(sortedGroups)
  if (nextText !== null && nextText !== openItemsNote.text) {
    openItemsNote.text = nextText
    openItemsNote.updatedAtMs = Date.now()
    openItemsNote.sizeBytes = nextText.length
    openItemsNote.title = deriveTitle(nextText)
  }
}

function buildChaptersBridge(storeRef: { current: BrowserMockStore }): ChaptersApi {
  const mutate = <T,>(transform: (store: BrowserMockStore) => T): T => {
    const result = transform(storeRef.current)
    persistStore(storeRef.current)
    return result
  }

  const sorted = (store: BrowserMockStore, parentNoteId: string): ChapterEntry[] =>
    store.chapters.filter((chapter) => chapter.parentNoteId === parentNoteId).sort((a, b) => a.position - b.position)

  return {
    async listChapters(parentNoteId: string): Promise<ChapterEntry[]> {
      return sorted(storeRef.current, parentNoteId)
    },

    async createChapter(parentNoteId: string): Promise<{ chapters: ChapterEntry[]; created: NoteDocument }> {
      return mutate((store) => {
        const now = Date.now()
        const id = createId()
        const created: NoteDocument = normalizeDocument({
          id,
          fileName: `${id}.md`,
          title: '',
          tags: [],
          createdAtMs: now,
          updatedAtMs: now,
          sizeBytes: 0,
          text: '',
          chapterOnly: true,
          isAutoToc: false,
          isAutoOpenItems: false,
          chapterParentId: parentNoteId,
        })
        store.notes.push(created)

        const maxPosition = store.chapters
          .filter((chapter) => chapter.parentNoteId === parentNoteId)
          .reduce((max, chapter) => Math.max(max, chapter.position), -1)
        store.chapters.push({ parentNoteId, chapterNoteId: id, position: maxPosition + 1, chapterId: null })

        return { chapters: sorted(store, parentNoteId), created: clone(created) }
      })
    },

    // Dragging a note onto a chapter bar: clones its content into a brand-new
    // chapterOnly note appended as parentNoteId's last chapter. The dragged
    // note itself is never touched or linked -- a note can be a chapter of at
    // most one parent, ever, and only already-chapterOnly notes can be
    // chapters, so a regular note's content can only ever reach a chapter bar
    // by being copied, never by being attached directly.
    async cloneNoteAsChapter(parentNoteId: string, sourceNoteId: string): Promise<{ chapters: ChapterEntry[]; created: NoteDocument }> {
      return mutate((store) => {
        const source = store.notes.find((note) => note.id === sourceNoteId)
        if (!source || source.chapterOnly || sourceNoteId === parentNoteId) {
          throw new Error(`Cannot clone note ${sourceNoteId} as a chapter of ${parentNoteId}`)
        }

        const now = Date.now()
        const id = createId()
        const clonedText = normalizeChapterHeadings(source.text)
        const created: NoteDocument = normalizeDocument({
          id,
          fileName: `${id}.md`,
          title: source.title,
          tags: [],
          createdAtMs: now,
          updatedAtMs: now,
          sizeBytes: clonedText.length,
          text: clonedText,
          chapterOnly: true,
          isAutoToc: false,
          isAutoOpenItems: false,
          chapterParentId: parentNoteId,
        })
        store.notes.push(created)

        const maxPosition = store.chapters
          .filter((chapter) => chapter.parentNoteId === parentNoteId)
          .reduce((max, chapter) => Math.max(max, chapter.position), -1)
        store.chapters.push({ parentNoteId, chapterNoteId: id, position: maxPosition + 1, chapterId: null })

        return { chapters: sorted(store, parentNoteId), created: clone(created) }
      })
    },

    async setChapterId(parentNoteId: string, chapterNoteId: string, requestedId: string): Promise<string | null> {
      return mutate((store) => {
        const normalized = normalizeAssignedIdInput(requestedId)
        if (normalized.length === 0) {
          store.chapters = store.chapters.map((chapter) => (
            chapter.parentNoteId === parentNoteId && chapter.chapterNoteId === chapterNoteId
              ? { ...chapter, chapterId: null }
              : chapter
          ))
          return null
        }

        const used = new Set(
          store.chapters
            .filter((chapter) => chapter.parentNoteId === parentNoteId && chapter.chapterNoteId !== chapterNoteId && chapter.chapterId)
            .map((chapter) => chapter.chapterId as string),
        )
        let resolved = normalized
        let attempt = 2
        while (used.has(resolved)) {
          resolved = `${normalized}-${attempt}`
          attempt += 1
        }

        store.chapters = store.chapters.map((chapter) => (
          chapter.parentNoteId === parentNoteId && chapter.chapterNoteId === chapterNoteId
            ? { ...chapter, chapterId: resolved }
            : chapter
        ))
        return resolved
      })
    },

    async reorderChapters(parentNoteId: string, orderedChapterNoteIds: string[]): Promise<ChapterEntry[]> {
      return mutate((store) => {
        const positionByChapterNoteId = new Map(orderedChapterNoteIds.map((chapterNoteId, index) => [chapterNoteId, index]))
        store.chapters = store.chapters.map((chapter) => (
          chapter.parentNoteId === parentNoteId
            ? { ...chapter, position: positionByChapterNoteId.get(chapter.chapterNoteId) ?? chapter.position }
            : chapter
        ))
        resyncOpenItemsOrderInStore(store, parentNoteId)
        return sorted(store, parentNoteId)
      })
    },

    async promoteChapterToParent(parentNoteId: string, chapterNoteId: string): Promise<ChapterEntry[]> {
      return mutate((store) => {
        const chapterRows = store.chapters
          .filter((chapter) => chapter.parentNoteId === parentNoteId)
          .sort((a, b) => a.position - b.position)

        const dragged = chapterRows.find((row) => row.chapterNoteId === chapterNoteId)
        if (!dragged) {
          throw new Error(`Chapter ${chapterNoteId} is not a chapter of ${parentNoteId}`)
        }

        const remaining = chapterRows.filter((row) => row.chapterNoteId !== chapterNoteId)
        const parentNote = store.notes.find((note) => note.id === parentNoteId)
        const chapterNote = store.notes.find((note) => note.id === chapterNoteId)
        if (!parentNote || !chapterNote) {
          throw new Error(`Missing parent/chapter note for promotion`)
        }

        store.chapters = store.chapters.filter((chapter) => chapter.parentNoteId !== parentNoteId)
        chapterNote.chapterOnly = false
        chapterNote.chapterParentId = null
        parentNote.chapterOnly = true
        parentNote.chapterParentId = chapterNoteId

        // Chapters carry no tags of their own -- move the old parent's tags
        // onto the newly-promoted note (merged, not clobbered, in case it
        // already had a stray one of its own) and leave the old parent with
        // none, matching every other chapter. Mirrors databaseService.ts's
        // promoteChapterToParent.
        chapterNote.tags = [
          ...chapterNote.tags,
          ...parentNote.tags.filter((tag) => !chapterNote.tags.includes(tag)),
        ]
        parentNote.tags = []

        // The newly-promoted note takes over the old parent's exact
        // tab-bar spot (same section, same position) rather than its pins
        // just vanishing. Mirrors databaseService.ts's promoteChapterToParent,
        // including the same collision fallback (shouldn't happen -- chapters
        // are never tabbable -- but avoids a duplicate {sectionId, noteId} pair).
        const oldParentSectionIds = store.noteTabs.filter((tab) => tab.noteId === parentNoteId).map((tab) => tab.sectionId)
        for (const sectionId of oldParentSectionIds) {
          const collides = store.noteTabs.some((tab) => tab.sectionId === sectionId && tab.noteId === chapterNoteId)
          if (collides) {
            store.noteTabs = store.noteTabs.filter((tab) => !(tab.sectionId === sectionId && tab.noteId === parentNoteId))
          } else {
            // Carry over lastActiveChapterNoteId as-is -- its chapters row
            // was just re-parented onto chapterNoteId above, same id, so it's
            // still valid -- EXCEPT a self-reference (this tab had last
            // drilled into the very chapter now becoming the parent), which
            // resets to null. Mirrors databaseService.ts's promoteChapterToParent.
            store.noteTabs = store.noteTabs.map((tab) => (
              tab.sectionId === sectionId && tab.noteId === parentNoteId
                ? {
                    ...tab,
                    noteId: chapterNoteId,
                    lastActiveChapterNoteId: tab.lastActiveChapterNoteId === chapterNoteId ? null : tab.lastActiveChapterNoteId,
                  }
                : tab
            ))
          }
        }

        // Auto-TOC/auto-Open-Items stay pinned first, ahead of the demoted old
        // parent -- mirrors databaseService.ts's promoteChapterToParent.
        const autoRemaining = remaining.filter((row) => {
          const note = store.notes.find((entry) => entry.id === row.chapterNoteId)
          return Boolean(note?.isAutoToc || note?.isAutoOpenItems)
        })
        const realRemaining = remaining.filter((row) => {
          const note = store.notes.find((entry) => entry.id === row.chapterNoteId)
          return !note?.isAutoToc && !note?.isAutoOpenItems
        })
        const insertionRows = [
          ...autoRemaining.map((row) => ({ parentNoteId: chapterNoteId, chapterNoteId: row.chapterNoteId, position: 0, chapterId: row.chapterId })),
          { parentNoteId: chapterNoteId, chapterNoteId: parentNoteId, position: 0, chapterId: null },
          ...realRemaining.map((row) => ({ parentNoteId: chapterNoteId, chapterNoteId: row.chapterNoteId, position: 0, chapterId: row.chapterId })),
        ]

        for (let index = 0; index < insertionRows.length; index += 1) {
          const row = insertionRows[index]
          store.chapters.push({
            parentNoteId: row.parentNoteId,
            chapterNoteId: row.chapterNoteId,
            position: index,
            chapterId: row.chapterId,
          })
        }

        return sorted(store, chapterNoteId)
      })
    },

    async removeChapter(parentNoteId: string, chapterNoteId: string): Promise<ChapterEntry[]> {
      return mutate((store) => {
        const openItemsChapter = findOpenItemsChapterInStore(store, parentNoteId)
        if (openItemsChapter && openItemsChapter.chapterNoteId !== chapterNoteId) {
          dropOpenItemsGroupInStore(store, parentNoteId, openItemsChapter.chapterNoteId, chapterNoteId)
        }

        const removed = store.chapters.find((chapter) => chapter.parentNoteId === parentNoteId && chapter.chapterNoteId === chapterNoteId)
        if (removed) {
          store.chapters = store.chapters
            .filter((chapter) => !(chapter.parentNoteId === parentNoteId && chapter.chapterNoteId === chapterNoteId))
            .map((chapter) => (
              chapter.parentNoteId === parentNoteId && chapter.position > removed.position
                ? { ...chapter, position: chapter.position - 1 }
                : chapter
            ))
          const note = store.notes.find((entry) => entry.id === chapterNoteId)
          if (note) note.chapterParentId = null
        }
        return sorted(store, parentNoteId)
      })
    },

    async createAutoTocChapter(parentNoteId: string): Promise<{ chapters: ChapterEntry[]; created: NoteDocument }> {
      return mutate((store) => {
        const alreadyExists = store.chapters.some((chapter) => (
          chapter.parentNoteId === parentNoteId && store.notes.find((note) => note.id === chapter.chapterNoteId)?.isAutoToc
        ))
        if (alreadyExists) {
          throw new Error(`Parent ${parentNoteId} already has an auto-TOC chapter`)
        }

        const now = Date.now()
        const id = createId()
        const created: NoteDocument = normalizeDocument({
          id,
          fileName: `${id}.md`,
          title: '',
          tags: [],
          createdAtMs: now,
          updatedAtMs: now,
          sizeBytes: 0,
          text: '',
          chapterOnly: true,
          isAutoToc: true,
          isAutoOpenItems: false,
          chapterParentId: parentNoteId,
        })
        store.notes.push(created)

        store.chapters = store.chapters.map((chapter) => (
          chapter.parentNoteId === parentNoteId
            ? { ...chapter, position: chapter.position + 1 }
            : chapter
        ))
        store.chapters.push({ parentNoteId, chapterNoteId: id, position: 0, chapterId: null })

        regenerateAutoTocInStore(store, parentNoteId)

        const refreshed = store.notes.find((note) => note.id === id)
        return { chapters: sorted(store, parentNoteId), created: clone(refreshed ?? created) }
      })
    },

    async regenerateAutoTocChapter(parentNoteId: string): Promise<{ chapters: ChapterEntry[]; created: NoteDocument }> {
      return mutate((store) => {
        const tocChapter = store.chapters.find((chapter) => (
          chapter.parentNoteId === parentNoteId && store.notes.find((note) => note.id === chapter.chapterNoteId)?.isAutoToc
        ))
        if (!tocChapter) {
          throw new Error(`Parent ${parentNoteId} has no auto-TOC chapter to regenerate`)
        }

        regenerateAutoTocInStore(store, parentNoteId)

        const refreshed = store.notes.find((note) => note.id === tocChapter.chapterNoteId)
        if (!refreshed) {
          throw new Error(`Auto-TOC chapter note ${tocChapter.chapterNoteId} missing from store`)
        }
        return { chapters: sorted(store, parentNoteId), created: clone(refreshed) }
      })
    },
  }
}

function buildReviewFlagsBridge(storeRef: { current: BrowserMockStore }): ReviewFlagsApi {
  const mutate = <T,>(transform: (store: BrowserMockStore) => T): T => {
    const result = transform(storeRef.current)
    persistStore(storeRef.current)
    return result
  }

  const sorted = (store: BrowserMockStore, noteId: string): ReviewFlagEntry[] =>
    store.reviewFlags.filter((flag) => flag.noteId === noteId).sort((a, b) => a.lineNumber - b.lineNumber)

  return {
    async listReviewFlags(noteId: string): Promise<ReviewFlagEntry[]> {
      return sorted(storeRef.current, noteId)
    },

    async setReviewFlag(noteId: string, flag): Promise<ReviewFlagEntry[]> {
      return mutate((store) => {
        const existing = store.reviewFlags.find((entry) => entry.noteId === noteId && entry.lineNumber === flag.lineNumber)
        if (existing) {
          existing.severity = flag.severity
          existing.lineHash = flag.lineHash
        } else {
          store.reviewFlags.push({
            id: store.nextReviewFlagId,
            noteId,
            lineNumber: flag.lineNumber,
            severity: flag.severity,
            lineHash: flag.lineHash,
          })
          store.nextReviewFlagId += 1
        }
        return sorted(store, noteId)
      })
    },

    async clearReviewFlag(noteId: string, lineNumber: number): Promise<ReviewFlagEntry[]> {
      return mutate((store) => {
        store.reviewFlags = store.reviewFlags.filter((entry) => !(entry.noteId === noteId && entry.lineNumber === lineNumber))
        return sorted(store, noteId)
      })
    },

    async syncReviewFlags(noteId: string, remaps): Promise<ReviewFlagEntry[]> {
      return mutate((store) => {
        const keepIds = new Set(remaps.map((remap) => remap.id))
        store.reviewFlags = store.reviewFlags.filter((entry) => entry.noteId !== noteId || keepIds.has(entry.id))
        for (const remap of remaps) {
          const existing = store.reviewFlags.find((entry) => entry.id === remap.id && entry.noteId === noteId)
          if (existing) {
            existing.lineNumber = remap.lineNumber
            existing.lineHash = remap.lineHash
          }
        }
        return sorted(store, noteId)
      })
    },
  }
}

function buildSectionsBridge(storeRef: { current: BrowserMockStore }): EditorSectionsApi {
  const mutate = <T,>(transform: (store: BrowserMockStore) => T): T => {
    const result = transform(storeRef.current)
    persistStore(storeRef.current)
    return result
  }

  // Parked (position === null) sections sort after every visible one, same
  // as the real DB's `ORDER BY position IS NULL, position ASC`.
  const sorted = (store: BrowserMockStore): EditorSectionEntry[] =>
    store.editorSections.slice().sort((a, b) => {
      if (a.position === null && b.position === null) return 0
      if (a.position === null) return 1
      if (b.position === null) return -1
      return a.position - b.position
    })

  const renumberVisible = (store: BrowserMockStore): void => {
    const visible = store.editorSections
      .filter((section) => section.position !== null)
      .sort((a, b) => (a.position as number) - (b.position as number))
    const positionById = new Map(visible.map((section, index) => [section.id, index]))
    store.editorSections = store.editorSections.map((section) => (
      section.position === null ? section : { ...section, position: positionById.get(section.id) ?? section.position }
    ))
  }

  return {
    async listSections(): Promise<EditorSectionEntry[]> {
      return sorted(storeRef.current)
    },

    async createSection(name = null, afterPosition): Promise<EditorSectionEntry[]> {
      return mutate((store) => {
        const id = `section-${Math.random().toString(36).slice(2, 10)}`
        const maxPosition = store.editorSections.reduce((max, section) => (
          section.position === null ? max : Math.max(max, section.position)
        ), -1)
        const insertAt = afterPosition !== undefined ? afterPosition + 1 : maxPosition + 1
        store.editorSections = store.editorSections.map((section) => (
          section.position !== null && section.position >= insertAt ? { ...section, position: section.position + 1 } : section
        ))
        store.editorSections.push({ id, name: name ?? null, position: insertAt, widthFraction: null, fixedWidthPx: null, lastActiveNoteId: null, noteSlotInitialized: false })
        return sorted(store)
      })
    },

    async renameSection(id: string, name: string | null): Promise<EditorSectionEntry[]> {
      return mutate((store) => {
        store.editorSections = store.editorSections.map((section) => (
          section.id === id ? { ...section, name } : section
        ))
        return sorted(store)
      })
    },

    async removeSection(id: string): Promise<EditorSectionEntry[]> {
      return mutate((store) => {
        if (id === DEFAULT_EDITOR_SECTION_ID) return sorted(store)
        store.editorSections = store.editorSections.filter((section) => section.id !== id)
        store.noteTabs = store.noteTabs.filter((tab) => tab.sectionId !== id)
        return sorted(store)
      })
    },

    async reorderSections(orderedSectionIds: string[]): Promise<EditorSectionEntry[]> {
      return mutate((store) => {
        const positionById = new Map(orderedSectionIds.map((id, index) => [id, index]))
        store.editorSections = store.editorSections.map((section) => ({
          ...section,
          position: positionById.get(section.id) ?? section.position,
        }))
        return sorted(store)
      })
    },

    async updateSectionWidths(widths): Promise<EditorSectionEntry[]> {
      return mutate((store) => {
        const widthById = new Map(widths.map((entry) => [entry.id, entry.widthFraction]))
        store.editorSections = store.editorSections.map((section) => (
          widthById.has(section.id) ? { ...section, widthFraction: widthById.get(section.id) ?? null } : section
        ))
        return sorted(store)
      })
    },

    async updateSectionFixedWidths(entries): Promise<EditorSectionEntry[]> {
      return mutate((store) => {
        const fixedById = new Map(entries.map((entry) => [entry.id, entry.fixedWidthPx]))
        store.editorSections = store.editorSections.map((section) => (
          fixedById.has(section.id) ? { ...section, fixedWidthPx: fixedById.get(section.id) ?? null } : section
        ))
        return sorted(store)
      })
    },

    async setActiveNote(sectionId: string, noteId: string | null): Promise<EditorSectionEntry[]> {
      return mutate((store) => {
        store.editorSections = store.editorSections.map((section) => (
          section.id === sectionId ? { ...section, lastActiveNoteId: noteId, noteSlotInitialized: true } : section
        ))
        return sorted(store)
      })
    },

    async closeSlot(sectionId: string): Promise<EditorSectionEntry[]> {
      return mutate((store) => {
        const section = store.editorSections.find((entry) => entry.id === sectionId)
        if (!section) return sorted(store)

        if (section.name === null) {
          store.editorSections = store.editorSections.filter((entry) => entry.id !== sectionId)
          store.noteTabs = store.noteTabs.filter((tab) => tab.sectionId !== sectionId)
        } else {
          store.editorSections = store.editorSections.map((entry) => (
            entry.id === sectionId ? { ...entry, position: null } : entry
          ))
        }
        renumberVisible(store)
        return sorted(store)
      })
    },

    async swapIntoSlot(outgoingSectionId: string, incomingSectionId: string): Promise<EditorSectionEntry[]> {
      return mutate((store) => {
        const outgoing = store.editorSections.find((entry) => entry.id === outgoingSectionId)
        if (!outgoing || outgoing.position === null) return sorted(store)

        const slotPosition = outgoing.position
        if (outgoing.name === null) {
          store.editorSections = store.editorSections.filter((entry) => entry.id !== outgoingSectionId)
          store.noteTabs = store.noteTabs.filter((tab) => tab.sectionId !== outgoingSectionId)
        } else {
          store.editorSections = store.editorSections.map((entry) => (
            entry.id === outgoingSectionId ? { ...entry, position: null } : entry
          ))
        }
        store.editorSections = store.editorSections.map((entry) => (
          entry.id === incomingSectionId ? { ...entry, position: slotPosition } : entry
        ))
        return sorted(store)
      })
    },
  }
}

export function installBrowserMockBridges(): void {
  if (!import.meta.env.DEV) return

  const scopedWindow = window as BrowserMockWindow
  if (scopedWindow.__thockdownBrowserMockInstalled) return

  // Electron renderer already owns bridge provisioning through preload.
  if (window.thockdownNotes && window.thockdownState && window.thockdownTextures && window.thockdownLoadouts && window.thockdownTabs && window.thockdownSections && window.thockdownChapters && window.thockdownReviewFlags) {
    scopedWindow.__thockdownBrowserMockInstalled = true
    return
  }

  const storeRef = { current: loadStore() }

  if (!window.thockdownNotes) {
    window.thockdownNotes = buildNotesBridge(storeRef)
  }
  if (!window.thockdownState) {
    window.thockdownState = buildStateBridge(storeRef)
  }
  if (!window.thockdownTextures) {
    window.thockdownTextures = buildTextureBridge(storeRef)
  }
  if (!window.thockdownLoadouts) {
    window.thockdownLoadouts = buildLoadoutBridge(storeRef)
  }
  if (!window.thockdownFileSync) {
    window.thockdownFileSync = buildFileSyncBridge()
  }
  if (!window.thockdownTabs) {
    window.thockdownTabs = buildTabsBridge(storeRef)
  }
  if (!window.thockdownSections) {
    window.thockdownSections = buildSectionsBridge(storeRef)
  }
  if (!window.thockdownChapters) {
    window.thockdownChapters = buildChaptersBridge(storeRef)
  }
  if (!window.thockdownReviewFlags) {
    window.thockdownReviewFlags = buildReviewFlagsBridge(storeRef)
  }

  scopedWindow.__thockdownBrowserMockInstalled = true
}
