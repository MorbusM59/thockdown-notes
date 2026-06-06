import type { TextureMaterialsBySurface, TextureSurfaceKey } from '../textures/types';

export const APP_STATE_CHANNELS = {
  loadAppState: 'state:app:load',
  saveAppState: 'state:app:save',
  loadWindowState: 'state:window:load',
  saveWindowState: 'state:window:save',
} as const;

export type SidebarMode = 'date' | 'category' | 'archive' | 'trash' | 'find' | 'options';

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
  editorGlyphPaddingPx?: number;
  sidebarWidthRatio: number;
  tagSplitRatio: number;
  scrollEaseMultiplier?: number;
  scrollDistanceTimeInfluence?: number;
  scrollBaseDistanceRows?: number;
  scrollMaxDurationMultiplier?: number;
  renderScrollDynamic?: number;
  renderScrollResponsiveness?: number;
  renderScrollTotalTimeSec?: number;
  renderScrollMaxSpeedPxPerSec?: number;
  renderScrollSkew?: number;
  highlightCaretColor?: string;
  highlightSelectionColor?: string;
  highlightBackgroundColor?: string;
  highlightTopBackgroundColor?: string;
  highlightBottomBackgroundColor?: string;
  highlightGridOutlineColor?: string;
  textureEnabled?: boolean;
  textureActiveSurface?: TextureSurfaceKey;
  textureMaterials?: TextureMaterialsBySurface;
  // Legacy render smooth-scroll keys (pre curve-model / pre maxSpeed migration).
  renderScrollSmoothnessSec?: number;
  renderScrollEaseMultiplier?: number;
  renderScrollDistanceTimeInfluence?: number;
  renderScrollBaseDistanceRows?: number;
  renderScrollMaxDurationMultiplier?: number;
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
