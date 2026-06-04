import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { NoteLifecycleService } from './noteLifecycleService'
import { NOTE_LIFECYCLE_CHANNELS } from '../src/shared/noteLifecycle'
import { APP_STATE_CHANNELS, type WindowState } from '../src/shared/appState'
import { StateService } from './stateService'
import { DatabaseService } from './databaseService'
import { EXTERNAL_FILE_CHANNELS } from '../src/shared/externalFiles'
import { LEGACY_DB_CHANNELS } from '../src/shared/legacyDbFeatures'
import { TEXTURE_CHANNELS } from '../src/shared/textures'
import { LOADOUT_CHANNELS } from '../src/shared/loadouts'

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
let databaseService: DatabaseService | null = null;
let pendingExternalFilePaths: string[] = [];

const OPENABLE_EXTENSIONS = new Set(['.md', '.txt']);

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function isOpenableExternalFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return OPENABLE_EXTENSIONS.has(ext) && existsSync(filePath);
}

function extractOpenablePaths(argv: string[]): string[] {
  return argv
    .map((value) => value.replace(/^"|"$/g, ''))
    .filter((value) => value.length > 0)
    .filter((value) => path.isAbsolute(value))
    .filter((value) => isOpenableExternalFile(value));
}

function enqueueExternalFilePaths(filePaths: string[]): void {
  const seen = new Set(pendingExternalFilePaths);
  for (const filePath of filePaths) {
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    pendingExternalFilePaths.push(filePath);
  }
}

function flushPendingExternalPathsToRenderer(): void {
  if (!win || win.isDestroyed()) return;
  if (pendingExternalFilePaths.length === 0) return;

  const paths = [...pendingExternalFilePaths];
  pendingExternalFilePaths = [];
  for (const filePath of paths) {
    win.webContents.send(EXTERNAL_FILE_CHANNELS.opened, filePath);
  }
}

function resolveDataRoot(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'data');
  }
  return path.join(process.env.APP_ROOT, 'data');
}

