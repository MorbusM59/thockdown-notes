/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  ipcRenderer?: import('electron').IpcRenderer
  thockdownNotes?: import('../src/shared/noteLifecycle').NoteLifecycleApi
  thockdownState?: import('../src/shared/appState').AppStateApi
  thockdownExternalFiles?: import('../src/shared/externalFiles').ExternalFilesApi
  thockdownTextures?: import('../src/shared/textures').TextureCacheApi
  thockdownLoadouts?: import('../src/shared/loadouts').UiLoadoutApi
  thockdownAudioPlayer?: import('../src/shared/audioPlayer').AudioPlayerApi
  thockdownTabs?: import('../src/shared/tabs').NoteTabsApi
  thockdownSections?: import('../src/shared/sections').EditorSectionsApi
}
