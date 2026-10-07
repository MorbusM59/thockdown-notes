import { ipcRenderer, contextBridge, webFrame, webUtils } from 'electron'
import type { NoteLifecycleApi } from '../src/shared/noteLifecycle'
import { NOTE_LIFECYCLE_CHANNELS } from '../src/shared/noteLifecycle'
import type { AppStateApi } from '../src/shared/appState'
import { APP_STATE_CHANNELS } from '../src/shared/appState'
import type { ExternalFilesApi } from '../src/shared/externalFiles'
import { EXTERNAL_FILE_CHANNELS, EXTERNAL_FILE_EVENTS } from '../src/shared/externalFiles'
import type { TextureCacheApi } from '../src/shared/textures'
import { TEXTURE_CHANNELS } from '../src/shared/textures'
import type { AudioBounceCacheApi } from '../src/shared/audioBounceCache'
import { AUDIO_BOUNCE_CHANNELS } from '../src/shared/audioBounceCache'
import type { UiLoadoutApi } from '@thockdown/look/loadouts'
import { LOADOUT_CHANNELS } from '@thockdown/look/loadouts'
import type { SoundscapeFileApi } from '@thockdown/soundscape/soundscapeFile'
import { SOUNDSCAPE_FILE_CHANNELS } from '@thockdown/soundscape/soundscapeFile'
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
import { invokeBridge } from '../src/shared/ipcContract'
import { EXPORT_CHANNELS, type ExportApi } from '../src/shared/exportApi'

// Every request/reply bridge below is built from its channel map by
// `invokeBridge` (see shared/ipcContract.ts).
const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

// --------- Expose some API to the Renderer process ---------
const noteLifecycleApi: NoteLifecycleApi = invokeBridge<NoteLifecycleApi>(NOTE_LIFECYCLE_CHANNELS, invoke)

contextBridge.exposeInMainWorld('thockdownNotes', noteLifecycleApi)

const appStateApi: AppStateApi = invokeBridge<AppStateApi>(APP_STATE_CHANNELS, invoke)

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
  setChromeMinSize: (size: { width: number; widthWithoutSidebar: number; height: number }) =>
    ipcRenderer.send('window-control:chrome-min-size', size),
  setDoubleSizeMode: (enabled: boolean) => ipcRenderer.send('window-control:double-size-mode', enabled),
  setFullScreen: (enabled: boolean) => ipcRenderer.send('window-control:full-screen', enabled),
  // The page's own zoom (double size mode sets it from the main process via
  // webContents.setZoomFactor). Read synchronously by the custom cursor,
  // which has to convert its stored pointer position when the zoom changes.
  getPageZoomFactor: () => webFrame.getZoomFactor(),
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
  onFullScreenStateChange: (callback: (isFullScreen: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: boolean) => {
      callback(value)
    }
    ipcRenderer.on('window-fullscreen-state', listener)
    return () => {
      ipcRenderer.off('window-fullscreen-state', listener)
    }
  },
}

const exportApi: ExportApi = invokeBridge<ExportApi>(EXPORT_CHANNELS, invoke)

contextBridge.exposeInMainWorld('windowControls', windowControls)
contextBridge.exposeInMainWorld('thockdownExport', exportApi)

const externalFilesApi: ExternalFilesApi = {
  ...invokeBridge<ExternalFilesApi>(EXTERNAL_FILE_CHANNELS, invoke),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  onOpenFile: (callback: (filePath: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, filePath: string) => {
      callback(filePath)
    }
    ipcRenderer.on(EXTERNAL_FILE_EVENTS.opened, listener)
    return () => {
      ipcRenderer.off(EXTERNAL_FILE_EVENTS.opened, listener)
    }
  },
}

contextBridge.exposeInMainWorld('thockdownExternalFiles', externalFilesApi)


const textureCacheApi: TextureCacheApi = invokeBridge<TextureCacheApi>(TEXTURE_CHANNELS, invoke)

contextBridge.exposeInMainWorld('thockdownTextures', textureCacheApi)

const audioBounceCacheApi: AudioBounceCacheApi = invokeBridge<AudioBounceCacheApi>(AUDIO_BOUNCE_CHANNELS, invoke)

contextBridge.exposeInMainWorld('thockdownAudioBounces', audioBounceCacheApi)

const uiLoadoutApi: UiLoadoutApi = invokeBridge<UiLoadoutApi>(LOADOUT_CHANNELS, invoke)

contextBridge.exposeInMainWorld('thockdownLoadouts', uiLoadoutApi)

const soundscapeFileApi: SoundscapeFileApi = invokeBridge<SoundscapeFileApi>(SOUNDSCAPE_FILE_CHANNELS, invoke)

contextBridge.exposeInMainWorld('thockdownSoundscapeFiles', soundscapeFileApi)

const fileSyncApi: FileSyncApi = invokeBridge<FileSyncApi>(FILE_SYNC_CHANNELS, invoke)

contextBridge.exposeInMainWorld('thockdownFileSync', fileSyncApi)

const audioPlayerApi: AudioPlayerApi = invokeBridge<AudioPlayerApi>(AUDIO_PLAYER_CHANNELS, invoke)

contextBridge.exposeInMainWorld('thockdownAudioPlayer', audioPlayerApi)

const noteTabsApi: NoteTabsApi = invokeBridge<NoteTabsApi>(NOTE_TABS_CHANNELS, invoke)

contextBridge.exposeInMainWorld('thockdownTabs', noteTabsApi)

const editorSectionsApi: EditorSectionsApi = invokeBridge<EditorSectionsApi>(EDITOR_SECTIONS_CHANNELS, invoke)

contextBridge.exposeInMainWorld('thockdownSections', editorSectionsApi)

const chaptersApi: ChaptersApi = invokeBridge<ChaptersApi>(CHAPTER_CHANNELS, invoke)

contextBridge.exposeInMainWorld('thockdownChapters', chaptersApi)

const reviewFlagsApi: ReviewFlagsApi = invokeBridge<ReviewFlagsApi>(REVIEW_FLAG_CHANNELS, invoke)

contextBridge.exposeInMainWorld('thockdownReviewFlags', reviewFlagsApi)
