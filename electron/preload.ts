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
import type { TextureCacheApi } from '../src/shared/textures'
import { TEXTURE_CHANNELS } from '../src/shared/textures'
import type { AudioBounceCacheApi } from '../src/shared/audioBounceCache'
import { AUDIO_BOUNCE_CHANNELS } from '../src/shared/audioBounceCache'
import type { UiLoadoutApi } from '../src/shared/loadouts'
import { LOADOUT_CHANNELS } from '../src/shared/loadouts'
import type { FileSyncApi } from '../src/shared/fileSync'
import { FILE_SYNC_CHANNELS } from '../src/shared/fileSync'
import type { AudioPlayerApi } from '../src/shared/audioPlayer'
import { AUDIO_PLAYER_CHANNELS } from '../src/shared/audioPlayer'
import type { NoteTabsApi } from '../src/shared/tabs'
import { NOTE_TABS_CHANNELS } from '../src/shared/tabs'
import type { EditorSectionsApi } from '../src/shared/sections'
import { EDITOR_SECTIONS_CHANNELS } from '../src/shared/sections'
import type { ChaptersApi } from '../src/shared/chapters'
import { CHAPTER_CHANNELS } from '../src/shared/chapters'
import type { ReviewFlagsApi } from '../src/shared/reviewFlags'
import { REVIEW_FLAG_CHANNELS } from '../src/shared/reviewFlags'
import { WINDOW_DRAG_CHANNELS } from '../src/shared/windowDrag'

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
  saveNoteUiState: (input) => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.saveNoteUiState, input),
  getNoteUiState: (input) => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.getNoteUiState, input),
  updateExternalNoteState: (input) => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.updateExternalNoteState, input),
  syncExternalNoteToFile: (input) => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.syncExternalNoteToFile, input),
  getNoteIdByExternalPath: (input) => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.getNoteIdByExternalPath, input),
  saveNoteSnapshot: (input) => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.saveNoteSnapshot, input),
  getNoteSnapshots: (input) => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.getNoteSnapshots, input),
  deleteNoteSnapshot: (input) => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.deleteNoteSnapshot, input),
  saveSnapshotAnchor: (input) => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.saveSnapshotAnchor, input),
  getSnapshotAnchor: (input) => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.getSnapshotAnchor, input),
  branchNoteFromSnapshot: (input) => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.branchNoteFromSnapshot, input),
  setNoteAssignedId: (input) => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.setAssignedId, input),
  ensureNoteAssignedId: (input) => ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.ensureAssignedId, input),
}

contextBridge.exposeInMainWorld('thockdownNotes', noteLifecycleApi)

const appStateApi: AppStateApi = {
  loadAppState: () => ipcRenderer.invoke(APP_STATE_CHANNELS.loadAppState),
  saveAppState: (state) => ipcRenderer.invoke(APP_STATE_CHANNELS.saveAppState, state),
  loadWindowState: () => ipcRenderer.invoke(APP_STATE_CHANNELS.loadWindowState),
  saveWindowState: (state) => ipcRenderer.invoke(APP_STATE_CHANNELS.saveWindowState, state),
}

contextBridge.exposeInMainWorld('thockdownState', appStateApi)

const windowControls = {
  minimize: () => ipcRenderer.send('window-control', 'minimize'),
  toggleMaximize: () => ipcRenderer.send('window-control', 'toggle-maximize'),
  close: () => ipcRenderer.send('window-control', 'close'),
  toggleDevTools: () => ipcRenderer.send('window-control', 'toggle-devtools'),
  toggleUtilityCollapse: (size: { width: number; height: number }) =>
    ipcRenderer.invoke('window-control:toggle-utility-collapse', size),
  reportBackgroundColor: (hex: string) =>
    ipcRenderer.send('window-control:report-background-color', hex),
  setSidebarVisible: (visible: boolean) => ipcRenderer.send('window-control:sidebar-visibility', visible),
  setSectionCount: (count: number) => ipcRenderer.send('window-control:section-count', count),
  startWindowDrag: (screenX: number, screenY: number) =>
    ipcRenderer.send(WINDOW_DRAG_CHANNELS.start, { screenX, screenY }),
  moveWindowDrag: (screenX: number, screenY: number) =>
    ipcRenderer.send(WINDOW_DRAG_CHANNELS.move, { screenX, screenY }),
  endWindowDrag: () => ipcRenderer.send(WINDOW_DRAG_CHANNELS.end),
  restoreMaximizedWindow: (originX: number, originY: number, releaseX: number, releaseY: number) =>
    ipcRenderer.send(WINDOW_DRAG_CHANNELS.restoreMaximized, { originX, originY, releaseX, releaseY }),
  onMaximizeStateChange: (callback: (isMaximized: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: boolean) => {
      callback(value)
    }
    ipcRenderer.on('window-maximize-state', listener)
    return () => {
      ipcRenderer.off('window-maximize-state', listener)
    }
  },
  onCollapsedStateChange: (callback: (isCollapsed: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: boolean) => {
      callback(value)
    }
    ipcRenderer.on('window-collapsed-state', listener)
    return () => {
      ipcRenderer.off('window-collapsed-state', listener)
    }
  },
}

