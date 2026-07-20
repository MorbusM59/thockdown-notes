/// <reference types="vite/client" />

interface Window {
	thockdownNotes?: import('./shared/noteLifecycle').NoteLifecycleApi;
	thockdownState?: import('./shared/appState').AppStateApi;
	thockdownExternalFiles?: import('./shared/externalFiles').ExternalFilesApi;
	thockdownTextures?: import('./shared/textures').TextureCacheApi;
	thockdownLoadouts?: import('./shared/loadouts').UiLoadoutApi;
	thockdownFileSync?: import('./shared/fileSync').FileSyncApi;
	thockdownSections?: import('./shared/sections').EditorSectionsApi;
	thockdownExport?: {
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
		toggleUtilityCollapse: (size: { width: number; height: number }) => Promise<boolean>;
		reportBackgroundColor: (hex: string) => void;
		setSidebarVisible: (visible: boolean) => void;
		setSectionCount: (count: number) => void;
		onMaximizeStateChange: (callback: (isMaximized: boolean) => void) => () => void;
		onCollapsedStateChange: (callback: (isCollapsed: boolean) => void) => () => void;
	};
}
