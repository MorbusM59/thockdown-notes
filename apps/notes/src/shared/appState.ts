import type { KeystrokeSoundPreferences, KeystrokeSoundSettings } from './keystrokeSounds';
import type { OptionsSectionId } from './optionsSections';
import type { EqPoint } from './musicEqCurve';
import type { SoundstagePreferences } from './soundstages';
import type { MusicPoolFilter } from './audioPlayer';
import type { FeatureToggles } from './features';
import type { TypingTrailSettings } from './typingTrailSettings';
import type { VisualizerFont } from './visualizerFont';
import type { VisualizerSettings } from '@thockdown/look/visualizer';
import type { SpeedReadingSettings } from '../speedReading/speedReadingSettings';
import type { BeatSettings } from './beatSettings';
import type { FlashingSettings, FlashShapePreferences } from './flashing';
import type { InvokeChannels } from './ipcContract';
import type { GameSave } from '../adventure/model/gameState';
import type { SlotOverlay } from './slotOverlay';
import type { TextureMaterialsBySurface, TextureSurfaceKey } from '@thockdown/look/textureTypes';
import type { GlazeSettings } from '@thockdown/look/glaze';
import type { BoxBevelSettings } from '@thockdown/look/boxBevel';
import type { SoundscapePreferences } from '@thockdown/soundscape/soundscape';

