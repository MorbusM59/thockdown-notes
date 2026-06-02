/// <reference types="vite/client" />

interface Window {
	measlyNotes?: import('./shared/noteLifecycle').NoteLifecycleApi;
	measlyState?: import('./shared/appState').AppStateApi;
	measlyExternalFiles?: import('./shared/externalFiles').ExternalFilesApi;
	measlyLegacyDb?: import('./shared/legacyDbFeatures').LegacyDbApi;
	measlyTextures?: import('./shared/textures').TextureCacheApi;
}
