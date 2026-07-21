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
    viewFontSize: 'm',
    viewSpacing: 'cozy',
    editorStyle: 'syne',
    editorFontSize: 'm',
    editorSpacing: 'cozy',
    editorGlyphPaddingPx: 1,
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

function sanitizeEditorFontSize(input: unknown): 'xs' | 's' | 'm' | 'l' | 'xl' {
  if (input === 'xs' || input === 's' || input === 'm' || input === 'l' || input === 'xl') {
    return input;
  }
  return DEFAULT_APP_STATE.menu!.editorFontSize ?? 'm';
}

function sanitizeEditorSpacing(input: unknown): 'tight' | 'compact' | 'cozy' | 'wide' {
  if (input === 'tight' || input === 'compact' || input === 'cozy' || input === 'wide') {
    return input;
  }
  return DEFAULT_APP_STATE.menu!.editorSpacing ?? 'cozy';
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
    viewFontSize: sanitizeEditorFontSize(input?.viewFontSize),
    viewSpacing: sanitizeEditorSpacing(input?.viewSpacing),
    editorStyle: sanitizeEditorStyle(input?.editorStyle),
    editorFontSize: sanitizeEditorFontSize(input?.editorFontSize),
    editorSpacing: sanitizeEditorSpacing(input?.editorSpacing),
    editorGlyphPaddingPx: sanitizeIntegerInRange(
      input?.editorGlyphPaddingPx,
      0,
      1,
      DEFAULT_APP_STATE.menu!.editorGlyphPaddingPx ?? 1,
    ),
    borderRadiusRegularPx: sanitizeIntegerInRange(
      input?.borderRadiusRegularPx,
      0,
      20,
      DEFAULT_APP_STATE.menu!.borderRadiusRegularPx ?? 6,
    ),
    highlightGridOutlineColor:
      typeof input?.highlightGridOutlineColor === 'string'
        ? input.highlightGridOutlineColor
        : (DEFAULT_APP_STATE.menu!.highlightGridOutlineColor ?? '#00000022'),
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
    scrollEaseMultiplier: sanitizePositive(input?.scrollEaseMultiplier, DEFAULT_APP_STATE.menu!.scrollEaseMultiplier ?? 1),
    scrollDistanceTimeInfluence: sanitizeRatio(input?.scrollDistanceTimeInfluence, DEFAULT_APP_STATE.menu!.scrollDistanceTimeInfluence ?? 0),
    scrollBaseDistanceRows: sanitizePositive(input?.scrollBaseDistanceRows, DEFAULT_APP_STATE.menu!.scrollBaseDistanceRows ?? 1),
    scrollMaxDurationMultiplier: sanitizePositive(input?.scrollMaxDurationMultiplier, DEFAULT_APP_STATE.menu!.scrollMaxDurationMultiplier ?? 1),
    sidebarViewState: sanitizeSidebarViewState(input?.sidebarViewState),
    debuggingEnabled: Boolean(input?.debuggingEnabled),
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
