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
export { UI_FONT_SCALE_MIN, UI_FONT_SCALE_MAX, UI_FONT_SCALE_STEP, UI_FONT_SCALE_BASE, DEFAULT_UI_FONT_SCALE, DEFAULT_DOUBLE_SIZE_UI_FONT_SCALE, uiScaleFactor, roundUiFontScale } from '@thockdown/look/uiFontScale';
