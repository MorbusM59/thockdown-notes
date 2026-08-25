import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AppState,
  PersistedMenuState,
  PersistedSidebarViewState,
  PersistedViewportState,
  SidebarMode,
  WindowState,
} from '../src/shared/appState';
import { DEFAULT_GLAZE_SETTINGS, sanitizeGlazeSettings } from '../src/shared/glaze';
import { DEFAULT_TEXTURE_MATERIALS, TEXTURE_SURFACES, type TextureColorHsva, type TextureMaterialSettings, type TextureMaterialsBySurface, type TextureSurfaceKey } from '../src/textures/types';
import { DEFAULT_UI_FONT_KEY, DEFAULT_UI_FONT_SCALE, UI_FONT_OPTIONS, UI_FONT_SCALE_MIN, UI_FONT_SCALE_MAX, roundUiFontScale, type UiFontKey } from '../src/shared/UiTypography';

const APP_STATE_FILE = 'app-state.json';
const WINDOW_STATE_FILE = 'window-state.json';

const DEFAULT_APP_STATE: AppState = {
  selectedNoteId: null,
  viewport: undefined,
  menu: {
    sidebarMode: 'date',
    selectedMonths: [],
    selectedYears: [],
    searchQuery: '',
    searchQueryCaseSensitive: false,
    isPreviewMode: false,
    viewStyle: 'modern',
    viewFontSize: 16,
    viewSpacing: 1.6,
    viewLetterSpacingEm: 0,
    editorStyle: 'syne',
    editorFontSize: 16,
    editorSpacing: 1.6,
    editorGlyphPaddingPx: 1,
    uiFontStyle: DEFAULT_UI_FONT_KEY,
    uiFontScale: DEFAULT_UI_FONT_SCALE,
    borderRadiusRegularPx: 6,
    highlightGridOutlineColor: '#00000022',
    textureEnabled: false,
    glaze: DEFAULT_GLAZE_SETTINGS,
    uiMode: 'light',
    textureActiveSurface: 'appGrid',
    textureMaterials: DEFAULT_TEXTURE_MATERIALS,
    scrollEaseMultiplier: 1.5,
    scrollDistanceTimeInfluence: 0.1,
    scrollBaseDistanceRows: 20,
    scrollMaxDurationMultiplier: 4,
    sidebarViewState: {
      date: { page: 1, scrollTop: 0 },
      category: { scrollTop: 0, collapsedPrimary: [], collapsedSecondary: [] },
      archive: { scrollTop: 0, collapsedPrimary: [], collapsedSecondary: [] },
      trash: { page: 1, scrollTop: 0 },
      find: { scrollTop: 0 },
    },
    spellCheckEnabled: false,
  },
};

const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1200,
  height: 900,
  isMaximized: false,
};

function sanitizeViewport(input: Partial<PersistedViewportState> | undefined): PersistedViewportState | undefined {
  if (!input) return undefined;

  // Older saved states used a pixel-based shape (topBoundaryPx/
  // bottomBoundaryPx/scrollTopPx). That shape is intentionally not migrated
  // — treat it as absent so callers fall back to the 0/0/0 default, same as
  // a fresh install. Only persist/restore the new line-count shape.
  const { topBoundaryLines, bottomBoundaryLines, scrollTopLines } = input as Partial<PersistedViewportState>;
  if (
    typeof topBoundaryLines !== 'number'
    && typeof bottomBoundaryLines !== 'number'
    && typeof scrollTopLines !== 'number'
  ) {
    return undefined;
  }

  return {
    topBoundaryLines: typeof topBoundaryLines === 'number' ? Math.max(0, Math.round(topBoundaryLines)) : 0,
    bottomBoundaryLines: typeof bottomBoundaryLines === 'number' ? Math.max(0, Math.round(bottomBoundaryLines)) : 0,
    scrollTopLines: typeof scrollTopLines === 'number' ? Math.max(0, Math.round(scrollTopLines)) : 0,
  };
}

