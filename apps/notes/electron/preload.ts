import { ipcRenderer, contextBridge, webFrame, webUtils } from 'electron'
import type { NoteLifecycleApi } from '../src/shared/noteLifecycle'
import { NOTE_LIFECYCLE_CHANNELS } from '../src/shared/noteLifecycle'
import type { AppStateApi } from '../src/shared/appState'
import { APP_STATE_CHANNELS } from '../src/shared/appState'
import type { ExternalFileEvents, ExternalFilesApi } from '../src/shared/externalFiles'
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
import { eventSubscriber, invokeBridge, sendBridge } from '../src/shared/ipcContract'
import { WINDOW_CONTROL_INVOKE_CHANNELS, WINDOW_CONTROL_SEND_CHANNELS, WINDOW_EVENT_CHANNELS, type WindowControlsApi, type WindowEvents } from '../src/shared/windowControls'
import { EXPORT_CHANNELS, type ExportApi } from '../src/shared/exportApi'

// Every bridge below is built from its channel maps (see shared/ipcContract.ts).
const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
const send = (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args)
const on = ipcRenderer.on.bind(ipcRenderer)
const off = ipcRenderer.off.bind(ipcRenderer)

// --------- Expose some API to the Renderer process ---------
const noteLifecycleApi: NoteLifecycleApi = invokeBridge<NoteLifecycleApi>(NOTE_LIFECYCLE_CHANNELS, invoke)

contextBridge.exposeInMainWorld('thockdownNotes', noteLifecycleApi)

const appStateApi: AppStateApi = invokeBridge<AppStateApi>(APP_STATE_CHANNELS, invoke)

contextBridge.exposeInMainWorld('thockdownState', appStateApi)

const onWindowEvent = eventSubscriber<WindowEvents, Electron.IpcRendererEvent>(WINDOW_EVENT_CHANNELS, on, off)

const windowControls: WindowControlsApi = {
  ...sendBridge<WindowControlsApi>(WINDOW_CONTROL_SEND_CHANNELS, send),
  ...invokeBridge<WindowControlsApi>(WINDOW_CONTROL_INVOKE_CHANNELS, invoke),
  // The page's own zoom (double size mode sets it from the main process via
  // webContents.setZoomFactor). Read synchronously by the custom cursor,
  // which has to convert its stored pointer position when the zoom changes.
  getPageZoomFactor: () => webFrame.getZoomFactor(),
  onMaximizeStateChange: (callback) => onWindowEvent('maximizeState', callback),
  onCollapsedStateChange: (callback) => onWindowEvent('collapsedState', callback),
  onFullScreenStateChange: (callback) => onWindowEvent('fullScreenState', callback),
}

const exportApi: ExportApi = invokeBridge<ExportApi>(EXPORT_CHANNELS, invoke)

contextBridge.exposeInMainWorld('windowControls', windowControls)
contextBridge.exposeInMainWorld('thockdownExport', exportApi)

const externalFilesApi: ExternalFilesApi = {
  ...invokeBridge<ExternalFilesApi>(EXTERNAL_FILE_CHANNELS, invoke),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  onOpenFile: (callback) =>
    eventSubscriber<ExternalFileEvents, Electron.IpcRendererEvent>(EXTERNAL_FILE_EVENTS, on, off)('opened', callback),
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
