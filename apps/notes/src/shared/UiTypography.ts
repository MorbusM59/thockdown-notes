// UI chrome font (Options > UI Font, between Borders and Cursor
// Options). Distinct from EditorTypography.ts's editor/render content fonts:
// this scales the app's own labels/buttons/tags/tooltips, not note text.

export type UiFontKey =
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

export const DEFAULT_UI_FONT_KEY: UiFontKey = 'geo';

// The picker grid (Options > UI Font) renders exactly these 12. Geo is the
// default. 'system' is not a tile: it remains only so a save that chose it
// before Geo became the default still resolves to a font. IBM
// Plex Sans is the one general-purpose workhorse; everything after it
// leans into personality. Most reuse font files already bundled for the
// editor/render pickers (EditorTypography.ts/SidebarOptionsPanel.tsx's
// VIEW_STYLE_OPTIONS) rather than shipping duplicate assets -- Alata, Geo,
// Carter One, Ceviche One, Unica One, and Sniglet were new to the bundle.
export const UI_FONT_OPTIONS: Array<{ key: UiFontKey; label: string; family: string }> = [
  { key: 'ibmplexsans', label: 'IBM Plex Sans', family: "'IBM Plex Sans', system-ui, sans-serif" },
  { key: 'alata', label: 'Alata', family: "'Alata', system-ui, sans-serif" },
  { key: 'geo', label: 'Geo', family: "'Geo', system-ui, sans-serif" },
  { key: 'carterone', label: 'Carter One', family: "'Carter One', system-ui, sans-serif" },
  { key: 'cevicheone', label: 'Ceviche One', family: "'Ceviche One', system-ui, sans-serif" },
  { key: 'unicaone', label: 'Unica One', family: "'Unica One', system-ui, sans-serif" },
  { key: 'sniglet', label: 'Sniglet', family: "'Sniglet', system-ui, sans-serif" },
  { key: 'kellyslab', label: 'Kelly Slab', family: "'Kelly Slab', system-ui, sans-serif" },
  { key: 'novamono', label: 'Nova Mono', family: "'Nova Mono', system-ui, sans-serif" },
  { key: 'vt323', label: 'VT323', family: "'VT323', system-ui, sans-serif" },
  { key: 'boogaloo', label: 'Boogaloo', family: "'Boogaloo', system-ui, sans-serif" },
  { key: 'sourgummy', label: 'Sour Gummy', family: "'Sour Gummy', system-ui, sans-serif" },
];

const FONT_FAMILY_BY_KEY: Record<UiFontKey, string> = {
  system: "system-ui, -apple-system, sans-serif",
  ...Object.fromEntries(UI_FONT_OPTIONS.map((option) => [option.key, option.family])),
} as Record<UiFontKey, string>;

export function resolveUiFontFamily(key: UiFontKey): string {
  return FONT_FAMILY_BY_KEY[key] ?? FONT_FAMILY_BY_KEY[DEFAULT_UI_FONT_KEY];
}

/**
 * The UI font scale as the reader sets it. 1 is not the stylesheets' own
 * size: the interface is drawn at UI_FONT_SCALE_BASE times it (so the
 * stylesheets' 1 sits at 1/1.1 on this scale), and --ui-font-scale on the
 * root carries that product (uiScaleFactor).
 */
export const UI_FONT_SCALE_MIN = 0.8;
export const UI_FONT_SCALE_MAX = 1.5;
export const UI_FONT_SCALE_STEP = 0.05;
export const UI_FONT_SCALE_BASE = 1.1;
/** The default in regular size mode. */
export const DEFAULT_UI_FONT_SCALE = 1.2;
/** The default in double size mode, where the page itself is doubled. */
export const DEFAULT_DOUBLE_SIZE_UI_FONT_SCALE = 1;

/** The factor the stylesheets' sizes are multiplied by, for a UI font scale. */
export function uiScaleFactor(uiFontScale: number): number {
  return uiFontScale * UI_FONT_SCALE_BASE;
}

export function roundUiFontScale(value: number): number {
  // 1/0.05 = 20: multiplying by the clean integer first (rather than
  // dividing by 0.05, which isn't exactly representable) keeps this from
  // accumulating float noise like 1.1500000000000001.
  return Math.round(value * 20) / 20;
}
