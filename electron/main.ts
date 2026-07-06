import { app, BrowserWindow, Menu, ipcMain, dialog, protocol } from 'electron'
import type { Session } from 'electron'
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
import { TEXTURE_CHANNELS } from '../src/shared/textures'
import { LOADOUT_CHANNELS } from '../src/shared/loadouts'
import { AUDIO_PLAYER_CHANNELS, AUDIO_EXTENSIONS } from '../src/shared/audioPlayer'
import type { PlaylistSlot } from '../src/shared/audioPlayer'

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

// Chromium's built-in spellchecker (used for the contentEditable regions in
// both edit mode and, optionally, render view) needs to be told which
// dictionaries to load. We resolve the OS-preferred language(s) plus English
// (deduped, and only if English isn't already one of the OS languages), and
// match each against the dictionaries Chromium actually ships.
function configureSpellChecker(session: Session) {
  try {
    const available = session.availableSpellCheckerLanguages
    if (!available || available.length === 0) return

    const osLanguages = app.getPreferredSystemLanguages()
    const wanted = [...osLanguages, 'en-US', 'en']

    const resolved: string[] = []
    for (const lang of wanted) {
      const normalized = lang.toLowerCase()
      const exact = available.find((code) => code.toLowerCase() === normalized)
      const baseMatch = exact ?? available.find((code) => code.toLowerCase().startsWith(normalized.slice(0, 2)))
      if (baseMatch && !resolved.includes(baseMatch)) {
        resolved.push(baseMatch)
      }
    }

    session.setSpellCheckerLanguages(resolved.length > 0 ? resolved : ['en-US'])
  } catch (error) {
    console.warn('Failed to configure spell checker languages', error)
  }
}

function resolveWindowIconPath(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.APP_ROOT, 'assets', 'icon.ico')
  }

  if (process.platform === 'darwin') {
    return path.join(process.env.APP_ROOT, 'assets', 'icon.icns')
  }

  return path.join(process.env.APP_ROOT, 'assets', 'icon.png')
}

let win: BrowserWindow | null
let noteLifecycleService: NoteLifecycleService | null = null;
let stateService: StateService | null = null;
let databaseService: DatabaseService | null = null;
let pendingExternalFilePaths: string[] = [];
let windowIsUtilityCollapsed = false;
let utilityCollapseRestoreState: WindowState | null = null;
let alwaysOnTopBeforeUtilityCollapse: boolean | null = null;

const UTILITY_COLLAPSE_MIN_WIDTH_PX = 96;
const UTILITY_COLLAPSE_MIN_HEIGHT_PX = 72;
const APP_WINDOW_MIN_WIDTH_PX = 840;
const APP_WINDOW_MIN_HEIGHT_PX = 525;

// Matches the renderer's DEFAULT_BASE_PALETTE_COLOR (src/App.tsx). Used as the
// BrowserWindow's native backing-store fill until the renderer reports the
// active theme's resolved background color (see 'window-control:report-
// background-color' below). Without this, Chromium falls back to opaque
// white for any window surface it hasn't painted content into yet, which is
// visible as a white flash whenever the OS-level window grows faster than
// the renderer can repaint (e.g. expanding out of utility/mini mode).
const DEFAULT_ROOT_BACKGROUND_COLOR_HEX = '#F9F6F4';
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
let currentRootBackgroundColorHex = DEFAULT_ROOT_BACKGROUND_COLOR_HEX;

const OPENABLE_EXTENSIONS = new Set(['.md', '.txt']);

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

