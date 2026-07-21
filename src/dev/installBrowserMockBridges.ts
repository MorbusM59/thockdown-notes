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

const MOCK_STORAGE_KEY = 'thockdown-notes:browser-mock:v1'

type BrowserMockStore = {
  notes: NoteDocument[]
  noteUiStates: Record<string, NoteUiState>
  appState: AppState
  windowState: WindowState
  uiLoadoutEntries: UiLoadoutEntry[]
  lastCustomIdByMode: { light: number; dark: number }
  textureCache: Record<string, { mimeType: string; dataBase64: string; createdAt: number }>
  noteTabs: NoteTabEntry[]
  editorSections: EditorSectionEntry[]
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
  }
}

/** A fresh install always starts with exactly one (default, unnamed) section. */
function createDefaultEditorSections(): EditorSectionEntry[] {
  return [{ id: DEFAULT_EDITOR_SECTION_ID, name: null, position: 0, widthFraction: null, fixedWidthPx: null, lastActiveNoteId: null }]
}

function sortNotesDesc(notes: NoteDocument[]): NoteDocument[] {
  return notes
    .slice()
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs || b.createdAtMs - a.createdAtMs || a.id.localeCompare(b.id))
}

const NOTE_INTERNAL_ID_MAX_LEN = 8

function normalizeAssignedIdInput(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '-')
}

function deriveDefaultAssignedIdBase(title: string): string {
  const normalized = normalizeAssignedIdInput(title || 'NOTE')
  const trimmed = normalized.slice(0, NOTE_INTERNAL_ID_MAX_LEN).replace(/-+$/, '')
  return trimmed.length > 0 ? trimmed : 'NOTE'
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
        appState: clone(DEFAULT_APP_STATE),
        windowState: clone(DEFAULT_WINDOW_STATE),
        uiLoadoutEntries: seeded.entries,
        lastCustomIdByMode: seeded.lastCustomIdByMode,
        textureCache: {},
        noteTabs: [],
        editorSections: createDefaultEditorSections(),
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
              progressPreview: value?.progressPreview ?? null,
              progressEdit: value?.progressEdit ?? null,
              cursorPos: value?.cursorPos ?? null,
              scrollTop: value?.scrollTop ?? null,
              sourceAnchorLine: value?.sourceAnchorLine ?? null,
              sourceAnchorText: value?.sourceAnchorText ?? null,
            }]),
        )
      : {}

    return {
      notes,
      noteUiStates,
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
            }))
        : createDefaultEditorSections(),
    }
  } catch {
    const seeded = seedUiLoadoutEntries()
    return {
      notes: [],
      noteUiStates: {},
      appState: clone(DEFAULT_APP_STATE),
      windowState: clone(DEFAULT_WINDOW_STATE),
      uiLoadoutEntries: seeded.entries,
      lastCustomIdByMode: seeded.lastCustomIdByMode,
      textureCache: {},
      noteTabs: [],
      editorSections: createDefaultEditorSections(),
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
        note.text = input.text
        note.updatedAtMs = Date.now()
        note.sizeBytes = input.text.length
        note.title = deriveTitle(input.text)
        return clone(toSummary(note))
      })
    },

    async saveNoteUiState(input: { id: string; payload: NoteUiStatePayload }): Promise<void> {
      return mutate((store) => {
        const previousState = store.noteUiStates[input.id] ?? {
          progressPreview: null,
          progressEdit: null,
          cursorPos: null,
          scrollTop: null,
          sourceAnchorLine: null,
          sourceAnchorText: null,
        }

        const nextState: NoteUiState = {
          ...previousState,
          progressPreview: Object.prototype.hasOwnProperty.call(input.payload, 'progressPreview') ? input.payload.progressPreview ?? null : previousState.progressPreview,
          progressEdit: Object.prototype.hasOwnProperty.call(input.payload, 'progressEdit') ? input.payload.progressEdit ?? null : previousState.progressEdit,
          cursorPos: Object.prototype.hasOwnProperty.call(input.payload, 'cursorPos') ? input.payload.cursorPos ?? null : previousState.cursorPos,
          scrollTop: Object.prototype.hasOwnProperty.call(input.payload, 'scrollTop') ? input.payload.scrollTop ?? null : previousState.scrollTop,
          sourceAnchorLine: Object.prototype.hasOwnProperty.call(input.payload, 'sourceAnchorLine') ? input.payload.sourceAnchorLine ?? null : previousState.sourceAnchorLine,
          sourceAnchorText: Object.prototype.hasOwnProperty.call(input.payload, 'sourceAnchorText') ? input.payload.sourceAnchorText ?? null : previousState.sourceAnchorText,
        }

        store.noteUiStates[input.id] = nextState
      })
    },

    async getNoteUiState(input: LoadNoteInput): Promise<NoteUiState> {
      return storeRef.current.noteUiStates[input.id] ?? {
        progressPreview: null,
        progressEdit: null,
        cursorPos: null,
        scrollTop: null,
        sourceAnchorLine: null,
        sourceAnchorText: null,
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

    async ensureNoteAssignedId(input: { id: string }): Promise<string | null> {
      return mutate((store) => {
        const note = store.notes.find((entry) => entry.id === input.id)
        if (!note) return null
        if (note.assignedId) return note.assignedId
        const base = deriveDefaultAssignedIdBase(note.title)
        note.assignedId = resolveUniqueAssignedId(store.notes, base, note.id)
        return note.assignedId
      })
    },

    async deleteNote(input: DeleteNoteInput): Promise<void> {
      mutate((store) => {
        store.notes = store.notes.filter((note) => note.id !== input.id)
        if (store.appState.selectedNoteId === input.id) {
          store.appState.selectedNoteId = null
        }
        store.noteTabs = store.noteTabs.filter((tab) => tab.noteId !== input.id)
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
  }
}

function buildTabsBridge(storeRef: { current: BrowserMockStore }): NoteTabsApi {
  const mutate = <T,>(transform: (store: BrowserMockStore) => T): T => {
    const result = transform(storeRef.current)
    persistStore(storeRef.current)
    return result
  }

  const sorted = (store: BrowserMockStore): NoteTabEntry[] =>
    store.noteTabs.slice().sort((a, b) => a.sectionId.localeCompare(b.sectionId) || a.position - b.position)

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
          store.noteTabs.push({ sectionId, noteId, position: 0, addedAtMs: Date.now() })
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
        store.editorSections.push({ id, name: name ?? null, position: insertAt, widthFraction: null, fixedWidthPx: null, lastActiveNoteId: null })
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
          section.id === sectionId ? { ...section, lastActiveNoteId: noteId } : section
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
  if (window.thockdownNotes && window.thockdownState && window.thockdownTextures && window.thockdownLoadouts && window.thockdownTabs && window.thockdownSections) {
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

  scopedWindow.__thockdownBrowserMockInstalled = true
}
