import type { TextureMaterialsBySurface } from './textureTypes';
import type { GlazeSettings } from './glaze';
import type { BoxBevelSettings } from './boxBevel';
import type { VisualizerColors } from './visualizer';

export const LOADOUT_CHANNELS = {
  list: 'loadout:list',
  setActive: 'loadout:setActive',
  editActive: 'loadout:editActive',
  create: 'loadout:create',
  deleteCustom: 'loadout:deleteCustom',
  restoreFactory: 'loadout:restoreFactory',
  rename: 'loadout:rename',
  setIcon: 'loadout:setIcon',
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
    spellCheck: string;
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
//   abs(id) 1-5   -> factory presets, rewritten from presets.ts every launch
//                    unless the reader edited them (`edited`)
//   abs(id) 6, 7  -> unused (were the old Custom button's default layout and
//                    the unsaved changes)
//   abs(id) >= 8  -> the reader's own layouts, numbered contiguously
//
// Each mode is a PRESET LIST (@thockdown/interaction/presetList.ts, the rule
// soundstages and soundscapes follow): exactly one row per sign has
// isActive = 1, and the live settings ARE its payload. An edit is written
// into it (`editActive`); a factory row keeps its edits (payload, name and
// icon) until restored (`restoreFactory`); a new layout is a copy of the
// active one under the first free "Layout A/B/..." name of its mode.
// ---------------------------------------------------------------------------

/** The spell-check outline colour of a layout that does not set one. */
export const FALLBACK_SPELL_CHECK_COLOR = 'rgba(255, 60, 120, 0.85)';

export const LOADOUT_FACTORY_PRESET_COUNT = 5;
/** The row the unsaved changes were kept in, retired on the next launch. */
export const LOADOUT_RETIRED_PENDING_ID_ABS = 7;
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

export function idKind(id: number): 'factory' | 'custom' {
  const abs = Math.abs(id);
  return abs >= 1 && abs <= LOADOUT_FACTORY_PRESET_COUNT ? 'factory' : 'custom';
}

export interface UiLoadoutEntry {
  id: number;
  isActive: boolean;
  signature: string;
  payload: UiLayoutLoadout;
  updatedAt: number;
  name: string;
  /** A solid Font Awesome icon without its style class (`fa-sun`), or null for the name's initials. */
  icon: string | null;
  /** A factory row the reader changed: restoring it would change it. Always false for the reader's own. */
  edited: boolean;
}

export interface UiLoadoutListResult {
  entries: UiLoadoutEntry[];
}

export interface UiLoadoutApi {
  // Full snapshot of all loadout rows plus per-mode bookkeeping.
  list(): Promise<UiLoadoutListResult>;
  // Activates an existing row by id. Applying its payload is the caller's.
  setActive(id: number): Promise<UiLoadoutListResult>;
  // Writes the live settings into the mode's active row (a factory row
  // becomes edited).
  editActive(mode: UiLoadoutMode, payload: UiLayoutLoadout): Promise<UiLoadoutListResult>;
  // A new layout of the reader's own, a copy of the active one under the
  // mode's first free "Layout A/B/..." name, made active. No-op when full.
  create(mode: UiLoadoutMode): Promise<UiLoadoutListResult>;
  // Deletes one of the reader's own layouts (abs id >= 8). If it was
  // active, the mode's default (Light or Dark) becomes active (the caller applies it).
  deleteCustom(id: number): Promise<UiLoadoutListResult>;
  // A factory row as shipped again: payload, name and icon.
  restoreFactory(id: number): Promise<UiLoadoutListResult>;
  // Names are unique per mode, case aside; a clash or a blank name changes nothing.
  rename(id: number, name: string): Promise<UiLoadoutListResult>;
  setIcon(id: number, icon: string | null): Promise<UiLoadoutListResult>;
  // Opens a save dialog and writes all user custom layouts (abs id >= 8)
  // to a .tdl file as NEUTRAL_BASE diffs. Returns void.
  exportTdl(): Promise<void>;
  exportTdlEntry(id: number): Promise<void>;
  // Opens an open dialog, parses the chosen .tdl file, and inserts any new
  // custom layouts into the database (skipping duplicates by signature).
  // Returns the updated snapshot.
  importTdl(): Promise<UiLoadoutListResult>;
}