// Register the measly-music:// protocol BEFORE app.ready so Electron treats it
// as a privileged scheme.  The handler (registered after ready) proxies the
// request through net.fetch() to a file:// URL, which works from the main
// process regardless of whether the renderer loaded from http://localhost (dev)
// or file:// (production).
protocol.registerSchemesAsPrivileged([
  { scheme: 'measly-music', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);

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
      const note = await noteLifecycleService.createNote({ initialText: content, initialTags: ['import'] })
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

async function createHiddenExportWindow(htmlContent: string): Promise<BrowserWindow> {
  const exportWindow = new BrowserWindow({
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  })

  const tempHtmlPath = path.join(app.getPath('temp'), `measly-notes-export-${Date.now()}.html`)
  await fsPromises.writeFile(tempHtmlPath, htmlContent, 'utf8')

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Export page load timeout'))
    }, 15000)

    const cleanup = () => {
      clearTimeout(timeout)
      exportWindow.webContents.removeAllListeners('did-finish-load')
      exportWindow.webContents.removeAllListeners('did-fail-load')
    }

    exportWindow.webContents.once('did-finish-load', async () => {
      cleanup()
      try {
        await exportWindow!.webContents.executeJavaScript('document.fonts.ready')
      } catch {
        // Continue even if fonts.ready is unavailable or fails.
      }
      resolve()
    })
    exportWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
      cleanup()
      reject(new Error(`Export page failed to load: ${errorCode} ${errorDescription}`))
    })

    exportWindow.loadFile(tempHtmlPath).catch((error) => {
      cleanup()
      reject(error)
    })
  })

  exportWindow.once('closed', () => {
    fsPromises.unlink(tempHtmlPath).catch(() => {})
  })

  return exportWindow
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
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.saveNoteUiState, async (_event, input) => noteLifecycleService!.saveNoteUiState(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.getNoteUiState, async (_event, input) => noteLifecycleService!.getNoteUiState(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.updateExternalNoteState, async (_event, input) => noteLifecycleService!.updateExternalNoteState(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.saveNoteSnapshot, async (_event, input) => noteLifecycleService!.saveNoteSnapshot(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.getNoteSnapshots, async (_event, input) => noteLifecycleService!.getNoteSnapshots(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.branchNoteFromSnapshot, async (_event, input) => noteLifecycleService!.branchNoteFromSnapshot(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.syncExternalNoteToFile, async (_event, input) => noteLifecycleService!.syncExternalNoteToFile(input));
  ipcMain.handle(NOTE_LIFECYCLE_CHANNELS.getNoteIdByExternalPath, async (_event, input) => noteLifecycleService!.getNoteIdByExternalPath(input));

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
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Markdown and Text Files', extensions: ['md', 'txt'] },
        ],
        title: 'Select files to import',
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
        if (windowIsUtilityCollapsed) {
          restoreWindowFromUtilityCollapse()
        }
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

  ipcMain.handle('window-control:toggle-utility-collapse', (_event, payload: unknown) => {
    if (!win || win.isDestroyed()) return false

    if (windowIsUtilityCollapsed) {
      return restoreWindowFromUtilityCollapse()
    }

    const targetSize = resolveUtilityCollapseSize(payload)
    return collapseWindowToUtilityGrid(targetSize)
  })

  // The renderer reports the active theme's resolved root background color
  // (opaque #RRGGBB) whenever it changes, so the native window's own paint
  // fallback stays in sync with the current preset. This closes the white-
  // flash gap during native bounds changes (see restoreWindowFromUtilityCollapse)
  // where Chromium has to fill screen area the renderer hasn't painted yet.
  ipcMain.on('window-control:report-background-color', (_event, hex: unknown) => {
    if (typeof hex !== 'string' || !HEX_COLOR_PATTERN.test(hex)) return
    currentRootBackgroundColorHex = hex
    if (win && !win.isDestroyed()) {
      win.setBackgroundColor(hex)
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

  ipcMain.handle('export-pdf', async (_event, folderPath: string, fileName: string, htmlContent?: string) => {
    let exportWindow: BrowserWindow | null = null
    try {
      if (!folderPath || !fileName || typeof htmlContent !== 'string') {
        return { ok: false, error: 'Invalid export arguments' }
      }
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

      exportWindow = await createHiddenExportWindow(htmlContent)

      const pdfOpts: any = {
        printBackground: true,
        pageSize: 'A4',
      }

      const data = await exportWindow.webContents.printToPDF(pdfOpts)
      await fsPromises.writeFile(outPath, data)

      return { ok: true, path: outPath }
    } catch (error: any) {
      console.warn('[main] export-pdf failed', error)
      return { ok: false, error: error?.message ?? String(error) }
    } finally {
      if (exportWindow && !exportWindow.isDestroyed()) {
        exportWindow.destroy()
      }
    }
  })

  ipcMain.handle('export-md', async (_event, noteId: string, folderPath: string, fileName: string) => {
    try {
      if (!noteId || !folderPath || !fileName) {
        return { ok: false, error: 'Invalid export arguments' }
      }
      const sourcePath = path.join(resolveDataRoot(), 'notes', `${noteId}.md`)
      const sourceExists = await fsPromises.stat(sourcePath).then(() => true).catch(() => false)
      if (!sourceExists) {
        return { ok: false, error: 'Source note file not found' }
      }
      await fsPromises.mkdir(folderPath, { recursive: true })
      const sanitize = (input: string) => input.replace(/[<>:"/\\|?*]+/g, '_')
      const outPath = path.join(folderPath, sanitize(fileName))
      await fsPromises.copyFile(sourcePath, outPath)
      return { ok: true, path: outPath }
    } catch (error: any) {
      console.warn('[main] export-md failed', error)
      return { ok: false, error: error?.message ?? String(error) }
    }
  })

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

  ipcMain.handle(LOADOUT_CHANNELS.setActive, async (_event, id) => {
    return databaseService!.setActiveUiLoadout(id);
  });

  ipcMain.handle(LOADOUT_CHANNELS.updatePending, async (_event, mode, loadout) => {
    return databaseService!.updatePendingUiLoadout(mode, loadout);
  });

  ipcMain.handle(LOADOUT_CHANNELS.saveCustom, async (_event, mode) => {
    return databaseService!.saveCustomUiLoadout(mode);
  });

  ipcMain.handle(LOADOUT_CHANNELS.deleteCustom, async (_event, id) => {
    return databaseService!.deleteCustomUiLoadout(id);
  });

  ipcMain.handle(LOADOUT_CHANNELS.resetCustom, async (_event, mode) => {
    return databaseService!.resetCustomUiLoadout(mode);
  });

  ipcMain.handle(LOADOUT_CHANNELS.exportTdl, async () => {
    const content = databaseService!.buildTdlContent();
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Export layouts',
      defaultPath: 'my-layouts.tdl',
      filters: [{ name: 'Thockdown Layout', extensions: ['tdl'] }],
    });
    if (canceled || !filePath) return;
    await fsPromises.writeFile(filePath, content, 'utf-8');
  });

  ipcMain.handle(LOADOUT_CHANNELS.exportTdlEntry, async (_event, id: number) => {
    const content = databaseService!.buildTdlContentForEntry(id);
    const defaultName = `layout-${Math.abs(id)}.tdl`;
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Export layout',
      defaultPath: defaultName,
      filters: [{ name: 'Thockdown Layout', extensions: ['tdl'] }],
    });
    if (canceled || !filePath) return;
    await fsPromises.writeFile(filePath, content, 'utf-8');
  });

  ipcMain.handle(LOADOUT_CHANNELS.importTdl, async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Import layouts',
      filters: [{ name: 'Thockdown Layout', extensions: ['tdl'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return databaseService!.listUiLoadouts();
    const content = await fsPromises.readFile(filePaths[0], 'utf-8');
    return databaseService!.importTdlLoadouts(content);
  });

  // ---- Music player --------------------------------------------------------

  const AUDIO_FILTER = [{
    name: 'Audio Files',
    extensions: [...AUDIO_EXTENSIONS].map((ext) => ext.slice(1)), // strip leading dot
  }];

  ipcMain.handle(AUDIO_PLAYER_CHANNELS.pickFiles, async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Add songs',
      filters: AUDIO_FILTER,
      properties: ['openFile', 'multiSelections'],
    });
    return canceled ? [] : filePaths;
  });

  ipcMain.handle(AUDIO_PLAYER_CHANNELS.pickFolder, async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Add folder of songs',
      properties: ['openDirectory'],
    });
    return canceled || filePaths.length === 0 ? null : filePaths[0];
  });

  ipcMain.handle(AUDIO_PLAYER_CHANNELS.scanFolderForAudio, async (_event, folderPath: string) => {
    const results: string[] = [];
    const scan = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fsPromises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await scan(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (AUDIO_EXTENSIONS.has(ext)) {
            results.push(fullPath);
          }
        }
      }
    };
    await scan(folderPath);
    return results;
  });

  ipcMain.handle(AUDIO_PLAYER_CHANNELS.getPlaylist, async (_event, slot: PlaylistSlot) => {
    return databaseService!.getMusicPlaylist(slot);
  });

  ipcMain.handle(AUDIO_PLAYER_CHANNELS.addSongs, async (_event, slot: PlaylistSlot, filePaths: string[]) => {
    return databaseService!.addMusicSongs(slot, filePaths);
  });

  ipcMain.handle(AUDIO_PLAYER_CHANNELS.clearPlaylist, async (_event, slot: PlaylistSlot) => {
    databaseService!.clearMusicPlaylist(slot);
  });

  ipcMain.handle(AUDIO_PLAYER_CHANNELS.removeSong, async (_event, id: number) => {
    databaseService!.removeMusicSong(id);
  });

  ipcMain.handle(AUDIO_PLAYER_CHANNELS.pickNextSong, async (_event, activeSlots: PlaylistSlot[]) => {
    return databaseService!.pickNextMusicSong(activeSlots);
  });

  ipcMain.handle(AUDIO_PLAYER_CHANNELS.afterPlay, async (_event, id: number) => {
    databaseService!.afterMusicPlay(id);
  });

  ipcMain.handle(AUDIO_PLAYER_CHANNELS.favoriteSong, async (_event, id: number) => {
    return databaseService!.favoriteMusicSong(id);
  });

  ipcMain.handle(AUDIO_PLAYER_CHANNELS.skipSong, async (_event, id: number) => {
    databaseService!.skipMusicSong(id);
  });

  ipcMain.handle(AUDIO_PLAYER_CHANNELS.purgeSong, async (_event, id: number) => {
    databaseService!.purgeMusicSong(id);
  });

  ipcMain.handle(AUDIO_PLAYER_CHANNELS.getPlaylistCounts, async () => {
    return databaseService!.getMusicPlaylistCounts();
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

function readPersistableWindowState(windowRef: BrowserWindow): WindowState {
  if (windowIsUtilityCollapsed && utilityCollapseRestoreState) {
    return { ...utilityCollapseRestoreState };
  }
  return readCurrentWindowState(windowRef);
}

function emitWindowCollapsedState(): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('window-collapsed-state', windowIsUtilityCollapsed);
}

function resolveUtilityCollapseSize(input: unknown): { width: number; height: number } {
  if (!input || typeof input !== 'object') {
    return { width: UTILITY_COLLAPSE_MIN_WIDTH_PX, height: UTILITY_COLLAPSE_MIN_HEIGHT_PX };
  }

  const rawWidth = Number((input as { width?: unknown }).width);
  const rawHeight = Number((input as { height?: unknown }).height);

  const width = Number.isFinite(rawWidth)
    ? Math.max(UTILITY_COLLAPSE_MIN_WIDTH_PX, Math.round(rawWidth))
    : UTILITY_COLLAPSE_MIN_WIDTH_PX;

  const height = Number.isFinite(rawHeight)
    ? Math.max(UTILITY_COLLAPSE_MIN_HEIGHT_PX, Math.round(rawHeight))
    : UTILITY_COLLAPSE_MIN_HEIGHT_PX;

  return { width, height };
}

function applyUtilityCollapseWindowConstraints(windowRef: BrowserWindow): void {
  windowRef.setMinimumSize(UTILITY_COLLAPSE_MIN_WIDTH_PX, UTILITY_COLLAPSE_MIN_HEIGHT_PX);
  windowRef.setResizable(false);
}

function applyNormalWindowConstraints(windowRef: BrowserWindow): void {
  windowRef.setResizable(true);
  windowRef.setMinimumSize(APP_WINDOW_MIN_WIDTH_PX, APP_WINDOW_MIN_HEIGHT_PX);
}

function collapseWindowToUtilityGrid(targetSize: { width: number; height: number }): boolean {
  if (!win || win.isDestroyed()) return false;
  if (windowIsUtilityCollapsed) return true;

  if (win.isMaximized()) {
    win.unmaximize();
  }

  const restoreState = readCurrentWindowState(win);
  utilityCollapseRestoreState = {
    ...restoreState,
    isMaximized: false,
  };

  const currentBounds = win.getBounds();
  const nextX = currentBounds.x + (currentBounds.width - targetSize.width);
  const nextY = currentBounds.y;

  alwaysOnTopBeforeUtilityCollapse = win.isAlwaysOnTop();
  windowIsUtilityCollapsed = true;
  applyUtilityCollapseWindowConstraints(win);
  win.setAlwaysOnTop(true);
  win.setBounds({ x: nextX, y: nextY, width: targetSize.width, height: targetSize.height });
  emitWindowCollapsedState();
  return true;
}

function restoreWindowFromUtilityCollapse(): boolean {
  if (!win || win.isDestroyed()) return false;
  if (!windowIsUtilityCollapsed) {
    applyNormalWindowConstraints(win);
    return true;
  }

  const collapsedBounds = win.getBounds();
  const preRestoreOpacity = win.getOpacity();

  const restoreState = utilityCollapseRestoreState;
  windowIsUtilityCollapsed = false;
  utilityCollapseRestoreState = null;

  const shouldKeepAlwaysOnTop = alwaysOnTopBeforeUtilityCollapse ?? false;
  alwaysOnTopBeforeUtilityCollapse = null;

  applyNormalWindowConstraints(win);
  win.setAlwaysOnTop(shouldKeepAlwaysOnTop);
  if (restoreState) {
    if (typeof restoreState.x === 'number' && typeof restoreState.y === 'number') {
      const collapsedTopRightX = collapsedBounds.x + collapsedBounds.width;
      const restoredX = collapsedTopRightX - restoreState.width;
      const restoredY = collapsedBounds.y;
      // Prevent one-frame stale mini-surface bleed during expand on Windows
      // compositor: hide during bounds mutation, then reveal on next tick.
      win.setOpacity(0);
      win.setBounds({
        x: restoredX,
        y: restoredY,
        width: restoreState.width,
        height: restoreState.height,
      });
      setTimeout(() => {
        if (win && !win.isDestroyed()) {
          win.setOpacity(preRestoreOpacity);
        }
      }, 50);
    } else {
      win.setSize(restoreState.width, restoreState.height);
    }
  }

  emitWindowCollapsedState();
  return true;
}

async function createWindow() {
  if (!stateService) {
    stateService = new StateService(resolveDataRoot());
  }

  const savedWindowState = await stateService.loadWindowState();
  windowIsUtilityCollapsed = false;
  utilityCollapseRestoreState = null;
  alwaysOnTopBeforeUtilityCollapse = null;

win = new BrowserWindow({
  icon: resolveWindowIconPath(),
  width: savedWindowState.width,
  height: savedWindowState.height,
  x: savedWindowState.x,
  y: savedWindowState.y,
  minWidth: APP_WINDOW_MIN_WIDTH_PX,
  minHeight: APP_WINDOW_MIN_HEIGHT_PX,
  frame: false,
  titleBarStyle: 'hidden',
  autoHideMenuBar: true,
  backgroundColor: currentRootBackgroundColorHex,
  webPreferences: {
    preload: path.join(__dirname, 'preload.mjs'),
  },
})

  configureSpellChecker(win.webContents.session)

  win.setMenuBarVisibility(false)

  if (savedWindowState.isMaximized) {
    win.maximize();
  }

  const persistWindowState = () => {
    if (!win || !stateService) return;
    void stateService.saveWindowState(readPersistableWindowState(win));
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
    win?.webContents.send('window-collapsed-state', windowIsUtilityCollapsed)
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

  // Proxy measly-music:// → file system reads so the renderer can load local
  // audio files regardless of origin (http://localhost in dev, file:// in prod).
  // Supports HTTP Range requests so Chromium can seek within audio files
  // without resetting playback to position 0.
  const AUDIO_MIME: Record<string, string> = {
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
    opus: 'audio/opus', webm: 'audio/webm', weba: 'audio/webm',
  };
  protocol.handle('measly-music', async (request) => {
    try {
      const url = new URL(request.url);
      // url.pathname arrives as '/C:/path/to/file.mp3' on Windows; strip the leading '/'.
      const rawPath = decodeURIComponent(url.pathname);
      const nativePath = rawPath.replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, path.sep);

      const stat = await fsPromises.stat(nativePath);
      const totalSize = stat.size;
      const ext = nativePath.split('.').pop()?.toLowerCase() ?? '';
      const mime = AUDIO_MIME[ext] ?? 'application/octet-stream';

      const rangeHeader = request.headers.get('Range');
      if (rangeHeader) {
        // Parse "bytes=start-end" (end may be omitted)
        const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
        if (match) {
          const start = match[1] ? parseInt(match[1], 10) : 0;
          const end   = match[2] ? parseInt(match[2], 10) : totalSize - 1;
          const chunkSize = end - start + 1;
          const buffer = Buffer.allocUnsafe(chunkSize);
          const fd = await fsPromises.open(nativePath, 'r');
          try {
            await fd.read(buffer, 0, chunkSize, start);
          } finally {
            await fd.close();
          }
          return new Response(buffer, {
            status: 206,
            headers: {
              'Content-Type': mime,
              'Content-Range': `bytes ${start}-${end}/${totalSize}`,
              'Content-Length': String(chunkSize),
              'Accept-Ranges': 'bytes',
            },
          });
        }
      }

      // Full-file response (initial load or no Range header).
      const data = await fsPromises.readFile(nativePath);
      return new Response(data, {
        headers: {
          'Content-Type': mime,
          'Content-Length': String(totalSize),
          'Accept-Ranges': 'bytes',
        },
      });
    } catch (err) {
      console.error('[measly-music protocol] failed to serve', request.url, err);
      return new Response(null, { status: 404 });
    }
  });

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
