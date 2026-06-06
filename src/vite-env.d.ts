/// <reference types="vite/client" />

interface Window {
	measlyNotes?: import('./shared/noteLifecycle').NoteLifecycleApi;
	measlyState?: import('./shared/appState').AppStateApi;
	measlyExternalFiles?: import('./shared/externalFiles').ExternalFilesApi;
	measlyLegacyDb?: import('./shared/legacyDbFeatures').LegacyDbApi;
	measlyTextures?: import('./shared/textures').TextureCacheApi;
	measlyLoadouts?: import('./shared/loadouts').UiLoadoutApi;
	measlyFileSync?: import('./shared/fileSync').FileSyncApi;
	windowControls?: {
		minimize: () => void;
		toggleMaximize: () => void;
		close: () => void;
	};
}