const exportApi = {
  selectExportFolder: () => ipcRenderer.invoke('select-export-folder'),
  exportPdf: (folderPath: string, fileName: string, htmlContent?: string) =>
    ipcRenderer.invoke('export-pdf', folderPath, fileName, htmlContent),
}

contextBridge.exposeInMainWorld('windowControls', windowControls)
contextBridge.exposeInMainWorld('thockdownExport', exportApi)

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

contextBridge.exposeInMainWorld('thockdownExternalFiles', externalFilesApi)


const textureCacheApi: TextureCacheApi = {
  getCachedTexture: (request) => ipcRenderer.invoke(TEXTURE_CHANNELS.getCached, request),
  saveCachedTexture: (request, payload) => ipcRenderer.invoke(TEXTURE_CHANNELS.saveCached, request, payload),
  purgeCachedTextures: (request) => ipcRenderer.invoke(TEXTURE_CHANNELS.purgeCached, request),
}

contextBridge.exposeInMainWorld('thockdownTextures', textureCacheApi)

const audioBounceCacheApi: AudioBounceCacheApi = {
  getCachedBounce: (request) => ipcRenderer.invoke(AUDIO_BOUNCE_CHANNELS.getCached, request),
  saveCachedBounce: (request, payload) => ipcRenderer.invoke(AUDIO_BOUNCE_CHANNELS.saveCached, request, payload),
}

contextBridge.exposeInMainWorld('thockdownAudioBounces', audioBounceCacheApi)

const uiLoadoutApi: UiLoadoutApi = {
  list: () => ipcRenderer.invoke(LOADOUT_CHANNELS.list),
  setActive: (id) => ipcRenderer.invoke(LOADOUT_CHANNELS.setActive, id),
  updatePending: (mode, loadout) => ipcRenderer.invoke(LOADOUT_CHANNELS.updatePending, mode, loadout),
  saveCustom: (mode) => ipcRenderer.invoke(LOADOUT_CHANNELS.saveCustom, mode),
  deleteCustom: (id) => ipcRenderer.invoke(LOADOUT_CHANNELS.deleteCustom, id),
  resetCustom: (mode) => ipcRenderer.invoke(LOADOUT_CHANNELS.resetCustom, mode),
  exportTdl: () => ipcRenderer.invoke(LOADOUT_CHANNELS.exportTdl),
  exportTdlEntry: (id: number) => ipcRenderer.invoke(LOADOUT_CHANNELS.exportTdlEntry, id),
  importTdl: () => ipcRenderer.invoke(LOADOUT_CHANNELS.importTdl),
}

contextBridge.exposeInMainWorld('thockdownLoadouts', uiLoadoutApi)

const fileSyncApi: FileSyncApi = {
  syncExistingNotes: () => ipcRenderer.invoke(FILE_SYNC_CHANNELS.syncExistingNotes),
  importNotes: () => ipcRenderer.invoke(FILE_SYNC_CHANNELS.importNotes),
}

contextBridge.exposeInMainWorld('thockdownFileSync', fileSyncApi)

const audioPlayerApi: AudioPlayerApi = {
  pickFiles:          () => ipcRenderer.invoke(AUDIO_PLAYER_CHANNELS.pickFiles),
  pickFolder:         () => ipcRenderer.invoke(AUDIO_PLAYER_CHANNELS.pickFolder),
  scanFolderForAudio: (folderPath) => ipcRenderer.invoke(AUDIO_PLAYER_CHANNELS.scanFolderForAudio, folderPath),
  getPlaylist:        (slot) => ipcRenderer.invoke(AUDIO_PLAYER_CHANNELS.getPlaylist, slot),
  addSongs:           (slot, filePaths) => ipcRenderer.invoke(AUDIO_PLAYER_CHANNELS.addSongs, slot, filePaths),
  clearPlaylist:      (slot) => ipcRenderer.invoke(AUDIO_PLAYER_CHANNELS.clearPlaylist, slot),
  removeSong:         (id) => ipcRenderer.invoke(AUDIO_PLAYER_CHANNELS.removeSong, id),
  pickNextSong:       (activeSlots) => ipcRenderer.invoke(AUDIO_PLAYER_CHANNELS.pickNextSong, activeSlots),
  afterPlay:          (id) => ipcRenderer.invoke(AUDIO_PLAYER_CHANNELS.afterPlay, id),
  favoriteSong:       (id) => ipcRenderer.invoke(AUDIO_PLAYER_CHANNELS.favoriteSong, id),
  skipSong:           (id) => ipcRenderer.invoke(AUDIO_PLAYER_CHANNELS.skipSong, id),
  purgeSong:          (id) => ipcRenderer.invoke(AUDIO_PLAYER_CHANNELS.purgeSong, id),
  getPlaylistCounts:  () => ipcRenderer.invoke(AUDIO_PLAYER_CHANNELS.getPlaylistCounts),
  getSongById:        (id) => ipcRenderer.invoke(AUDIO_PLAYER_CHANNELS.getSongById, id),
}