function sanitizeSidebarMode(input: unknown): SidebarMode {
  if (input === 'date' || input === 'category' || input === 'archive' || input === 'trash' || input === 'find') {
    return input;
  }
  return 'date';
}

const VALID_EDITOR_STYLES = [
  'syne',
  'redhat',
  'vt323',
  'victormono',
  'bytesized',
  'iosevkacharon',
  'kodemono',
  'xanhmono',
  'lekton',
  'novamono',
  'sharetech',
  'courierprime',
] as const;

function sanitizeEditorStyle(input: unknown): (typeof VALID_EDITOR_STYLES)[number] {
  if ((VALID_EDITOR_STYLES as readonly unknown[]).includes(input)) {
    return input as (typeof VALID_EDITOR_STYLES)[number];
  }
  return DEFAULT_APP_STATE.menu!.editorStyle ?? 'syne';
}

const VALID_UI_FONT_KEYS = [DEFAULT_UI_FONT_KEY, ...UI_FONT_OPTIONS.map((option) => option.key)] as const;

function sanitizeUiFontStyle(input: unknown): UiFontKey {
  if ((VALID_UI_FONT_KEYS as readonly unknown[]).includes(input)) {
    return input as UiFontKey;
  }
  return DEFAULT_APP_STATE.menu!.uiFontStyle ?? DEFAULT_UI_FONT_KEY;
}

function sanitizeUiFontScale(input: unknown): number {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return Math.max(UI_FONT_SCALE_MIN, Math.min(UI_FONT_SCALE_MAX, roundUiFontScale(input)));
  }
  return DEFAULT_APP_STATE.menu!.uiFontScale ?? DEFAULT_UI_FONT_SCALE;
}

function sanitizeUiMode(input: unknown): 'light' | 'dark' {
  if (input === 'light' || input === 'dark') {
    return input;
  }
  return DEFAULT_APP_STATE.menu!.uiMode ?? 'light';
}

const VALID_VIEW_STYLES = [
  'modern',
  'narrow',
  'cute',
  'xkcd',
  'print',
  'calibrilight',
  'opensans',
  'notoserif',
  'neuton',
  'faunaone',
  'fredericka',
  'bubblerone',
] as const;

function sanitizeViewStyle(input: unknown): (typeof VALID_VIEW_STYLES)[number] {
  if ((VALID_VIEW_STYLES as readonly unknown[]).includes(input)) {
    return input as (typeof VALID_VIEW_STYLES)[number];
  }
  return DEFAULT_APP_STATE.menu!.viewStyle ?? 'modern';
}

// Font size / line-height used to be discrete keys ('xs'..'xl',
// 'tight'..'wide'); app-state files saved before the continuous sliders may
// still have those strings, so a legacy key still resolves to its old
// numeric equivalent instead of silently falling back to the default.
const LEGACY_FONT_SIZE_PX_BY_KEY: Record<string, number> = { xs: 12, s: 14, m: 16, l: 18, xl: 20 };
const LEGACY_LINE_HEIGHT_MULTIPLIER_BY_KEY: Record<string, number> = { tight: 1.2, compact: 1.4, cozy: 1.6, wide: 1.8 };

const EDITOR_FONT_SIZE_MIN_PX = 6;
const EDITOR_FONT_SIZE_MAX_PX = 24;
const EDITOR_LINE_HEIGHT_MULTIPLIER_MIN = 0.8;
const EDITOR_LINE_HEIGHT_MULTIPLIER_MAX = 3;

function sanitizeFontSizePx(input: unknown): number {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return Math.max(EDITOR_FONT_SIZE_MIN_PX, Math.min(EDITOR_FONT_SIZE_MAX_PX, Math.round(input * 2) / 2));
  }
  if (typeof input === 'string' && input in LEGACY_FONT_SIZE_PX_BY_KEY) {
    return LEGACY_FONT_SIZE_PX_BY_KEY[input]!;
  }
  return DEFAULT_APP_STATE.menu!.editorFontSize ?? 16;
}