export const APP_STATE_CHANNELS = {
  loadAppState: 'state:app:load',
  saveAppState: 'state:app:save',
  clearAppState: 'state:app:clear',
  loadWindowState: 'state:window:load',
  saveWindowState: 'state:window:save',
} as const satisfies InvokeChannels<AppStateApi>;

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
  /** The options panel's search term, separate from the note search's. */
  optionsSearchQuery?: string;
  /** The options panel's selected section (shared/optionsSections.ts). */
  optionsSection?: OptionsSectionId;
  searchQueryCaseSensitive?: boolean;
  documentFindCaseSensitive?: boolean;
  isPreviewMode?: boolean;
  viewStyle?:
    | 'modern'
    | 'narrow'
    | 'cute'
    | 'boogaloo'
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
  /** Options > Visualizer (its font); absent in a save from before it existed, and then the defaults (shared/visualizerFont.ts). */
  visualizerFont?: VisualizerFont;
  /**
   * Options > Visualizer: how the visualizer follows the music, one setting
   * for every layout (its colours are each layout's). Absent in a save from
   * before it became global, until `electron/visualizerTuningMigration.ts`
   * writes the active layout's there; the renderer then takes the defaults.
   */
  visualizer?: VisualizerSettings;
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
    | 'boogaloo'
    | 'sourgummy';
  uiFontScale?: number;
  /** Double size mode's own font sizes (App.tsx fontSizesByMode). Absent in saves from before they existed, or when damaged: the app then seeds each from its regular counterpart above. */
  doubleSizeEditorFontSize?: number;
  /** Double size mode's visualizer font size; `visualizerFont.sizePx` is the regular mode's. */
  doubleSizeVisualizerFontSize?: number;
  doubleSizeViewFontSize?: number;
  doubleSizeUiFontScale?: number;
  borderRadiusRegularPx?: number;
  spacingRegularPx?: number;
  borderAlphaPercent?: number;
  boxShadowAlphaPercent?: number;
  glaze?: GlazeSettings;
  boxBevel?: BoxBevelSettings;
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
  // Spin-to-keep-scrolling (Options > Animations). Same reasoning as the
  // curve fields above: a scrolling habit, not a look, so it must not be
  // reset by a layout switch.
  wheelSpinThresholdMs?: number;
  wheelSpinDampenDivisor?: number;
  wheelSpinCutoffMs?: number;
  // What one wheel notch is worth, per pane (Options > Scrolling): whole
  // rows in the edit view, line heights in the render view. Same reasoning
  // again -- a scrolling habit, not a look.
  wheelStepRows?: number;
  wheelStepLines?: number;
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
  highlightImmersiveScrollThumbColor?: string;
  highlightFlowTrailColor?: string;
  highlightSpellCheckColor?: string;
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
  /** The sidebar's date/category/archive/trash views list stored images instead of notes (imageLibrary/). */
  sidebarShowsImages?: boolean;
  /** Remote (http/https) images in notes load. Off unless the reader held the toggle on; see src/shared/remoteImages.ts. */
  allowRemoteImages?: boolean;
  /** The live keystroke sound settings (shared/keystrokeSounds.ts). */
  keystrokeSound?: KeystrokeSoundSettings;
  /** Saved keystroke sound presets and the unsaved one. */
  keystrokeSoundPresets?: KeystrokeSoundPreferences;
  /**
   * Music LEVELS, always 0–1 and always the value the user set — never zeroed
   * to represent "off". Audibility is carried separately by the two flags
   * below, so muting and un-muting is a flag flip rather than a destructive
   * write plus a remembered copy, and a level adjusted while silenced is
   * already correct when sound comes back.
   */
  musicVolume?: number;
  musicReverbAmount?: number;
  musicReverbRoom?: number;
  /** The music room's FOLIAGE, 0-1 (@thockdown/audio/room.ts). */
  musicReverbFoliage?: number;
  /** The music's stereo width, STEREO_WIDTH_MIN-MAX with 1 neutral (@thockdown/audio/stereoWidth.ts). */
  musicStereoWidth?: number;
  /** Volume silenced; `musicVolume` keeps the level to come back to. */
  musicMuted?: boolean;
  /** Reverb bypassed; both the reverb and the room button reflect this one flag. */
  musicReverbBypassed?: boolean;
  /** Bottom row of the player showing sound options instead of the music sets. */
  musicSoundOptionsOpen?: boolean;
  musicActiveSlots?: number[];
  /** The pool's search (`audioPlayer.ts`'s `MusicPoolFilter`), set in the visualizer. */
  musicPoolFilter?: MusicPoolFilter;
  /** The music's soundstages (`shared/soundstages.ts`): the last factory stage, the custom stage, the saved ones. */
  musicSoundstages?: SoundstagePreferences;
  /** The music's EQ curve (`shared/musicEqCurve.ts`). */
  musicEqCurve?: EqPoint[];
  /** Last-played song's DB id, its playback position, and whether it was playing — restored on next launch. */
  musicLastSongId?: number;
  musicLastPositionSec?: number;
  musicWasPlaying?: boolean;
  /** Soundscape controls and custom presets; independent of layout loadouts. */
  soundscapes?: SoundscapePreferences;
  // Legacy render smooth-scroll keys (pre curve-model / pre maxSpeed migration).
  renderScrollSmoothnessSec?: number;
  renderScrollEaseMultiplier?: number;
  renderScrollDistanceTimeInfluence?: number;
  renderScrollBaseDistanceRows?: number;
  renderScrollMaxDurationMultiplier?: number;
  sidebarViewState?: Partial<Record<SidebarMode, PersistedSidebarViewState>>;
  /** Which features exist at all: the toggle bar at the top of Options. See shared/features.ts. */
  features?: FeatureToggles;
  /** The spell checker's active dictionaries by id (Options > Spell Checking; on/off is `features.spellCheck`); see shared/spellCheck.ts. Absent: `DEFAULT_SPELL_CHECK_DICTIONARIES`. */
  spellCheckDictionaries?: string[];
  /** The typing trail's tuning (Options > Typing Trail; on/off is `features.typingTrail`); see typingTrail/typingTrail.ts. Saved as `flow` before 0.7.4, read from there by `sanitizeMenu`. */
  typingTrail?: TypingTrailSettings;
  speedReading?: SpeedReadingSettings;
  /** The visualizer's per-device delay (Options > Visualizer; on/off is `features.visualizer`); see sound/musicBeat.ts. */
  beat?: BeatSettings;
  /** How flashing elements flash (Options > Advanced > Animations > Flashing): global, the caret's blink being the one reader today. */
  flashing?: FlashingSettings;
  /** The flashing shapes' presets (shared/flashing.ts). */
  flashingPresets?: FlashShapePreferences;
  /** Whether the tab bar shows tag management or pinned quick-access note tabs. */
  chapterBarMode?: 'tags' | 'tabs';
  /** Whether the sidebar is visible (not part of layout widths). */
  isSidebarVisible?: boolean;
  /**
   * The one record of a slot given over to something that is not one of the
   * reader's own notes -- the User Guide, the adventure, or an undocked
   * note. Three separate fields used to live here, one per kind; see
   * src/shared/slotOverlay.ts for why that shape produced orphaned toggles
   * and why this one cannot.
   *
   * It is RETURN MEMORY, not a claim about what is on screen. What a slot is
   * showing is derived from the slot itself on every read, so a record that
   * has gone stale across a restart is inert rather than wrong.
   */
  slotOverlay?: SlotOverlay | null;
  /** Whether "double size" mode (2x page zoom + doubled window minimum) is on. See App.tsx's isDoubleSizeMode. */
  isDoubleSizeMode?: boolean;
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
  /**
   * Which solid each slot's empty scene shows, keyed per editor slot
   * (sectionId): the step the reader clicked to (left click +1, right click
   * -1), mixed into the scene's seed (SectionEditorArea.tsx). Absent is 0.
   */
  emptySceneStepBySection?: Record<string, number>;
  /**
   * The saved adventure game (src/adventure), or null when there is none.
   * Structurally sanitized on both sides of the bridge -- sanitizeMenu in
   * electron/stateService.ts for the real app, and again in App.tsx's
   * restore, since the browser-mode mock never calls sanitizeMenu at all.
   */
  adventure?: GameSave | null;
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
  clearAppState(currentMenu: PersistedMenuState): Promise<void>;
  loadWindowState(): Promise<WindowState>;
  saveWindowState(state: WindowState): Promise<void>;
}