function registerIpcHandlers() {
  if (!databaseService) {
    databaseService = new DatabaseService(resolveDataRoot())
  }
  if (!noteLifecycleService) {
    noteLifecycleService = new NoteLifecycleService(resolveDataRoot(), databaseService);
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

  ipcMain.handle(EXTERNAL_FILE_CHANNELS.getPendingPaths, async () => {
    const paths = [...pendingExternalFilePaths];
    pendingExternalFilePaths = [];
    return paths;
  });

  ipcMain.handle(EXTERNAL_FILE_CHANNELS.readContent, async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !isOpenableExternalFile(filePath)) return null;
    try {
      return readFileSync(filePath, 'utf8');
    } catch {
      return null;
    }
  });

  ipcMain.handle(EXTERNAL_FILE_CHANNELS.writeContent, async (_event, filePath: unknown, content: unknown) => {
    if (typeof filePath !== 'string' || typeof content !== 'string') return false;
    if (!isOpenableExternalFile(filePath)) return false;
    try {
      writeFileSync(filePath, content, 'utf8');
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle(EXTERNAL_FILE_CHANNELS.basename, async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string') return '';
    try {
      return path.basename(filePath);
    } catch {
      return '';
    }
  });

  ipcMain.handle(LEGACY_DB_CHANNELS.getLastEditedNoteId, async () => databaseService!.getLastEditedNoteId());
  ipcMain.handle(LEGACY_DB_CHANNELS.getTrashNoteIds, async () => databaseService!.getTrashNoteIds());
  ipcMain.handle(LEGACY_DB_CHANNELS.searchNoteIdsByTag, async (_event, tagQuery: string) =>
    databaseService!.searchNoteIdsByTag(tagQuery),
  );
  ipcMain.handle(LEGACY_DB_CHANNELS.saveNoteUiState, async (_event, noteId: string, payload) => {
    databaseService!.saveNoteUiState(noteId, payload ?? {});
  });
  ipcMain.handle(LEGACY_DB_CHANNELS.getNoteUiState, async (_event, noteId: string) =>
    databaseService!.getNoteUiState(noteId),
  );
  ipcMain.handle(LEGACY_DB_CHANNELS.saveNoteSnapshot, async (_event, noteId: string, content: string, isManual?: boolean) => {
    databaseService!.saveNoteSnapshot(noteId, content, Boolean(isManual));
  });
  ipcMain.handle(LEGACY_DB_CHANNELS.getNoteSnapshots, async (_event, noteId: string) =>
    databaseService!.getNoteSnapshots(noteId),
  );
  ipcMain.handle(LEGACY_DB_CHANNELS.deleteNoteSnapshot, async (_event, snapshotId: number) => {
    databaseService!.deleteNoteSnapshot(snapshotId);
  });
  ipcMain.handle(LEGACY_DB_CHANNELS.createTempNote, async (_event, title: string, externalPath: string, originalEncoding?: string) =>
    databaseService!.createTempNote({ title, externalPath, originalEncoding }),
  );
  ipcMain.handle(LEGACY_DB_CHANNELS.updateTempNoteState, async (_event, noteId: string, hasUnsavedChanges: boolean, syncMode: boolean) => {
    databaseService!.updateTempNoteState(noteId, hasUnsavedChanges, syncMode);
  });
  ipcMain.handle(LEGACY_DB_CHANNELS.convertTempNoteToRegular, async (_event, noteId: string, newFilePath: string) => {
    databaseService!.convertTempNoteToRegular(noteId, newFilePath);
  });
  ipcMain.handle(LEGACY_DB_CHANNELS.getTempNoteIds, async () => databaseService!.getTempNoteIds());
  ipcMain.handle(LEGACY_DB_CHANNELS.getTempNoteIdByExternalPath, async (_event, externalPath: string) =>
    databaseService!.getTempNoteIdByExternalPath(externalPath),
  );
  ipcMain.handle(LEGACY_DB_CHANNELS.getExternalSyncState, async (_event, noteId: string) =>
    databaseService!.getExternalSyncState(noteId),
  );
  ipcMain.handle(LEGACY_DB_CHANNELS.syncExternalNoteToFile, async (_event, noteId: string) => {
    const record = databaseService!.getNoteRecord(noteId);
    if (!record?.isTemp || !record.externalPath) {
      return false;
    }

    const content = databaseService!.getNoteContentSnapshot(noteId);
    if (content === null) {
      return false;
    }

    try {
      writeFileSync(record.externalPath, content, 'utf8');
      databaseService!.markExternalNoteSynced(noteId);
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle(LEGACY_DB_CHANNELS.deleteTempNote, async (_event, noteId: string) => {
    databaseService!.deleteTempNote(noteId);
  });

  ipcMain.handle(TEXTURE_CHANNELS.getCached, async (_event, request) => {
    return databaseService!.getTextureCache(request);
  });

  ipcMain.handle(TEXTURE_CHANNELS.saveCached, async (_event, request, payload) => {
    databaseService!.saveTextureCache(request, payload);
  });

  ipcMain.handle(TEXTURE_CHANNELS.purgeCached, async (_event, request) => {
    return databaseService!.purgeTextureCache(request);
  });

  ipcMain.handle(LOADOUT_CHANNELS.list, async () => {
    return databaseService!.listUiLoadouts();
  });

  ipcMain.handle(LOADOUT_CHANNELS.save, async (_event, slot, loadout) => {
    return databaseService!.saveUiLoadout(slot, loadout);
  });
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
    flushPendingExternalPathsToRenderer()
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('second-instance', (_event, argv) => {
  const paths = extractOpenablePaths(argv);
  enqueueExternalFilePaths(paths);

  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) {
      win.restore();
    }
    win.focus();
    flushPendingExternalPathsToRenderer();
  }
});

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (!isOpenableExternalFile(filePath)) return;
  enqueueExternalFilePaths([filePath]);
  flushPendingExternalPathsToRenderer();
});

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
  enqueueExternalFilePaths(extractOpenablePaths(process.argv));
  if (!databaseService) {
    databaseService = new DatabaseService(resolveDataRoot())
  }
  await databaseService.initialize()
  await databaseService.bootstrapFromFilesystem()
  const sanity = databaseService.runSanityChecks()
  if (sanity.missingNoteFiles.length > 0 || sanity.orphanedTagRows > 0) {
    console.warn('[db] startup sanity issues', sanity)
  }
  registerIpcHandlers()
  await createWindow()
}).catch((error) => {
  console.error('[main] fatal startup failure', error)
  app.quit()
})

app.on('before-quit', () => {
  databaseService?.close()
})
