import { ipcRenderer, contextBridge } from 'electron'
import type {
  AddTagInput,
  CreateNoteInput,
  DeleteNoteInput,
  LoadNoteInput,
  NoteTagsInput,
  NoteLifecycleApi,
  RemoveTagInput,
  RenameTagInput,
  ReorderTagsInput,
  SaveNoteInput,
} from '../src/shared/noteLifecycle'
import { NOTE_LIFECYCLE_CHANNELS } from '../src/shared/noteLifecycle'
import type { AppStateApi } from '../src/shared/appState'
import { APP_STATE_CHANNELS } from '../src/shared/appState'
import type { ExternalFilesApi } from '../src/shared/externalFiles'
import { EXTERNAL_FILE_CHANNELS } from '../src/shared/externalFiles'
import type { LegacyDbApi, NoteUiStatePayload } from '../src/shared/legacyDbFeatures'
import { LEGACY_DB_CHANNELS } from '../src/shared/legacyDbFeatures'
import type { TextureCacheApi } from '../src/shared/textures'
import { TEXTURE_CHANNELS } from '../src/shared/textures'
import type { UiLoadoutApi } from '../src/shared/loadouts'
import { LOADOUT_CHANNELS } from '../src/shared/loadouts'
import type { FileSyncApi } from '../src/shared/fileSync'
import { FILE_SYNC_CHANNELS } from '../src/shared/fileSync'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

const noteLifecycleApi: NoteLifecycleApi = {
  listNotes: () => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.list),
  loadNote: (input: LoadNoteInput) => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.load, input),
  createNote: (input?: CreateNoteInput) => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.create, input),
  saveNote: (input: SaveNoteInput) => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.save, input),
  deleteNote: (input: DeleteNoteInput) => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.remove, input),
  getNoteTags: (input: NoteTagsInput) => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.getNoteTags, input),
  addTagToNote: (input: AddTagInput) => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.addTag, input),
  removeTagFromNote: (input: RemoveTagInput) => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.removeTag, input),
  reorderNoteTags: (input: ReorderTagsInput) => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.reorderTags, input),
  renameTag: (input: RenameTagInput) => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.renameTag, input),
  listTags: () => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.listTags),
}

contextBridge.exposeInMainWorld('measlyNotes', noteLifecycleApi)

const appStateApi: AppStateApi = {
  loadAppState: () => ipcRenderer.invoke(APP_STATE_CHANNELS.loadAppState),
  saveAppState: (state) => ipcRenderer.invoke(APP_STATE_CHANNELS.saveAppState, state),
  loadWindowState: () => ipcRenderer.invoke(APP_STATE_CHANNELS.loadWindowState),
  saveWindowState: (state) => ipcRenderer.invoke(APP_STATE_CHANNELS.saveWindowState, state),
}

contextBridge.exposeInMainWorld('measlyState', appStateApi)

const windowControls = {
  minimize: () => ipcRenderer.send('window-control', 'minimize'),
  toggleMaximize: () => ipcRenderer.send('window-control', 'toggle-maximize'),
  close: () => ipcRenderer.send('window-control', 'close'),
  onMaximizeStateChange: (callback: (isMaximized: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: boolean) => {
      callback(value)
    }
    ipcRenderer.on('window-maximize-state', listener)
    return () => {
      ipcRenderer.off('window-maximize-state', listener)
    }
  },
}

contextBridge.exposeInMainWorld('windowControls', windowControls)

const externalFilesApi: ExternalFilesApi = {
  getPendingFilePaths: () => ipcRenderer.invoke(EXTERNAL_FILE_CHANNELS.getPendingPaths),
  readFileContent: (filePath: string) => ipcRenderer.invoke(EXTERNAL_FILE_CHANNELS.readContent, filePath),
  writeFileContent: (filePath: string, content: string) =>
    ipcRenderer.invoke(EXTERNAL_FILE_CHANNELS.writeContent, filePath, content),
  getFileBasename: (filePath: string) => ipcRenderer.invoke(EXTERNAL_FILE_CHANNELS.basename, filePath),
  onOpenFile: (callback: (filePath: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, filePath: string) => {
      callback(filePath)
    }
    ipcRenderer.on(EXTERNAL_FILE_CHANNELS.opened, listener)
    return () => {
      ipcRenderer.off(EXTERNAL_FILE_CHANNELS.opened, listener)
    }
  },
}

