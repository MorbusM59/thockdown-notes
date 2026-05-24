import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppState, PersistedMenuState, PersistedViewportState, SidebarMode, WindowState } from '../src/shared/appState';

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
  if (input === 'date' || input === 'category' || input === 'archive' || input === 'trash') {
    return input;
  }
  return 'date';
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
