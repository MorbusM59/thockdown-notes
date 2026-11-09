import type { TextureMaterialsBySurface } from './textureTypes';
import type { GlazeSettings } from './glaze';
import type { BoxBevelSettings } from './boxBevel';
import type { CaretAnimationPresetKey } from './caretSettings';
import type { VisualizerColors } from './visualizer';

export const LOADOUT_CHANNELS = {
  list: 'loadout:list',
  setActive: 'loadout:setActive',
  saveCustom: 'loadout:saveCustom',
  deleteCustom: 'loadout:deleteCustom',
  updatePending: 'loadout:updatePending',
  exportTdl: 'loadout:exportTdl',
  exportTdlEntry: 'loadout:exportTdlEntry',
  importTdl: 'loadout:importTdl',
} as const;

export type UiLayoutLoadout = {
  borderRadiusRegularPx: number;
  spacingRegularPx: number;
  borderAlphaPercent: number;
  boxShadowAlphaPercent: number;
  // Scroll curve tuning (Options > Scrolling Behavior) is deliberately NOT
  // here -- it lives in PersistedMenuState instead so it persists across
  // layout switches independent of whichever layout is active. See
  // appState.ts's renderScrollDynamic and friends.
  glaze: GlazeSettings;
  /** The box bevel (Options > Colors > Box bevel). */
  boxBevel: BoxBevelSettings;
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
    gutterBackground: string;
    immersiveScrollThumb: string;
    /** Optional: loadouts saved before the typing trail existed lack it. */
    flowTrail?: string;
    /** Optional: loadouts saved before spell checking's outline existed lack it. */
    spellCheck?: string;
    reviewLine: string;
    warningLine: string;
    lineNumber: string;
    base: string;
    inputFields: string;
    appButtons: string;
    markdownHeadline: string;
    markdownList: string;
    markdownBlockquote: string;
    markdownCode: string;
    markdownChecked: string;
    markdownUnchecked: string;
  };
  editorTextColors: {
    editorEditText: string;
    editorRenderText: string;
  };
  textureMaterials: TextureMaterialsBySurface;
  // Custom mouse cursor overlay appearance (Options > Mouse options). The
  // enabled toggle itself is deliberately NOT here -- it lives in
  // PersistedMenuState instead so it persists across layout switches
  // independent of whichever layout is active. See appState.ts.
  cursorDotColor: string;
  cursorCenterColor: string;
  cursorTrailColor: string;
  cursorDotCount: number;
  cursorRadiusPx: number;
  cursorSpinHz: number;
  cursorTrailThicknessPx: number;
  cursorTrailFadeMs: number;
  cursorDotSizePx: number;
  cursorCenterSizePx: number;
  cursorHaloColor: string;
  cursorHaloRadiusPx: number;
  cursorHaloFalloff: number;
  cursorPulseMagnitude: number;
  cursorPulseHz: number;
  // Click response tuning (Options > Mouse options, "click response"
  // sliders) -- see CursorClickCurve.ts. The live "current tightness" axis
  // itself is NOT here; only the curve-shape parameters are persisted.
  cursorClickRamp: number;
  cursorClickSkew: number;
  cursorClickSpeedX: number;
  cursorClickMaxSpeed: number;
  cursorClickMinHoldMs: number;
  cursorClickBalance: number;
  // Block caret appearance (Options > Caret). Sits here rather than in
  // PersistedMenuState because the caret's fill colour already lives in this
  // payload as highlightColors.caret -- splitting the caret's look across two
  // persistence homes would let a layout switch change half of it.
  caretSizeDeviationPx: number;
  caretOutlineWidthPx: number;
  caretOutlineColor: string;
  caretHaloSpreadPx: number;
  caretHaloBlurPx: number;
  caretHaloColor: string;
  caretAnimationPreset: CaretAnimationPresetKey;
  caretAnimationDurationMs: number;
  caretFrameDurationMs: number;
  caretEffectStrengthPercent: number;
  // Whether the caret follows the music (Options > Caret, the blink row's
  // last button) and the visualizer's colours (Options > Colors). How the
  // visualizer follows the music is NOT here: it is global, in
  // PersistedMenuState.visualizer (see visualizer.ts).
  visualizerColors: VisualizerColors;
};

