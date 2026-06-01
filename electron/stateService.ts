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
    isPreviewMode: false,
    viewStyle: 'modern',
    viewFontSize: 'm',
    viewSpacing: 'cozy',
    editorStyle: 'syne',
    editorFontSize: 'm',
    editorSpacing: 'cozy',
    editorGlyphPaddingPx: 2,
    sidebarWidthRatio: 0.306,
    tagSplitRatio: 0.645,
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
  const topBoundaryPx = typeof input.topBoundaryPx === 'number' ? Math.max(0, Math.round(input.topBoundaryPx)) : 0;
  const bottomBoundaryPx = typeof input.bottomBoundaryPx === 'number' ? Math.max(0, Math.round(input.bottomBoundaryPx)) : 0;
  const scrollTopPx = typeof input.scrollTopPx === 'number' ? Math.max(0, Math.round(input.scrollTopPx)) : 0;

  return {
    topBoundaryPx,
    bottomBoundaryPx,
    scrollTopPx,
  };
}

function sanitizeSidebarMode(input: unknown): SidebarMode {
  if (input === 'date' || input === 'category' || input === 'archive' || input === 'trash' || input === 'find') {
    return input;
  }
  return 'date';
}

function sanitizeEditorStyle(input: unknown): 'syne' | 'redhat' {
  if (input === 'syne' || input === 'redhat') {
    return input;
  }
  return DEFAULT_APP_STATE.menu!.editorStyle ?? 'syne';
}

function sanitizeViewStyle(input: unknown): 'modern' | 'narrow' | 'cute' | 'print' {
  if (input === 'modern' || input === 'narrow' || input === 'cute' || input === 'print') {
    return input;
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
      5,
      DEFAULT_APP_STATE.menu!.editorGlyphPaddingPx ?? 2,
    ),
    sidebarWidthRatio: sanitizeRatio(input?.sidebarWidthRatio, DEFAULT_APP_STATE.menu!.sidebarWidthRatio),
    tagSplitRatio: sanitizeRatio(input?.tagSplitRatio, DEFAULT_APP_STATE.menu!.tagSplitRatio),
    scrollEaseMultiplier: sanitizePositive(input?.scrollEaseMultiplier, DEFAULT_APP_STATE.menu!.scrollEaseMultiplier ?? 1),
    scrollDistanceTimeInfluence: sanitizeRatio(input?.scrollDistanceTimeInfluence, DEFAULT_APP_STATE.menu!.scrollDistanceTimeInfluence ?? 0),
    scrollBaseDistanceRows: sanitizePositive(input?.scrollBaseDistanceRows, DEFAULT_APP_STATE.menu!.scrollBaseDistanceRows ?? 1),
    scrollMaxDurationMultiplier: sanitizePositive(input?.scrollMaxDurationMultiplier, DEFAULT_APP_STATE.menu!.scrollMaxDurationMultiplier ?? 1),
    sidebarViewState: sanitizeSidebarViewState(input?.sidebarViewState),
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
    await fs.writeFile(this.appStatePath, JSON.stringify(payload, null, 2), 'utf8');
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
