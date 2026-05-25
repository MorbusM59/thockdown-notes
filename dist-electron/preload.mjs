"use strict";
const electron = require("electron");
const NOTE_LIFECYCLE_CHANNELS = {
  list: "notes:list",
  load: "notes:load",
  create: "notes:create",
  save: "notes:save",
  remove: "notes:remove",
  getNoteTags: "tags:get-note-tags",
  addTag: "tags:add",
  removeTag: "tags:remove",
  reorderTags: "tags:reorder",
  renameTag: "tags:rename",
  listTags: "tags:list"
};
const APP_STATE_CHANNELS = {
  loadAppState: "state:app:load",
  saveAppState: "state:app:save",
  loadWindowState: "state:window:load",
  saveWindowState: "state:window:save"
};
const EXTERNAL_FILE_CHANNELS = {
  getPendingPaths: "external-files:get-pending-paths",
  readContent: "external-files:read-content",
  writeContent: "external-files:write-content",
  basename: "external-files:basename",
  opened: "external-files:opened"
};
const LEGACY_DB_CHANNELS = {
  getLastEditedNoteId: "legacy-db:get-last-edited-note-id",
  getTrashNoteIds: "legacy-db:get-trash-note-ids",
  searchNoteIdsByTag: "legacy-db:search-note-ids-by-tag",
  saveNoteUiState: "legacy-db:save-note-ui-state",
  getNoteUiState: "legacy-db:get-note-ui-state",
  saveNoteSnapshot: "legacy-db:save-note-snapshot",
  getNoteSnapshots: "legacy-db:get-note-snapshots",
  deleteNoteSnapshot: "legacy-db:delete-note-snapshot",
  createTempNote: "legacy-db:create-temp-note",
  updateTempNoteState: "legacy-db:update-temp-note-state",
  convertTempNoteToRegular: "legacy-db:convert-temp-note-to-regular",
  getTempNoteIds: "legacy-db:get-temp-note-ids",
  getTempNoteIdByExternalPath: "legacy-db:get-temp-note-id-by-external-path",
  syncExternalNoteToFile: "legacy-db:sync-external-note-to-file",
  getExternalSyncState: "legacy-db:get-external-sync-state",
  deleteTempNote: "legacy-db:delete-temp-note"
};
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args) {
    const [channel, listener] = args;
    return electron.ipcRenderer.on(channel, (event, ...args2) => listener(event, ...args2));
  },
  off(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.off(channel, ...omit);
  },
  send(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.send(channel, ...omit);
  },
  invoke(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.invoke(channel, ...omit);
  }
  // You can expose other APTs you need here.
  // ...
});
const noteLifecycleApi = {
  listNotes: () => electron.ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.list),
  loadNote: (input) => electron.ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.load, input),
  createNote: (input) => electron.ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.create, input),
  saveNote: (input) => electron.ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.save, input),
  deleteNote: (input) => electron.ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.remove, input),
  getNoteTags: (input) => electron.ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.getNoteTags, input),
  addTagToNote: (input) => electron.ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.addTag, input),
  removeTagFromNote: (input) => electron.ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.removeTag, input),
  reorderNoteTags: (input) => electron.ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.reorderTags, input),
  renameTag: (input) => electron.ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.renameTag, input),
  listTags: () => electron.ipcRenderer.invoke(NOTE_LIFECYCLE_CHANNELS.listTags)
};
electron.contextBridge.exposeInMainWorld("measlyNotes", noteLifecycleApi);
const appStateApi = {
  loadAppState: () => electron.ipcRenderer.invoke(APP_STATE_CHANNELS.loadAppState),
  saveAppState: (state) => electron.ipcRenderer.invoke(APP_STATE_CHANNELS.saveAppState, state),
  loadWindowState: () => electron.ipcRenderer.invoke(APP_STATE_CHANNELS.loadWindowState),
  saveWindowState: (state) => electron.ipcRenderer.invoke(APP_STATE_CHANNELS.saveWindowState, state)
};
electron.contextBridge.exposeInMainWorld("measlyState", appStateApi);
const externalFilesApi = {
  getPendingFilePaths: () => electron.ipcRenderer.invoke(EXTERNAL_FILE_CHANNELS.getPendingPaths),
  readFileContent: (filePath) => electron.ipcRenderer.invoke(EXTERNAL_FILE_CHANNELS.readContent, filePath),
  writeFileContent: (filePath, content) => electron.ipcRenderer.invoke(EXTERNAL_FILE_CHANNELS.writeContent, filePath, content),
  getFileBasename: (filePath) => electron.ipcRenderer.invoke(EXTERNAL_FILE_CHANNELS.basename, filePath),
  onOpenFile: (callback) => {
    const listener = (_event, filePath) => {
      callback(filePath);
    };
    electron.ipcRenderer.on(EXTERNAL_FILE_CHANNELS.opened, listener);
    return () => {
      electron.ipcRenderer.off(EXTERNAL_FILE_CHANNELS.opened, listener);
    };
  }
};
electron.contextBridge.exposeInMainWorld("measlyExternalFiles", externalFilesApi);
const legacyDbApi = {
  getLastEditedNoteId: () => electron.ipcRenderer.invoke(LEGACY_DB_CHANNELS.getLastEditedNoteId),
  getTrashNoteIds: () => electron.ipcRenderer.invoke(LEGACY_DB_CHANNELS.getTrashNoteIds),
  searchNoteIdsByTag: (tagQuery) => electron.ipcRenderer.invoke(LEGACY_DB_CHANNELS.searchNoteIdsByTag, tagQuery),
  saveNoteUiState: (noteId, payload) => electron.ipcRenderer.invoke(LEGACY_DB_CHANNELS.saveNoteUiState, noteId, payload),
  getNoteUiState: (noteId) => electron.ipcRenderer.invoke(LEGACY_DB_CHANNELS.getNoteUiState, noteId),
  saveNoteSnapshot: (noteId, content, isManual) => electron.ipcRenderer.invoke(LEGACY_DB_CHANNELS.saveNoteSnapshot, noteId, content, isManual),
  getNoteSnapshots: (noteId) => electron.ipcRenderer.invoke(LEGACY_DB_CHANNELS.getNoteSnapshots, noteId),
  deleteNoteSnapshot: (snapshotId) => electron.ipcRenderer.invoke(LEGACY_DB_CHANNELS.deleteNoteSnapshot, snapshotId),
  createTempNote: (title, externalPath, originalEncoding) => electron.ipcRenderer.invoke(LEGACY_DB_CHANNELS.createTempNote, title, externalPath, originalEncoding),
  updateTempNoteState: (noteId, hasUnsavedChanges, syncMode) => electron.ipcRenderer.invoke(LEGACY_DB_CHANNELS.updateTempNoteState, noteId, hasUnsavedChanges, syncMode),
  convertTempNoteToRegular: (noteId, newFilePath) => electron.ipcRenderer.invoke(LEGACY_DB_CHANNELS.convertTempNoteToRegular, noteId, newFilePath),
  getTempNoteIds: () => electron.ipcRenderer.invoke(LEGACY_DB_CHANNELS.getTempNoteIds),
  getTempNoteIdByExternalPath: (externalPath) => electron.ipcRenderer.invoke(LEGACY_DB_CHANNELS.getTempNoteIdByExternalPath, externalPath),
  syncExternalNoteToFile: (noteId) => electron.ipcRenderer.invoke(LEGACY_DB_CHANNELS.syncExternalNoteToFile, noteId),
  getExternalSyncState: (noteId) => electron.ipcRenderer.invoke(LEGACY_DB_CHANNELS.getExternalSyncState, noteId),
  deleteTempNote: (noteId) => electron.ipcRenderer.invoke(LEGACY_DB_CHANNELS.deleteTempNote, noteId)
};
electron.contextBridge.exposeInMainWorld("measlyLegacyDb", legacyDbApi);