// ---------------------------------------------------------------------------
// Loadout ID scheme
// ---------------------------------------------------------------------------
// Every loadout is one row, identified by a signed integer ID.
//   sign(id)      -> mode: positive = light, negative = dark
//   abs(id) 1-5   -> factory preset slots (read-only, rewritten every launch)
//   abs(id) 6     -> unused (was the old Custom button's default layout)
//   abs(id) 7     -> the UNSAVED row: the last live settings, always written
//   abs(id) >= 8  -> user-saved custom slots, numbered contiguously
//
// Exactly one row per sign has isActive = 1 at any time — that row's payload
// is what's currently rendered for that mode. The unsaved row is SHOWN (the
// plus button after the saved layouts) exactly when its payload equals no
// other row of its mode: `unsavedLoadoutEntry`. Nothing stores whether there
// are unsaved changes, so that cannot disagree with the rows.
// ---------------------------------------------------------------------------

export const LOADOUT_FACTORY_PRESET_COUNT = 5;
export const LOADOUT_PENDING_ID_ABS = 7;
export const LOADOUT_FIRST_CUSTOM_ID_ABS = 8;
// Not a design limit, only a bound on a list nobody should reach.
export const LOADOUT_MAX_CUSTOM_SLOTS = 100;

export type UiLoadoutMode = 'light' | 'dark';

export function modeSign(mode: UiLoadoutMode): 1 | -1 {
  return mode === 'light' ? 1 : -1;
}

export function idMode(id: number): UiLoadoutMode {
  return id > 0 ? 'light' : 'dark';
}

export function idKind(id: number): 'factory' | 'pending' | 'custom' {
  const abs = Math.abs(id);
  if (abs >= 1 && abs <= LOADOUT_FACTORY_PRESET_COUNT) return 'factory';
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
}

/** The mode's unsaved row when it differs from every other row (its plus button is shown), else null. */
export function unsavedLoadoutEntry(entries: readonly UiLoadoutEntry[], mode: UiLoadoutMode): UiLoadoutEntry | null {
  const sign = modeSign(mode);
  const pending = entries.find((entry) => entry.id === LOADOUT_PENDING_ID_ABS * sign);
  if (!pending) return null;
  const matched = entries.some((entry) => entry.id !== pending.id && entry.id * sign > 0 && entry.signature === pending.signature);
  return matched ? null : pending;
}

export interface UiLoadoutApi {
  // Full snapshot of all loadout rows plus per-mode bookkeeping.
  list(): Promise<UiLoadoutListResult>;
  // Activates an existing row by id (factory preset, saved slot, or the
  // unsaved row). The unsaved row is kept. Returns the updated snapshot.
  setActive(id: number): Promise<UiLoadoutListResult>;
  // Writes `payload` into the unsaved row (+/-7) for the given mode and
  // activates it, or the row it matches if it matches one (the unsaved row
  // is then not shown). Returns the updated snapshot.
  updatePending(mode: UiLoadoutMode, payload: UiLayoutLoadout): Promise<UiLoadoutListResult>;
  // Saves the unsaved row (+/-7) for `mode` as a new slot (abs id >= 8),
  // active if the unsaved row was. No-ops when it is not shown (it equals
  // another row) or the list is full.
  saveCustom(mode: UiLoadoutMode): Promise<UiLoadoutListResult>;
  // Deletes a saved custom slot (abs id >= 8). If the deleted slot was
  // active, its payload becomes the unsaved row, which is activated, so
  // the screen does not change.
  deleteCustom(id: number): Promise<UiLoadoutListResult>;
  // Opens a save dialog and writes all user custom layouts (abs id >= 8)
  // to a .tdl file as NEUTRAL_BASE diffs. Returns void.
  exportTdl(): Promise<void>;
  exportTdlEntry(id: number): Promise<void>;
  // Opens an open dialog, parses the chosen .tdl file, and inserts any new
  // custom layouts into the database (skipping duplicates by signature).
  // Returns the updated snapshot.
  importTdl(): Promise<UiLoadoutListResult>;
}
