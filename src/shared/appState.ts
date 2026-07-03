import type { TextureMaterialsBySurface, TextureSurfaceKey } from '../textures/types';
import type { GlazeSettings } from './glaze';

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
  viewStyle?: 'modern' | 'narrow' | 'cute' | 'xkcd' | 'print';
  viewFontSize?: 'xs' | 's' | 'm' | 'l' | 'xl';
  viewSpacing?: 'tight' | 'compact' | 'cozy' | 'wide';
  editorStyle?: 'syne' | 'redhat';
  editorFontSize?: 'xs' | 's' | 'm' | 'l' | 'xl';
  editorSpacing?: 'tight' | 'compact' | 'cozy' | 'wide';
  editorGlyphPaddingPx?: number;
  sidebarWidthRatio: number;
  tagSplitRatio: number;
  glaze?: GlazeSettings;
  darkMode?: 'none' | 'mono' | 'red' | 'dusk' | 'neon' | 'matrix';
  uiMode?: 'light' | 'dark';
  filterInvert?: number;
  filterSepia?: number;
  filterHueRotate?: number;
  filterBrightness?: number;
  filterContrast?: number;
  filterSaturate?: number;
  filterColorize?: number;
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
  highlightSearchColor?: string;
  highlightSelectionColor?: string;
  highlightSelectionEditColor?: string;
  highlightSelectionRenderColor?: string;
  highlightTextEmbossColor?: string;
  highlightBackgroundColor?: string;
  editorEditTextColor?: string;
  editorRenderTextColor?: string;
  exportFolder?: string;
  highlightTopBackgroundColor?: string;
  highlightBottomBackgroundColor?: string;
  highlightGridOutlineColor?: string;
  highlightGridColor?: string;
  highlightBaseColor?: string;
  highlightInputFieldsColor?: string;
  highlightAppButtonsColor?: string;
  textureEnabled?: boolean;
  textureActiveSurface?: TextureSurfaceKey;
  textureMaterials?: TextureMaterialsBySurface;
  audioKeyVolume?: number;
  audioBassVolume?: number;
  audioTrebleVolume?: number;
  audioReverbStrength?: number;
  audioReverbSpace?: number;
  audioReverbAmount?: number;
  typingSoundEnabled?: boolean;
  typingSoundSet?: 'A' | 'B' | 'C';
  musicVolume?: number;
  musicReverbAmount?: number;
  musicReverbRoom?: number;
  musicActiveSlots?: number[];
  // Legacy render smooth-scroll keys (pre curve-model / pre maxSpeed migration).
  renderScrollSmoothnessSec?: number;
  renderScrollEaseMultiplier?: number;
  renderScrollDistanceTimeInfluence?: number;
  renderScrollBaseDistanceRows?: number;
  renderScrollMaxDurationMultiplier?: number;
  sidebarViewState?: Partial<Record<SidebarMode, PersistedSidebarViewState>>;
  debuggingEnabled?: boolean;
}

// Persisted boundary/scroll position as integer line counts. See
// EditorViewportLines in EditorContract.ts for the rationale: line counts
// are resolution-independent and never need validation against a live DOM
// measurement, eliminating the corrupt-restore class of bugs that pixel
// values were prone to.
//
// Older saved states may still contain the previous pixel-based shape
// (topBoundaryPx/bottomBoundaryPx/scrollTopPx). That shape is intentionally
// not migrated — if loadAppState() returns an object missing the line-based
// fields, callers should treat the viewport as absent and default to
// 0/0/0 (the same default used for a fresh install).
export interface PersistedViewportState {
  topBoundaryLines: number;
  bottomBoundaryLines: number;
  scrollTopLines: number;
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
