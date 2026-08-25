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
  searchQueryCaseSensitive?: boolean;
  documentFindCaseSensitive?: boolean;
  isPreviewMode?: boolean;
  viewStyle?:
    | 'modern'
    | 'narrow'
    | 'cute'
    | 'xkcd'
    | 'print'
    | 'calibrilight'
    | 'opensans'
    | 'notoserif'
    | 'neuton'
    | 'faunaone'
    | 'fredericka'
    | 'bubblerone';
  viewFontSize?: number;
  viewSpacing?: number;
  viewLetterSpacingEm?: number;
  editorStyle?:
    | 'syne'
    | 'redhat'
    | 'vt323'
    | 'victormono'
    | 'bytesized'
    | 'iosevkacharon'
    | 'kodemono'
    | 'xanhmono'
    | 'lekton'
    | 'novamono'
    | 'sharetech'
    | 'courierprime';
  editorFontSize?: number;
  editorSpacing?: number;
  editorGlyphPaddingPx?: number;
  uiFontStyle?:
    | 'system'
    | 'ibmplexsans'
    | 'alata'
    | 'geo'
    | 'carterone'
    | 'cevicheone'
    | 'unicaone'
    | 'sniglet'
    | 'kellyslab'
    | 'novamono'
    | 'vt323'
    | 'xkcd'
    | 'sourgummy';
  uiFontScale?: number;
  borderRadiusRegularPx?: number;
  spacingRegularPx?: number;
  borderAlphaPercent?: number;
  boxShadowAlphaPercent?: number;
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
  // Scroll curve tuning (Options > Scrolling Behavior). Deliberately NOT part
  // of UiLayoutLoadout -- it must persist across layout switches rather than
  // being reset to whatever layout last had stored. See loadouts.ts.
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
  highlightTextBaseColor?: string;
  highlightTextEmbossColor?: string;
  highlightTextEmbossEditColor?: string;
  highlightTextEmbossRenderColor?: string;
  highlightTextEmbossUiColor?: string;
  highlightBackgroundColor?: string;
  editorEditTextColor?: string;
  editorRenderTextColor?: string;
  exportFolder?: string;
  highlightTopBackgroundColor?: string;
  highlightBottomBackgroundColor?: string;
  highlightGridOutlineColor?: string;
  highlightGridColor?: string;
  highlightGutterBackgroundColor?: string;
  highlightReviewColor?: string;
  highlightWarningColor?: string;
  highlightLineNumberColor?: string;
  highlightBaseColor?: string;
  highlightInputFieldsColor?: string;
  highlightAppButtonsColor?: string;
  highlightMarkdownHeadlineColor?: string;
  highlightMarkdownListColor?: string;
  highlightMarkdownBlockquoteColor?: string;
  highlightMarkdownCodeColor?: string;
  highlightMarkdownCheckedColor?: string;
  highlightMarkdownUncheckedColor?: string;
  textureEnabled?: boolean;
  textureActiveSurface?: TextureSurfaceKey;
  textureMaterials?: TextureMaterialsBySurface;
  audioKeyVolume?: number;
  audioBassVolume?: number;
  audioTrebleVolume?: number;
  audioKeyVariance?: number;
  audioPitch?: number;
  audioReverbStrength?: number;
  audioReverbSpace?: number;
  audioReverbAmount?: number;
  pitchJitterAmount?: number;
  audioSpatial?: number;
  reduceVisualEffects?: boolean;
  reducedCaretAnimation?: boolean;
  deferPreviewOnRapidInput?: boolean;
  typingSoundEnabled?: boolean;
  typingSoundSet?: 'A' | 'B' | 'C' | 'D';
  musicVolume?: number;
  musicReverbAmount?: number;
  musicReverbRoom?: number;
  musicActiveSlots?: number[];
  /** Last-played song's DB id, its playback position, and whether it was playing — restored on next launch. */
  musicLastSongId?: number;
  musicLastPositionSec?: number;
  musicWasPlaying?: boolean;
  // Legacy render smooth-scroll keys (pre curve-model / pre maxSpeed migration).
  renderScrollSmoothnessSec?: number;
  renderScrollEaseMultiplier?: number;
  renderScrollDistanceTimeInfluence?: number;
  renderScrollBaseDistanceRows?: number;
  renderScrollMaxDurationMultiplier?: number;
  sidebarViewState?: Partial<Record<SidebarMode, PersistedSidebarViewState>>;
  debuggingEnabled?: boolean;
  spellCheckEnabled?: boolean;
  /** Whether the tab bar shows tag management or pinned quick-access note tabs. */
  chapterBarMode?: 'tags' | 'tabs';
  /** Whether the sidebar is visible (not part of layout widths). */
  isSidebarVisible?: boolean;
  /** Whether "double size" mode (2x page zoom + doubled window minimum) is on. See App.tsx's isDoubleSizeMode. */
  isDoubleSizeMode?: boolean;
  /**
   * Whether the custom animated mouse cursor overlay is on (Options > Mouse
   * options). Deliberately kept out of UiLayoutLoadout and always defaults
   * to off -- it must persist across layout switches and app restarts
   * independent of whichever layout is active. Its appearance settings
   * (colors, size, speed, etc.) live in UiLayoutLoadout instead.
   */
  customCursorEnabled?: boolean;
  /** Line-number gutter visibility, keyed per editor slot (sectionId), not per note. See App.tsx's reviewGutterVisibleBySection. */
  reviewGutterVisibleBySection?: Record<string, boolean>;
  /**
   * Review-flag gutter column visibility, keyed per editor slot (sectionId),
   * independent of reviewGutterVisibleBySection's line-number column -- see
   * App.tsx's handleToggleReviewGutter (left click, both columns move
   * together based on the line-number state) vs handleToggleReviewFlags
   * (right click, this column alone). Older saved states predate the split
   * and won't have this field; App.tsx seeds it from
   * reviewGutterVisibleBySection on first load so upgrading preserves
   * whatever was visible before.
   */
  reviewFlagsVisibleBySection?: Record<string, boolean>;
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
