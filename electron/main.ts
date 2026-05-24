import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { NoteLifecycleService } from './noteLifecycleService'
import { NOTE_LIFECYCLE_CHANNELS } from '../src/shared/noteLifecycle'
import { APP_STATE_CHANNELS, type WindowState } from '../src/shared/appState'
import { StateService } from './stateService'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
let noteLifecycleService: NoteLifecycleService | null = null;
let stateService: StateService | null = null;

function resolveDataRoot(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'data');
  }
  return path.join(process.env.APP_ROOT, 'data');
}

function registerIpcHandlers() {
  if (!noteLifecycleService) {
    noteLifecycleService = new NoteLifecycleService(resolveDataRoot());
  }
  if (!stateService) {
    stateService = new StateService(resolveDataRoot());
  }

  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.list, async () => noteLifecycleService!.listNotes());
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.load, async (_event, input) => noteLifecycleService!.loadNote(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.create, async (_event, input) => noteLifecycleService!.createNote(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.save, async (_event, input) => noteLifecycleService!.saveNote(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.remove, async (_event, input) => noteLifecycleService!.deleteNote(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.getNoteTags, async (_event, input) => noteLifecycleService!.getNoteTags(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.addTag, async (_event, input) => noteLifecycleService!.addTagToNote(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.removeTag, async (_event, input) => noteLifecycleService!.removeTagFromNote(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.reorderTags, async (_event, input) => noteLifecycleService!.reorderNoteTags(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.renameTag, async (_event, input) => noteLifecycleService!.renameTag(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.listTags, async () => noteLifecycleService!.listTags());

  ipcMain.handle(APP_STATE_CHANNELS.loadAppState, async () => stateService!.loadAppState());
  ipcMain.handle(APP_STATE_CHANNELS.saveAppState, async (_event, payload) => stateService!.saveAppState(payload));
  ipcMain.handle(APP_STATE_CHANNELS.loadWindowState, async () => stateService!.loadWindowState());
  ipcMain.handle(APP_STATE_CHANNELS.saveWindowState, async (_event, payload) => stateService!.saveWindowState(payload));
}

function readCurrentWindowState(windowRef: BrowserWindow): WindowState {
  const bounds = windowRef.getBounds();
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: windowRef.isMaximized(),
  };
}

async function createWindow() {
  if (!stateService) {
    stateService = new StateService(resolveDataRoot());
  }

  const savedWindowState = await stateService.loadWindowState();

  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    width: savedWindowState.width,
    height: savedWindowState.height,
    x: savedWindowState.x,
    y: savedWindowState.y,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  if (savedWindowState.isMaximized) {
    win.maximize();
  }

  const persistWindowState = () => {
    if (!win || !stateService) return;
    void stateService.saveWindowState(readCurrentWindowState(win));
  };

  win.on('resize', persistWindowState);
  win.on('move', persistWindowState);
  win.on('maximize', persistWindowState);
  win.on('unmaximize', persistWindowState);
  win.on('close', persistWindowState);

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow()
  }
})

app.whenReady().then(async () => {
  registerIpcHandlers()
  await createWindow()
})
