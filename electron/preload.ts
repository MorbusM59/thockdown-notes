import { ipcRenderer, contextBridge } from 'electron'
import type {
  CreateNoteInput,
  DeleteNoteInput,
  LoadNoteInput,
  NoteLifecycleApi,
  SaveNoteInput,
} from '../src/shared/noteLifecycle'
import { NOTE_LIFECYCLE_CHANNELS } from '../src/shared/noteLifecycle'
import type { AppStateApi } from '../src/shared/appState'
import { APP_STATE_CHANNELS } from '../src/shared/appState'

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
}

contextBridge.exposeInMainWorld('measlyNotes', noteLifecycleApi)

const appStateApi: AppStateApi = {
  loadAppState: () => ipcRenderer.invoke(APP_STATE_CHANNELS.loadAppState),
  saveAppState: (state) => ipcRenderer.invoke(APP_STATE_CHANNELS.saveAppState, state),
  loadWindowState: () => ipcRenderer.invoke(APP_STATE_CHANNELS.loadWindowState),
  saveWindowState: (state) => ipcRenderer.invoke(APP_STATE_CHANNELS.saveWindowState, state),
}

contextBridge.exposeInMainWorld('measlyState', appStateApi)