function sanitizeLineHeightMultiplier(input: unknown): number {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return Math.max(EDITOR_LINE_HEIGHT_MULTIPLIER_MIN, Math.min(EDITOR_LINE_HEIGHT_MULTIPLIER_MAX, Math.round(input * 20) / 20));
  }
  if (typeof input === 'string' && input in LEGACY_LINE_HEIGHT_MULTIPLIER_BY_KEY) {
    return LEGACY_LINE_HEIGHT_MULTIPLIER_BY_KEY[input]!;
  }
  return DEFAULT_APP_STATE.menu!.editorSpacing ?? 1.6;
}

const VIEW_LETTER_SPACING_MIN_EM = 0;
const VIEW_LETTER_SPACING_MAX_EM = 0.5;

function sanitizeViewLetterSpacingEm(input: unknown): number {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return Math.max(VIEW_LETTER_SPACING_MIN_EM, Math.min(VIEW_LETTER_SPACING_MAX_EM, Math.round(input * 100) / 100));
  }
  return DEFAULT_APP_STATE.menu!.viewLetterSpacingEm ?? 0;
}

function sanitizeRatio(input: unknown, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, input));
}

function sanitizePositive(input: unknown, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return fallback;
  }
  return input;
}

function sanitizeIntegerInRange(input: unknown, min: number, max: number, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return fallback;
  }

  const rounded = Math.round(input);
  return Math.max(min, Math.min(max, rounded));
}

// Editor glyph padding steps in 0.5px increments (0.5 widens the box by 1px
// total -- 0.5px added to each side of the glyph).
function sanitizeHalfStepInRange(input: unknown, min: number, max: number, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return fallback;
  }

  const clamped = Math.max(min, Math.min(max, input));
  return Math.round(clamped * 2) / 2;
}

function sanitizeTextureSurface(input: unknown): TextureSurfaceKey {
  if (input === 'appGrid' || input === 'sidebarContent' || input === 'editorEditText' || input === 'editorRenderText') {
    return input;
  }
  if (input === 'editorStage') {
    return 'editorEditText';
  }
  return DEFAULT_APP_STATE.menu!.textureActiveSurface ?? 'appGrid';
}

function sanitizeTextureColor(input: unknown, fallback: TextureColorHsva): TextureColorHsva {
  const source = (input && typeof input === 'object') ? input as Partial<TextureColorHsva> : {};
  return {
    h: sanitizeIntegerInRange(source.h, 0, 360, fallback.h),
    s: sanitizeRatio(source.s, fallback.s),
    v: sanitizeRatio(source.v, fallback.v),
    a: sanitizeRatio(source.a, fallback.a),
  };
}

function sanitizeTextureMaterial(input: unknown, fallback: TextureMaterialSettings): TextureMaterialSettings {
  const source = (input && typeof input === 'object') ? input as Partial<TextureMaterialSettings> : {};
  return {
    enabled: source.enabled !== false,
    seed: sanitizeIntegerInRange(source.seed, 0, 0x7fffffff, fallback.seed),
    granularity: sanitizeIntegerInRange(source.granularity, 1, 20, fallback.granularity),
    vSteps: sanitizeIntegerInRange(source.vSteps, 1, 20, fallback.vSteps),
    color: sanitizeTextureColor(source.color, fallback.color),
  };
}

function sanitizeTextureMaterials(input: unknown): TextureMaterialsBySurface {
  const source = (input && typeof input === 'object') ? input as Partial<TextureMaterialsBySurface> : {};
  const legacySource = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  const legacyEditorStage = legacySource.editorStage;
  const next = { ...DEFAULT_TEXTURE_MATERIALS } as TextureMaterialsBySurface;
  for (const surface of TEXTURE_SURFACES) {
    if ((surface === 'editorEditText' || surface === 'editorRenderText') && source[surface] === undefined && legacyEditorStage !== undefined) {
      next[surface] = sanitizeTextureMaterial(legacyEditorStage, DEFAULT_TEXTURE_MATERIALS[surface]);
      continue;
    }

    next[surface] = sanitizeTextureMaterial(source[surface], DEFAULT_TEXTURE_MATERIALS[surface]);
  }
  return next;
}