contextBridge.exposeInMainWorld('measlyExternalFiles', externalFilesApi)

const legacyDbApi: LegacyDbApi = {
  getLastEditedNoteId: () => ipcRenderer.invoke(LEGACY_DB_CHANNELS.getLastEditedNoteId),
  getTrashNoteIds: () => ipcRenderer.invoke(LEGACY_DB_CHANNELS.getTrashNoteIds),
  searchNoteIdsByTag: (tagQuery: string) => ipcRenderer.invoke(LEGACY_DB_CHANNELS.searchNoteIdsByTag, tagQuery),
  saveNoteUiState: (noteId: string, payload: NoteUiStatePayload) =>
    ipcRenderer.invoke(LEGACY_DB_CHANNELS.saveNoteUiState, noteId, payload),
  getNoteUiState: (noteId: string) => ipcRenderer.invoke(LEGACY_DB_CHANNELS.getNoteUiState, noteId),
  saveNoteSnapshot: (noteId: string, content: string, isManual?: boolean) =>
    ipcRenderer.invoke(LEGACY_DB_CHANNELS.saveNoteSnapshot, noteId, content, isManual),
  getNoteSnapshots: (noteId: string) => ipcRenderer.invoke(LEGACY_DB_CHANNELS.getNoteSnapshots, noteId),
  deleteNoteSnapshot: (snapshotId: number) => ipcRenderer.invoke(LEGACY_DB_CHANNELS.deleteNoteSnapshot, snapshotId),
  createTempNote: (title: string, externalPath: string, originalEncoding?: string) =>
    ipcRenderer.invoke(LEGACY_DB_CHANNELS.createTempNote, title, externalPath, originalEncoding),
  updateTempNoteState: (noteId: string, hasUnsavedChanges: boolean, syncMode: boolean) =>
    ipcRenderer.invoke(LEGACY_DB_CHANNELS.updateTempNoteState, noteId, hasUnsavedChanges, syncMode),
  convertTempNoteToRegular: (noteId: string, newFilePath: string) =>
    ipcRenderer.invoke(LEGACY_DB_CHANNELS.convertTempNoteToRegular, noteId, newFilePath),
  getTempNoteIds: () => ipcRenderer.invoke(LEGACY_DB_CHANNELS.getTempNoteIds),
  getTempNoteIdByExternalPath: (externalPath: string) =>
    ipcRenderer.invoke(LEGACY_DB_CHANNELS.getTempNoteIdByExternalPath, externalPath),
  syncExternalNoteToFile: (noteId: string) => ipcRenderer.invoke(LEGACY_DB_CHANNELS.syncExternalNoteToFile, noteId),
  getExternalSyncState: (noteId: string) => ipcRenderer.invoke(LEGACY_DB_CHANNELS.getExternalSyncState, noteId),
  deleteTempNote: (noteId: string) => ipcRenderer.invoke(LEGACY_DB_CHANNELS.deleteTempNote, noteId),
}

contextBridge.exposeInMainWorld('measlyLegacyDb', legacyDbApi)

const textureCacheApi: TextureCacheApi = {
  getCachedTexture: (request) => ipcRenderer.invoke(TEXTURE_CHANNELS.getCached, request),
  saveCachedTexture: (request, payload) => ipcRenderer.invoke(TEXTURE_CHANNELS.saveCached, request, payload),
  purgeCachedTextures: (request) => ipcRenderer.invoke(TEXTURE_CHANNELS.purgeCached, request),
}

contextBridge.exposeInMainWorld('measlyTextures', textureCacheApi)

const uiLoadoutApi: UiLoadoutApi = {
  listUiLoadouts: () => ipcRenderer.invoke(LOADOUT_CHANNELS.list),
  saveUiLoadout: (slot, loadout) => ipcRenderer.invoke(LOADOUT_CHANNELS.save, slot, loadout),
}

contextBridge.exposeInMainWorld('measlyLoadouts', uiLoadoutApi)

const fileSyncApi: FileSyncApi = {
  syncExistingNotes: () => ipcRenderer.invoke(FILE_SYNC_CHANNELS.syncExistingNotes),
  importNotes: () => ipcRenderer.invoke(FILE_SYNC_CHANNELS.importNotes),
}

contextBridge.exposeInMainWorld('measlyFileSync', fileSyncApi)
