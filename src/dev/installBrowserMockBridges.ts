import type { AppState, AppStateApi, WindowState } from '../shared/appState'
import type { UiLayoutLoadout, UiLoadoutApi } from '../shared/loadouts'
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
  RemoveTagInput,
  RenameTagInput,
  ReorderTagsInput,
  SaveNoteInput,
  TagSummary,
} from '../shared/noteLifecycle'

const MOCK_STORAGE_KEY = 'measly-notes:browser-mock:v1'

type BrowserMockStore = {
  notes: NoteDocument[]
  appState: AppState
  windowState: WindowState
  uiLoadouts: UiLayoutLoadout[]
  textureCache: Record<string, { mimeType: string; dataBase64: string; createdAt: number }>
}

type BrowserMockWindow = Window & {
  __measlyBrowserMockInstalled?: boolean
  measlyFileSync?: FileSyncApi
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
  }
}

function sortNotesDesc(notes: NoteDocument[]): NoteDocument[] {
  return notes
    .slice()
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs || b.createdAtMs - a.createdAtMs || a.id.localeCompare(b.id))
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

function loadStore(): BrowserMockStore {
  try {
    const raw = window.localStorage.getItem(MOCK_STORAGE_KEY)
    if (!raw) {
      return {
        notes: [],
        appState: clone(DEFAULT_APP_STATE),
        windowState: clone(DEFAULT_WINDOW_STATE),
        uiLoadouts: [],
        textureCache: {},
      }
    }

    const parsed = JSON.parse(raw) as Partial<BrowserMockStore>
    const notes = Array.isArray(parsed.notes)
      ? parsed.notes.map((note) => normalizeDocument(note as NoteDocument))
      : []

    return {
      notes,
      appState: parsed.appState && typeof parsed.appState === 'object'
        ? clone(parsed.appState as AppState)
        : clone(DEFAULT_APP_STATE),
      windowState: parsed.windowState && typeof parsed.windowState === 'object'
        ? {
            ...DEFAULT_WINDOW_STATE,
            ...(parsed.windowState as WindowState),
          }
        : clone(DEFAULT_WINDOW_STATE),
      uiLoadouts: Array.isArray(parsed.uiLoadouts)
        ? clone(parsed.uiLoadouts as UiLayoutLoadout[]).slice(0, 9)
        : [],
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
    }
  } catch {
    return {
      notes: [],
      appState: clone(DEFAULT_APP_STATE),
      windowState: clone(DEFAULT_WINDOW_STATE),
      uiLoadouts: [],
      textureCache: {},
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

    async deleteNote(input: DeleteNoteInput): Promise<void> {
      mutate((store) => {
        store.notes = store.notes.filter((note) => note.id !== input.id)
        if (store.appState.selectedNoteId === input.id) {
          store.appState.selectedNoteId = null
        }
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

  return {
    async listUiLoadouts(): Promise<UiLayoutLoadout[]> {
      return clone(storeRef.current.uiLoadouts).slice(0, 9)
    },

    async saveUiLoadout(slot: number, loadout: UiLayoutLoadout): Promise<UiLayoutLoadout[]> {
      return mutate((store) => {
        const targetSlot = Math.max(0, Math.min(8, Math.floor(slot)))
        const next = [...store.uiLoadouts]
        const signature = stableStringify(loadout)

        if (targetSlot < next.length) {
          next[targetSlot] = clone(loadout)
        } else {
          next.push(clone(loadout))
        }

        const deduped = next.filter((entry, index) => {
          if (index === targetSlot) return true
          return stableStringify(entry) !== signature
        })

        store.uiLoadouts = deduped.slice(0, 9)
        return clone(store.uiLoadouts)
      })
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

export function installBrowserMockBridges(): void {
  if (!import.meta.env.DEV) return

  const scopedWindow = window as BrowserMockWindow
  if (scopedWindow.__measlyBrowserMockInstalled) return

  // Electron renderer already owns bridge provisioning through preload.
  if (window.measlyNotes && window.measlyState && window.measlyTextures && window.measlyLoadouts) {
    scopedWindow.__measlyBrowserMockInstalled = true
    return
  }

  const storeRef = { current: loadStore() }

  if (!window.measlyNotes) {
    window.measlyNotes = buildNotesBridge(storeRef)
  }
  if (!window.measlyState) {
    window.measlyState = buildStateBridge(storeRef)
  }
  if (!window.measlyTextures) {
    window.measlyTextures = buildTextureBridge(storeRef)
  }
  if (!window.measlyLoadouts) {
    window.measlyLoadouts = buildLoadoutBridge(storeRef)
  }
  if (!window.measlyFileSync) {
    window.measlyFileSync = buildFileSyncBridge()
  }

  scopedWindow.__measlyBrowserMockInstalled = true
}