function sanitizeCollapsedList(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return Array.from(
    new Set(input.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)),
  );
}

function sanitizeSidebarViewStateEntry(input: PersistedSidebarViewState | undefined): PersistedSidebarViewState {
  return {
    scrollTop: typeof input?.scrollTop === 'number' && Number.isFinite(input.scrollTop)
      ? Math.max(0, Math.round(input.scrollTop))
      : 0,
    page: typeof input?.page === 'number' && Number.isFinite(input.page)
      ? Math.max(1, Math.round(input.page))
      : 1,
    collapsedPrimary: sanitizeCollapsedList(input?.collapsedPrimary),
    collapsedSecondary: sanitizeCollapsedList(input?.collapsedSecondary),
  };
}

function sanitizeSidebarViewState(
  input: Partial<Record<SidebarMode, PersistedSidebarViewState>> | undefined,
): Partial<Record<SidebarMode, PersistedSidebarViewState>> {
  return {
    date: sanitizeSidebarViewStateEntry(input?.date),
    category: sanitizeSidebarViewStateEntry(input?.category),
    archive: sanitizeSidebarViewStateEntry(input?.archive),
    trash: sanitizeSidebarViewStateEntry(input?.trash),
    find: sanitizeSidebarViewStateEntry(input?.find),
  };
}

// Type-preserving passthrough for optional numeric/string fields whose
// range clamping already happens where they're consumed in the renderer
// (see the `?? default` / clamp() calls around each appState.menu.* read in
// App.tsx) -- sanitizeMenu's job here is just making sure corrupt/foreign
// data in the JSON file can't leak through as the wrong type, not
// re-deriving each field's valid range.
function sanitizeOptionalNumber(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) ? input : undefined;
}

function sanitizeOptionalString(input: unknown): string | undefined {
  return typeof input === 'string' ? input : undefined;
}

function sanitizeOptionalBoolean(input: unknown): boolean | undefined {
  return typeof input === 'boolean' ? input : undefined;
}

const VALID_DARK_MODE_KEYS = ['none', 'mono', 'red', 'dusk', 'neon', 'matrix'] as const;

function sanitizeDarkMode(input: unknown): (typeof VALID_DARK_MODE_KEYS)[number] | undefined {
  return (VALID_DARK_MODE_KEYS as readonly unknown[]).includes(input) ? input as (typeof VALID_DARK_MODE_KEYS)[number] : undefined;
}

const VALID_TYPING_SOUND_SETS = ['A', 'B', 'C', 'D'] as const;

function sanitizeTypingSoundSet(input: unknown): (typeof VALID_TYPING_SOUND_SETS)[number] | undefined {
  return (VALID_TYPING_SOUND_SETS as readonly unknown[]).includes(input) ? input as (typeof VALID_TYPING_SOUND_SETS)[number] : undefined;
}

function sanitizeChapterBarMode(input: unknown): 'tags' | 'tabs' | undefined {
  return input === 'tags' || input === 'tabs' ? input : undefined;
}

function sanitizeMusicActiveSlots(input: unknown): number[] | undefined {
  return Array.isArray(input)
    ? input.filter((value): value is number => Number.isInteger(value) && value >= 1 && value <= 5)
    : undefined;
}

function sanitizeReviewGutterVisibleBySection(input: unknown): Record<string, boolean> {
  if (!input || typeof input !== 'object') return {};
  const result: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (key.length > 0) result[key] = Boolean(value);
  }
  return result;
}

