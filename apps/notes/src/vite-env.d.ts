/// <reference types="vite/client" />

interface Window {
	thockdownNotes?: import('./shared/noteLifecycle').NoteLifecycleApi;
	thockdownState?: import('./shared/appState').AppStateApi;
	thockdownExternalFiles?: import('./shared/externalFiles').ExternalFilesApi;
	thockdownTextures?: import('./shared/textures').TextureCacheApi;
	thockdownAudioBounces?: import('./shared/audioBounceCache').AudioBounceCacheApi;
	thockdownLoadouts?: import('@thockdown/look/loadouts').UiLoadoutApi;
	thockdownFileSync?: import('./shared/fileSync').FileSyncApi;
	thockdownSections?: import('./shared/sections').EditorSectionsApi;
	thockdownExport?: import('./shared/exportApi').ExportApi;
	windowControls?: import('./shared/windowControls').WindowControlsApi;
}
