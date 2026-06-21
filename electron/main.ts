import { app, BrowserWindow, Menu, ipcMain, dialog } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { existsSync, promises as fsPromises, readFileSync, writeFileSync } from 'node:fs'
import { NoteLifecycleService } from './noteLifecycleService'
import { FILE_SYNC_CHANNELS } from '../src/shared/fileSync'
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

function normalizeExternalFilePath(value: string): string {
  const trimmed = value.trim().replace(/^"|"$/g, '');
  const normalized = path.normalize(trimmed);
  if (path.isAbsolute(normalized)) {
    return normalized;
  }
  return path.resolve(process.cwd(), normalized);
}

function isOpenableExternalFile(filePath: string): boolean {
  const normalizedPath = normalizeExternalFilePath(filePath);
  const ext = path.extname(normalizedPath).toLowerCase();
  return OPENABLE_EXTENSIONS.has(ext) && existsSync(normalizedPath);
}

function extractOpenablePaths(argv: string[]): string[] {
  return argv
    .map((value) => normalizeExternalFilePath(value))
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

async function importNotesFromPaths(filePaths: string[]): Promise<{ imported: number; createdNoteIds: string[]; errors: string[] }> {
  const createdNoteIds: string[] = []
  const errors: string[] = []

  if (!noteLifecycleService) {
    return { imported: 0, createdNoteIds, errors: ['Note lifecycle service is unavailable'] }
  }

  for (const filePath of filePaths) {
    try {
      const normalizedPath = normalizeExternalFilePath(filePath)
      const content = await fsPromises.readFile(normalizedPath, 'utf8')
      const note = await noteLifecycleService.createNote({ initialText: content })
      createdNoteIds.push(note.id)
    } catch (error) {
      errors.push(String(error instanceof Error ? error.message : error))
    }
  }

  return { imported: createdNoteIds.length, createdNoteIds, errors }
}

async function importNotesFromFolder(folderPath: string): Promise<{ imported: number; createdNoteIds: string[]; errors: string[] }> {
  try {
    const entries = await fsPromises.readdir(folderPath, { withFileTypes: true })
    const filePaths = entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(folderPath, entry.name))
      .filter((candidate) => ['.md', '.txt'].includes(path.extname(candidate).toLowerCase()))

    return importNotesFromPaths(filePaths)
  } catch (error) {
    return {
      imported: 0,
      createdNoteIds: [],
      errors: [String(error instanceof Error ? error.message : error)],
    }
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

  ipcMain.handle(FILE_SYNC_CHANNELS.syncExistingNotes, async () => {
    if (!databaseService) {
      return { createdNoteIds: [], updatedPaths: [], markedDeletedNoteIds: [] }
    }

    const beforeIds = new Set(databaseService.listNoteRecords().map((note) => note.id))
    await databaseService.bootstrapFromFilesystem()
    const afterNotes = databaseService.listNoteRecords()
    const createdNoteIds = afterNotes.filter((note) => !beforeIds.has(note.id)).map((note) => note.id)

    return {
      createdNoteIds,
      updatedPaths: [],
      markedDeletedNoteIds: [],
    }
  })

  ipcMain.handle(FILE_SYNC_CHANNELS.importNotes, async (event) => {
    const winRef = BrowserWindow.fromWebContents(event.sender) ?? win
    if (!winRef) {
      return { imported: 0, createdNoteIds: [], errors: ['No active window available'] }
    }

    try {
      const result = await dialog.showOpenDialog(winRef, {
        properties: ['openFile', 'openDirectory', 'multiSelections'],
        filters: [
          { name: 'Markdown and Text Files', extensions: ['md', 'txt'] },
        ],
        title: 'Select files or folders to import',
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { imported: 0, createdNoteIds: [] }
      }

      let imported = 0
      const createdNoteIds: string[] = []
      const errors: string[] = []

      for (const selectedPath of result.filePaths) {
        try {
          const stats = await fsPromises.stat(selectedPath)
          if (stats.isDirectory()) {
            const folderResult = await importNotesFromFolder(selectedPath)
            imported += folderResult.imported
            createdNoteIds.push(...folderResult.createdNoteIds)
            if (folderResult.errors) errors.push(...folderResult.errors)
          } else if (stats.isFile()) {
            const fileResult = await importNotesFromPaths([selectedPath])
            imported += fileResult.imported
            createdNoteIds.push(...fileResult.createdNoteIds)
            if (fileResult.errors) errors.push(...fileResult.errors)
          }
        } catch (error) {
          errors.push(String(error instanceof Error ? error.message : error))
        }
      }

      return { imported, createdNoteIds, errors }
    } catch (error) {
      return { imported: 0, createdNoteIds: [], errors: [String(error instanceof Error ? error.message : error)] }
    }
  })

  ipcMain.on('window-control', (_event, action: string) => {
    if (!win || win.isDestroyed()) return

    switch (action) {
      case 'minimize':
        win.minimize()
        break
      case 'toggle-maximize':
        if (win.isMaximized()) {
          win.unmaximize()
        } else {
          win.maximize()
        }
        break
      case 'close':
        win.close()
        break
      default:
        break
    }
  })

  ipcMain.handle(EXTERNAL_FILE_CHANNELS.getPendingPaths, async () => {
    const paths = [...pendingExternalFilePaths];
    pendingExternalFilePaths = [];
    return paths;
  });

  ipcMain.handle(EXTERNAL_FILE_CHANNELS.readContent, async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !isOpenableExternalFile(filePath)) return null;
    const normalizedPath = normalizeExternalFilePath(filePath);
    try {
      return readFileSync(normalizedPath, 'utf8');
    } catch {
      return null;
    }
  });

  ipcMain.handle(EXTERNAL_FILE_CHANNELS.writeContent, async (_event, filePath: unknown, content: unknown) => {
    if (typeof filePath !== 'string' || typeof content !== 'string') return false;
    if (!isOpenableExternalFile(filePath)) return false;
    const normalizedPath = normalizeExternalFilePath(filePath);
    try {
      writeFileSync(normalizedPath, content, 'utf8');
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle(EXTERNAL_FILE_CHANNELS.basename, async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string') return '';
    try {
      return path.basename(normalizeExternalFilePath(filePath));
    } catch {
      return '';
    }
  });

  ipcMain.handle('select-export-folder', async (event) => {
    try {
      const winRef = BrowserWindow.fromWebContents(event.sender) ?? win
      if (!winRef) return null
      const result = await dialog.showOpenDialog(winRef, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select export destination',
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    } catch (error) {
      console.warn('[main] select-export-folder failed', error)
      return null
    }
  })

  ipcMain.handle('export-pdf', async (event, folderPath: string, fileName: string, htmlContent?: string) => {
    try {
      if (!folderPath || !fileName) return { ok: false, error: 'Invalid arguments' }
      await fsPromises.mkdir(folderPath, { recursive: true })

      const sanitize = (input: string) => input.replace(/[<>:"/\\|?*]+/g, '_')
      const base = sanitize(fileName)
      let outPath = path.join(folderPath, base)
      const exists = await fsPromises.stat(outPath).then(() => true).catch(() => false)
      if (exists) {
        const now = new Date()
        const hh = String(now.getHours()).padStart(2, '0')
        const mm = String(now.getMinutes()).padStart(2, '0')
        const timeSuffix = ` (${hh}-${mm})`
        const ext = path.extname(base)
        const nameOnly = base.substring(0, base.length - ext.length)
        let candidate = `${nameOnly}${timeSuffix}${ext}`
        let candidatePath = path.join(folderPath, candidate)
        let counter = 1
        while (await fsPromises.stat(candidatePath).then(() => true).catch(() => false)) {
          counter += 1
          candidate = `${nameOnly}${timeSuffix} v${counter}${ext}`
          candidatePath = path.join(folderPath, candidate)
        }
        outPath = candidatePath
      }

      const pdfOpts: any = {
        printBackground: true,
        pageSize: 'A4',
      }

      const data = await event.sender.printToPDF(pdfOpts)
      await fsPromises.writeFile(outPath, data)

      if (htmlContent && typeof htmlContent === 'string') {
        const htmlName = `${path.basename(outPath, path.extname(outPath))}.html`
        const htmlPath = path.join(folderPath, htmlName)
        await fsPromises.writeFile(htmlPath, htmlContent, 'utf8')
      }

      return { ok: true, path: outPath }
    } catch (error: any) {
      console.warn('[main] export-pdf failed', error)
      return { ok: false, error: error?.message ?? String(error) }
    }
  })

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
  minWidth: 840,
  minHeight: 525,
  frame: false,
  titleBarStyle: 'hidden',
  autoHideMenuBar: true,
  webPreferences: {
    preload: path.join(__dirname, 'preload.mjs'),
  },
})

  win.setMenuBarVisibility(false)

  if (savedWindowState.isMaximized) {
    win.maximize();
  }

  const persistWindowState = () => {
    if (!win || !stateService) return;
    void stateService.saveWindowState(readCurrentWindowState(win));
  };

  win.on('resize', persistWindowState);
  win.on('move', persistWindowState);
  win.on('maximize', () => {
    persistWindowState()
    if (win && !win.isDestroyed()) {
      win.webContents.send('window-maximize-state', true)
    }
  });
  win.on('unmaximize', () => {
    persistWindowState()
    if (win && !win.isDestroyed()) {
      win.webContents.send('window-maximize-state', false)
    }
  });
  win.on('close', persistWindowState);

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
    win?.webContents.send('window-maximize-state', win.isMaximized())
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
  Menu.setApplicationMenu(null)
  await createWindow()
}).catch((error) => {
  console.error('[main] fatal startup failure', error)
  app.quit()
})

let isQuitting = false;
app.on('before-quit', (event) => {
  databaseService?.close()
  if (!stateService || isQuitting) return
  // Prevent the default quit, flush state to disk, then re-quit.
  // This guarantees the last-known app state is written even if the
  // renderer's async IPC call didn't complete before close.
  event.preventDefault()
  isQuitting = true
  stateService.flushAppStateOnClose().finally(() => app.quit())
})