function sanitizeMenu(input: Partial<PersistedMenuState> | undefined): PersistedMenuState {
  const selectedMonths = Array.isArray(input?.selectedMonths)
    ? input.selectedMonths.filter((value): value is number => Number.isInteger(value) && value >= 1 && value <= 12)
    : [];

  const selectedYears = Array.isArray(input?.selectedYears)
    ? input.selectedYears.filter((value): value is number | 'older' => value === 'older' || Number.isInteger(value))
    : [];

  return {
    sidebarMode: sanitizeSidebarMode(input?.sidebarMode),
    selectedMonths,
    selectedYears,
    searchQuery: typeof input?.searchQuery === 'string' ? input.searchQuery : '',
    searchQueryCaseSensitive: Boolean(input?.searchQueryCaseSensitive),
    documentFindCaseSensitive: Boolean(input?.documentFindCaseSensitive),
    isPreviewMode: Boolean(input?.isPreviewMode),
    viewStyle: sanitizeViewStyle(input?.viewStyle),
    viewFontSize: sanitizeFontSizePx(input?.viewFontSize),
    viewSpacing: sanitizeLineHeightMultiplier(input?.viewSpacing),
    viewLetterSpacingEm: sanitizeViewLetterSpacingEm(input?.viewLetterSpacingEm),
    editorStyle: sanitizeEditorStyle(input?.editorStyle),
    editorFontSize: sanitizeFontSizePx(input?.editorFontSize),
    editorSpacing: sanitizeLineHeightMultiplier(input?.editorSpacing),
    editorGlyphPaddingPx: sanitizeHalfStepInRange(
      input?.editorGlyphPaddingPx,
      0,
      4,
      DEFAULT_APP_STATE.menu!.editorGlyphPaddingPx ?? 1,
    ),
    uiFontStyle: sanitizeUiFontStyle(input?.uiFontStyle),
    uiFontScale: sanitizeUiFontScale(input?.uiFontScale),
    borderRadiusRegularPx: sanitizeIntegerInRange(
      input?.borderRadiusRegularPx,
      0,
      20,
      DEFAULT_APP_STATE.menu!.borderRadiusRegularPx ?? 6,
    ),
    spacingRegularPx: sanitizeOptionalNumber(input?.spacingRegularPx),
    borderAlphaPercent: sanitizeOptionalNumber(input?.borderAlphaPercent),
    boxShadowAlphaPercent: sanitizeOptionalNumber(input?.boxShadowAlphaPercent),
    darkMode: sanitizeDarkMode(input?.darkMode),
    filterInvert: sanitizeOptionalNumber(input?.filterInvert),
    filterSepia: sanitizeOptionalNumber(input?.filterSepia),
    filterHueRotate: sanitizeOptionalNumber(input?.filterHueRotate),
    filterBrightness: sanitizeOptionalNumber(input?.filterBrightness),
    filterContrast: sanitizeOptionalNumber(input?.filterContrast),
    filterSaturate: sanitizeOptionalNumber(input?.filterSaturate),
    filterColorize: sanitizeOptionalNumber(input?.filterColorize),
    renderScrollDynamic: sanitizeOptionalNumber(input?.renderScrollDynamic),
    renderScrollResponsiveness: sanitizeOptionalNumber(input?.renderScrollResponsiveness),
    renderScrollTotalTimeSec: sanitizeOptionalNumber(input?.renderScrollTotalTimeSec),
    renderScrollMaxSpeedPxPerSec: sanitizeOptionalNumber(input?.renderScrollMaxSpeedPxPerSec),
    renderScrollSkew: sanitizeOptionalNumber(input?.renderScrollSkew),
    // Legacy pre-curve-model keys -- kept as passthrough (not written by any
    // current save, but still read as a migration fallback for saves from
    // before renderScrollDynamic/Responsiveness existed; see App.tsx).
    renderScrollEaseMultiplier: sanitizeOptionalNumber(input?.renderScrollEaseMultiplier),
    renderScrollDistanceTimeInfluence: sanitizeOptionalNumber(input?.renderScrollDistanceTimeInfluence),
    highlightCaretColor: sanitizeOptionalString(input?.highlightCaretColor),
    highlightSearchColor: sanitizeOptionalString(input?.highlightSearchColor),
    highlightSelectionColor: sanitizeOptionalString(input?.highlightSelectionColor),
    highlightSelectionEditColor: sanitizeOptionalString(input?.highlightSelectionEditColor),
    highlightSelectionRenderColor: sanitizeOptionalString(input?.highlightSelectionRenderColor),
    highlightTextBaseColor: sanitizeOptionalString(input?.highlightTextBaseColor),
    highlightTextEmbossColor: sanitizeOptionalString(input?.highlightTextEmbossColor),
    highlightTextEmbossEditColor: sanitizeOptionalString(input?.highlightTextEmbossEditColor),
    highlightTextEmbossRenderColor: sanitizeOptionalString(input?.highlightTextEmbossRenderColor),
    highlightTextEmbossUiColor: sanitizeOptionalString(input?.highlightTextEmbossUiColor),
    highlightBackgroundColor: sanitizeOptionalString(input?.highlightBackgroundColor),
    editorEditTextColor: sanitizeOptionalString(input?.editorEditTextColor),
    editorRenderTextColor: sanitizeOptionalString(input?.editorRenderTextColor),
    exportFolder: sanitizeOptionalString(input?.exportFolder),
    highlightTopBackgroundColor: sanitizeOptionalString(input?.highlightTopBackgroundColor),
    highlightBottomBackgroundColor: sanitizeOptionalString(input?.highlightBottomBackgroundColor),
    highlightGridOutlineColor:
      typeof input?.highlightGridOutlineColor === 'string'
        ? input.highlightGridOutlineColor
        : (DEFAULT_APP_STATE.menu!.highlightGridOutlineColor ?? '#00000022'),
    highlightGridColor: sanitizeOptionalString(input?.highlightGridColor),
    highlightGutterBackgroundColor: sanitizeOptionalString(input?.highlightGutterBackgroundColor),
    highlightReviewColor: sanitizeOptionalString(input?.highlightReviewColor),
    highlightWarningColor: sanitizeOptionalString(input?.highlightWarningColor),
    highlightLineNumberColor: sanitizeOptionalString(input?.highlightLineNumberColor),
    highlightBaseColor: sanitizeOptionalString(input?.highlightBaseColor),
    highlightInputFieldsColor: sanitizeOptionalString(input?.highlightInputFieldsColor),
    highlightAppButtonsColor: sanitizeOptionalString(input?.highlightAppButtonsColor),
    highlightMarkdownHeadlineColor: typeof input?.highlightMarkdownHeadlineColor === 'string'
      ? input.highlightMarkdownHeadlineColor
      : undefined,
    highlightMarkdownListColor: typeof input?.highlightMarkdownListColor === 'string'
      ? input.highlightMarkdownListColor
      : undefined,
    highlightMarkdownBlockquoteColor: typeof input?.highlightMarkdownBlockquoteColor === 'string'
      ? input.highlightMarkdownBlockquoteColor
      : undefined,
    highlightMarkdownCodeColor: typeof input?.highlightMarkdownCodeColor === 'string'
      ? input.highlightMarkdownCodeColor
      : undefined,
    highlightMarkdownCheckedColor: typeof input?.highlightMarkdownCheckedColor === 'string'
      ? input.highlightMarkdownCheckedColor
      : undefined,
    highlightMarkdownUncheckedColor: typeof input?.highlightMarkdownUncheckedColor === 'string'
      ? input.highlightMarkdownUncheckedColor
      : undefined,
    textureEnabled: Boolean(input?.textureEnabled),
    glaze: sanitizeGlazeSettings(input?.glaze, DEFAULT_APP_STATE.menu!.glaze ?? DEFAULT_GLAZE_SETTINGS),
    uiMode: sanitizeUiMode(input?.uiMode),
    textureActiveSurface: sanitizeTextureSurface(input?.textureActiveSurface),
    textureMaterials: sanitizeTextureMaterials(input?.textureMaterials),
    audioKeyVolume: sanitizeOptionalNumber(input?.audioKeyVolume),
    audioBassVolume: sanitizeOptionalNumber(input?.audioBassVolume),
    audioTrebleVolume: sanitizeOptionalNumber(input?.audioTrebleVolume),
    audioKeyVariance: sanitizeOptionalNumber(input?.audioKeyVariance),
    audioPitch: sanitizeOptionalNumber(input?.audioPitch),
    audioReverbStrength: sanitizeOptionalNumber(input?.audioReverbStrength),
    audioReverbSpace: sanitizeOptionalNumber(input?.audioReverbSpace),
    audioReverbAmount: sanitizeOptionalNumber(input?.audioReverbAmount),
    pitchJitterAmount: sanitizeOptionalNumber(input?.pitchJitterAmount),
    audioSpatial: sanitizeOptionalNumber(input?.audioSpatial),
    reduceVisualEffects: Boolean(input?.reduceVisualEffects),
    reducedCaretAnimation: Boolean(input?.reducedCaretAnimation),
    deferPreviewOnRapidInput: Boolean(input?.deferPreviewOnRapidInput),
    typingSoundEnabled: Boolean(input?.typingSoundEnabled),
    typingSoundSet: sanitizeTypingSoundSet(input?.typingSoundSet),
    musicVolume: sanitizeOptionalNumber(input?.musicVolume),
    musicReverbAmount: sanitizeOptionalNumber(input?.musicReverbAmount),
    musicReverbRoom: sanitizeOptionalNumber(input?.musicReverbRoom),
    musicActiveSlots: sanitizeMusicActiveSlots(input?.musicActiveSlots),
    musicLastSongId: sanitizeOptionalNumber(input?.musicLastSongId),
    musicLastPositionSec: sanitizeOptionalNumber(input?.musicLastPositionSec),
    musicWasPlaying: sanitizeOptionalBoolean(input?.musicWasPlaying),
    scrollEaseMultiplier: sanitizePositive(input?.scrollEaseMultiplier, DEFAULT_APP_STATE.menu!.scrollEaseMultiplier ?? 1),
    scrollDistanceTimeInfluence: sanitizeRatio(input?.scrollDistanceTimeInfluence, DEFAULT_APP_STATE.menu!.scrollDistanceTimeInfluence ?? 0),
    scrollBaseDistanceRows: sanitizePositive(input?.scrollBaseDistanceRows, DEFAULT_APP_STATE.menu!.scrollBaseDistanceRows ?? 1),
    scrollMaxDurationMultiplier: sanitizePositive(input?.scrollMaxDurationMultiplier, DEFAULT_APP_STATE.menu!.scrollMaxDurationMultiplier ?? 1),
    sidebarViewState: sanitizeSidebarViewState(input?.sidebarViewState),
    debuggingEnabled: Boolean(input?.debuggingEnabled),
    spellCheckEnabled: Boolean(input?.spellCheckEnabled ?? false),
    chapterBarMode: sanitizeChapterBarMode(input?.chapterBarMode),
    isSidebarVisible: typeof input?.isSidebarVisible === 'boolean' ? input.isSidebarVisible : true,
    // Was missing entirely until this line -- sanitizeMenu (routed through
    // by both loadAppState and saveAppState) silently dropped this field on
    // every real read/write, so it could never actually round-trip no
    // matter how correctly the renderer sent it. This was the true root
    // cause of double-size mode not surviving a real app restart -- the
    // renderer-side persistedMenuStateRef fix (App.tsx) was real and
    // necessary but insufficient on its own, since it was verified only
    // against the browser-mode mock (installBrowserMockBridges.ts), which
    // clones state verbatim and never exercises sanitizeMenu at all. Any
    // future field added to PersistedMenuState (shared/appState.ts) needs a
    // matching line here, or it silently never persists in the real app
    // regardless of how correct the renderer-side code is.
    isDoubleSizeMode: Boolean(input?.isDoubleSizeMode),
    customCursorEnabled: Boolean(input?.customCursorEnabled),
    reviewGutterVisibleBySection: sanitizeReviewGutterVisibleBySection(input?.reviewGutterVisibleBySection),
    reviewFlagsVisibleBySection: sanitizeReviewGutterVisibleBySection(input?.reviewFlagsVisibleBySection),
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export class StateService {
  private readonly appStatePath: string;
  private readonly windowStatePath: string;
  private cachedAppState: AppState | null = null;

  constructor(dataRoot: string) {
    this.appStatePath = path.join(dataRoot, APP_STATE_FILE);
    this.windowStatePath = path.join(dataRoot, WINDOW_STATE_FILE);
  }

  private async ensureDataRoot(): Promise<void> {
    await fs.mkdir(path.dirname(this.appStatePath), { recursive: true });
  }

  async loadAppState(): Promise<AppState> {
    await this.ensureDataRoot();
    if (!(await fileExists(this.appStatePath))) {
      return DEFAULT_APP_STATE;
    }

    try {
      const raw = await fs.readFile(this.appStatePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AppState>;
      return {
        selectedNoteId: typeof parsed.selectedNoteId === 'string' ? parsed.selectedNoteId : null,
        viewport: sanitizeViewport(parsed.viewport),
        menu: sanitizeMenu(parsed.menu),
      };
    } catch {
      return DEFAULT_APP_STATE;
    }
  }

  async saveAppState(state: AppState): Promise<void> {
    await this.ensureDataRoot();
    const payload: AppState = {
      selectedNoteId: typeof state.selectedNoteId === 'string' ? state.selectedNoteId : null,
      viewport: sanitizeViewport(state.viewport),
      menu: sanitizeMenu(state.menu),
    };
    this.cachedAppState = payload;
    await fs.writeFile(this.appStatePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  // Called synchronously from the main process on app close, to guarantee
  // the last-known state is written even if the renderer's async IPC call
  // didn't complete before the window was destroyed.
  async flushAppStateOnClose(): Promise<void> {
    if (!this.cachedAppState) return;
    try {
      await fs.writeFile(
        this.appStatePath,
        JSON.stringify(this.cachedAppState, null, 2),
        'utf8',
      );
    } catch (error) {
      console.error('[stateService] flushAppStateOnClose failed:', error);
    }
  }

  async loadWindowState(): Promise<WindowState> {
    await this.ensureDataRoot();
    if (!(await fileExists(this.windowStatePath))) {
      return DEFAULT_WINDOW_STATE;
    }

    try {
      const raw = await fs.readFile(this.windowStatePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<WindowState>;
      return {
        x: typeof parsed.x === 'number' ? parsed.x : undefined,
        y: typeof parsed.y === 'number' ? parsed.y : undefined,
        width: typeof parsed.width === 'number' ? parsed.width : DEFAULT_WINDOW_STATE.width,
        height: typeof parsed.height === 'number' ? parsed.height : DEFAULT_WINDOW_STATE.height,
        isMaximized: Boolean(parsed.isMaximized),
      };
    } catch {
      return DEFAULT_WINDOW_STATE;
    }
  }

  async saveWindowState(state: WindowState): Promise<void> {
    await this.ensureDataRoot();
    const payload: WindowState = {
      x: typeof state.x === 'number' ? state.x : undefined,
      y: typeof state.y === 'number' ? state.y : undefined,
      width: Math.max(100, Math.round(state.width)),
      height: Math.max(100, Math.round(state.height)),
      isMaximized: Boolean(state.isMaximized),
    };
    await fs.writeFile(this.windowStatePath, JSON.stringify(payload, null, 2), 'utf8');
  }
}
