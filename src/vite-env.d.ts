/// <reference types="vite/client" />

interface Window {
	measlyNotes?: import('./shared/noteLifecycle').NoteLifecycleApi;
	measlyState?: import('./shared/appState').AppStateApi;
	measlyExternalFiles?: import('./shared/externalFiles').ExternalFilesApi;
	measlyLegacyDb?: import('./shared/legacyDbFeatures').LegacyDbApi;
	measlyTextures?: import('./shared/textures').TextureCacheApi;
	measlyLoadouts?: import('./shared/loadouts').UiLoadoutApi;
	measlyFileSync?: import('./shared/fileSync').FileSyncApi;
	measlyExport?: {
		selectExportFolder: () => Promise<string | null>;
		exportPdf: (folderPath: string, fileName: string, htmlContent?: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
	};
	ipcRenderer?: {
		invoke: <T = any>(channel: string, ...args: unknown[]) => Promise<T>;
	};
	windowControls?: {
		minimize: () => void;
		toggleMaximize: () => void;
		close: () => void;
		onMaximizeStateChange: (callback: (isMaximized: boolean) => void) => () => void;
	};
}