contextBridge.exposeInMainWorld('thockdownAudioPlayer', audioPlayerApi)

const noteTabsApi: NoteTabsApi = {
  listTabs:    () => ipcRenderer.invoke(NOTE_TABS_CHANNELS.list),
  addTab:      (sectionId, noteId) => ipcRenderer.invoke(NOTE_TABS_CHANNELS.add, sectionId, noteId),
  removeTab:   (sectionId, noteId) => ipcRenderer.invoke(NOTE_TABS_CHANNELS.remove, sectionId, noteId),
  reorderTabs: (sectionId, orderedNoteIds) => ipcRenderer.invoke(NOTE_TABS_CHANNELS.reorder, sectionId, orderedNoteIds),
}

contextBridge.exposeInMainWorld('thockdownTabs', noteTabsApi)

const editorSectionsApi: EditorSectionsApi = {
  listSections:        () => ipcRenderer.invoke(EDITOR_SECTIONS_CHANNELS.list),
  createSection:       (name, afterPosition) => ipcRenderer.invoke(EDITOR_SECTIONS_CHANNELS.create, name, afterPosition),
  renameSection:       (id, name) => ipcRenderer.invoke(EDITOR_SECTIONS_CHANNELS.rename, id, name),
  removeSection:       (id) => ipcRenderer.invoke(EDITOR_SECTIONS_CHANNELS.remove, id),
  reorderSections:     (orderedSectionIds) => ipcRenderer.invoke(EDITOR_SECTIONS_CHANNELS.reorder, orderedSectionIds),
  updateSectionWidths: (widths) => ipcRenderer.invoke(EDITOR_SECTIONS_CHANNELS.updateWidths, widths),
  updateSectionFixedWidths: (entries) => ipcRenderer.invoke(EDITOR_SECTIONS_CHANNELS.updateFixedWidths, entries),
  setActiveNote:       (sectionId, noteId) => ipcRenderer.invoke(EDITOR_SECTIONS_CHANNELS.setActiveNote, sectionId, noteId),
  closeSlot:           (sectionId) => ipcRenderer.invoke(EDITOR_SECTIONS_CHANNELS.closeSlot, sectionId),
  swapIntoSlot:        (outgoingSectionId, incomingSectionId) => ipcRenderer.invoke(EDITOR_SECTIONS_CHANNELS.swapIntoSlot, outgoingSectionId, incomingSectionId),
}

contextBridge.exposeInMainWorld('thockdownSections', editorSectionsApi)

const chaptersApi: ChaptersApi = {
  listChapters:      (parentNoteId) => ipcRenderer.invoke(CHAPTER_CHANNELS.list, parentNoteId),
  createChapter:     (parentNoteId) => ipcRenderer.invoke(CHAPTER_CHANNELS.create, parentNoteId),
  cloneNoteAsChapter: (parentNoteId, sourceNoteId) => ipcRenderer.invoke(CHAPTER_CHANNELS.cloneFromNote, parentNoteId, sourceNoteId),
  reorderChapters:   (parentNoteId, orderedChapterNoteIds) => ipcRenderer.invoke(CHAPTER_CHANNELS.reorder, parentNoteId, orderedChapterNoteIds),
  promoteChapterToParent: (parentNoteId, chapterNoteId) => ipcRenderer.invoke(CHAPTER_CHANNELS.promote, parentNoteId, chapterNoteId),
  removeChapter:     (parentNoteId, chapterNoteId) => ipcRenderer.invoke(CHAPTER_CHANNELS.remove, parentNoteId, chapterNoteId),
  setChapterId:      (parentNoteId, chapterNoteId, requestedId) => ipcRenderer.invoke(CHAPTER_CHANNELS.setChapterId, parentNoteId, chapterNoteId, requestedId),
}

contextBridge.exposeInMainWorld('thockdownChapters', chaptersApi)

const reviewFlagsApi: ReviewFlagsApi = {
  listReviewFlags: (noteId) => ipcRenderer.invoke(REVIEW_FLAG_CHANNELS.list, noteId),
  setReviewFlag:   (noteId, flag) => ipcRenderer.invoke(REVIEW_FLAG_CHANNELS.set, noteId, flag),
  clearReviewFlag: (noteId, lineNumber) => ipcRenderer.invoke(REVIEW_FLAG_CHANNELS.clear, noteId, lineNumber),
  syncReviewFlags: (noteId, remaps) => ipcRenderer.invoke(REVIEW_FLAG_CHANNELS.sync, noteId, remaps),
}

contextBridge.exposeInMainWorld('thockdownReviewFlags', reviewFlagsApi)
