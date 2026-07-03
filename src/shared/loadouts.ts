import type { TextureMaterialsBySurface } from '../textures/types';
import type { GlazeSettings } from './glaze';

export const LOADOUT_CHANNELS = {
  list: 'loadout:list',
  setActive: 'loadout:setActive',
  saveCustom: 'loadout:saveCustom',
  deleteCustom: 'loadout:deleteCustom',
  resetCustom: 'loadout:resetCustom',
  updatePending: 'loadout:updatePending',
  exportTdl: 'loadout:exportTdl',
  importTdl: 'loadout:importTdl',
} as const;

export type UiLayoutLoadout = {
  editorGlyphPaddingPx: number;
  audioKeyVolume: number;
  audioBassVolume: number;
  audioTrebleVolume: number;
  audioReverbStrength: number;
  audioReverbSpace: number;
  typingSoundEnabled: boolean;
  typingSoundSet: 'A' | 'B' | 'C';
  renderScrollDynamic: number;
  renderScrollResponsiveness: number;
  renderScrollTotalTimeSec: number;
  renderScrollMaxSpeedPxPerSec: number;
  renderScrollSkew: number;
  glaze: GlazeSettings;
  darkMode: 'none' | 'mono' | 'red' | 'dusk' | 'neon' | 'matrix';
  filterInvert: number;
  filterSepia: number;
  filterHueRotate: number;
  filterBrightness: number;
  filterContrast: number;
  filterSaturate: number;
  filterColorize: number;
  highlightColors: {
    caret: string;
    search: string;
    selectionEdit: string;
    selectionRender: string;
    textBase: string;
    textEmbossEdit: string;
    textEmbossRender: string;
    textEmbossUi: string;
    background: string;
    topBackground: string;
    bottomBackground: string;
    gridOutline: string;
    grid: string;
    base: string;
    inputFields: string;
    appButtons: string;
  };
  editorTextColors: {
    editorEditText: string;
    editorRenderText: string;
  };
  textureMaterials: TextureMaterialsBySurface;
};

// ---------------------------------------------------------------------------
// Loadout ID scheme
// ---------------------------------------------------------------------------
// Every loadout is one row, identified by a signed integer ID.
//   sign(id)      -> mode: positive = light, negative = dark
//   abs(id) 1-5   -> factory preset slots (read-only, seeded at first run)
//   abs(id) 6     -> default custom loadout (read-only, the reset target)
//   abs(id) 7     -> pending/scratch slot — holds live unsaved edits
//   abs(id) >= 8  -> user-saved custom slots, assigned sequentially
//
// Exactly one row per sign has isActive = 1 at any time — that row's payload
// is what's currently rendered for that mode.
// ---------------------------------------------------------------------------

export const LOADOUT_FACTORY_PRESET_COUNT = 5;
export const LOADOUT_DEFAULT_CUSTOM_ID_ABS = 6;
export const LOADOUT_PENDING_ID_ABS = 7;
export const LOADOUT_FIRST_CUSTOM_ID_ABS = 8;
export const LOADOUT_MAX_CUSTOM_SLOTS = 9;

export type UiLoadoutMode = 'light' | 'dark';

export function modeSign(mode: UiLoadoutMode): 1 | -1 {
  return mode === 'light' ? 1 : -1;
}

export function idMode(id: number): UiLoadoutMode {
  return id > 0 ? 'light' : 'dark';
}

export function idKind(id: number): 'factory' | 'default-custom' | 'pending' | 'custom' {
  const abs = Math.abs(id);
  if (abs >= 1 && abs <= LOADOUT_FACTORY_PRESET_COUNT) return 'factory';
  if (abs === LOADOUT_DEFAULT_CUSTOM_ID_ABS) return 'default-custom';
  if (abs === LOADOUT_PENDING_ID_ABS) return 'pending';
  return 'custom';
}

export interface UiLoadoutEntry {
  id: number;
  isActive: boolean;
  signature: string;
  payload: UiLayoutLoadout;
  updatedAt: number;
}

export interface UiLoadoutListResult {
  entries: UiLoadoutEntry[];
  // Last custom id activated per mode (id with abs >= 6), used to resolve
  // the dynamic "Custom" preset button target. Defaults to the default
  // custom id (+/-6) if nothing custom has ever been activated.
  lastCustomIdByMode: { light: number; dark: number };
}

export interface UiLoadoutApi {
  // Full snapshot of all loadout rows plus per-mode bookkeeping.
  list(): Promise<UiLoadoutListResult>;
  // Activates an existing row by id (factory preset, default-custom, or a
  // previously saved custom slot). Returns the updated snapshot.
  setActive(id: number): Promise<UiLoadoutListResult>;
  // Writes `payload` into the pending row (+/-7) for the given mode and
  // marks it active. If the payload's signature matches an existing row,
  // that row is activated instead (collapsing pending into the match).
  // Returns the updated snapshot.
  updatePending(mode: UiLoadoutMode, payload: UiLayoutLoadout): Promise<UiLoadoutListResult>;
  // Persists the current pending row (+/-7) for `mode` into a new custom
  // slot (abs id >= 8), activates it, and resets the pending row to inert.
  // No-ops if the pending row isn't currently active for that mode.
  saveCustom(mode: UiLoadoutMode): Promise<UiLoadoutListResult>;
  // Deletes a saved custom slot (abs id >= 8). If the deleted slot was
  // active, default-custom (+/-6) is activated.
  deleteCustom(id: number): Promise<UiLoadoutListResult>;
  // Restores the default-custom row (+/-6) for `mode` and activates it,
  // discarding any pending edits.
  resetCustom(mode: UiLoadoutMode): Promise<UiLoadoutListResult>;
  // Opens a save dialog and writes all user custom layouts (abs id >= 8)
  // to a .tdl file as NEUTRAL_BASE diffs. Returns void.
  exportTdl(): Promise<void>;
  // Opens an open dialog, parses the chosen .tdl file, and inserts any new
  // custom layouts into the database (skipping duplicates by signature).
  // Returns the updated snapshot.
  importTdl(): Promise<UiLoadoutListResult>;
}
