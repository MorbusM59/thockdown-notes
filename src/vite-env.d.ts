/// <reference types="vite/client" />

interface Window {
	measlyNotes?: import('./shared/noteLifecycle').NoteLifecycleApi;
	measlyState?: import('./shared/appState').AppStateApi;
}
