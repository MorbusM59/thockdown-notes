export const APP_STATE_CHANNELS = {
  loadAppState: 'state:app:load',
  saveAppState: 'state:app:save',
  loadWindowState: 'state:window:load',
  saveWindowState: 'state:window:save',
} as const;

export type SidebarMode = 'date' | 'category' | 'archive' | 'trash' | 'find';

export interface PersistedSidebarViewState {
  scrollTop?: number;
  page?: number;
  collapsedPrimary?: string[];
  collapsedSecondary?: string[];
}

export interface PersistedMenuState {
  sidebarMode: SidebarMode;
  selectedMonths: number[];
  selectedYears: Array<number | 'older'>;
  searchQuery: string;
  documentFindCaseSensitive?: boolean;
  isPreviewMode?: boolean;
  viewStyle?: 'modern' | 'narrow' | 'cute' | 'print';
  viewFontSize?: 'xs' | 's' | 'm' | 'l' | 'xl';
  viewSpacing?: 'tight' | 'compact' | 'cozy' | 'wide';
  editorStyle?: 'syne' | 'redhat';
  editorFontSize?: 'xs' | 's' | 'm' | 'l' | 'xl';
  editorSpacing?: 'tight' | 'compact' | 'cozy' | 'wide';
  sidebarWidthRatio: number;
  tagSplitRatio: number;
  scrollEaseMultiplier?: number;
  scrollDistanceTimeInfluence?: number;
  scrollBaseDistanceRows?: number;
  scrollMaxDurationMultiplier?: number;
  sidebarViewState?: Partial<Record<SidebarMode, PersistedSidebarViewState>>;
}

export interface PersistedViewportState {
  topBoundaryPx: number;
  bottomBoundaryPx: number;
  scrollTopPx: number;
}

export interface AppState {
  selectedNoteId: string | null;
  viewport?: PersistedViewportState;
  menu?: PersistedMenuState;
}

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

export interface AppStateApi {
  loadAppState(): Promise<AppState>;
  saveAppState(state: AppState): Promise<void>;
  loadWindowState(): Promise<WindowState>;
  saveWindowState(state: WindowState): Promise<void>;
}
