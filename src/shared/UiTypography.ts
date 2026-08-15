// UI chrome font (Options > UI Font, between Borders & Spacing and Mouse
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
  | 'xkcd'
  | 'sourgummy';

export const DEFAULT_UI_FONT_KEY: UiFontKey = 'system';

// The picker grid (Options > UI Font) renders exactly these 12 -- 'system'
// (the default, matching the app's current look) is deliberately not a
// clickable tile, so a fresh install shows no tile highlighted rather than
// forcing a visible font change before the user has opted into one. IBM
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
  { key: 'xkcd', label: 'xkcd', family: "'xkcd', 'Comic Sans MS', system-ui, sans-serif" },
  { key: 'sourgummy', label: 'Sour Gummy', family: "'Sour Gummy', system-ui, sans-serif" },
];

const FONT_FAMILY_BY_KEY: Record<UiFontKey, string> = {
  system: "system-ui, -apple-system, sans-serif",
  ...Object.fromEntries(UI_FONT_OPTIONS.map((option) => [option.key, option.family])),
} as Record<UiFontKey, string>;

export function resolveUiFontFamily(key: UiFontKey): string {
  return FONT_FAMILY_BY_KEY[key] ?? FONT_FAMILY_BY_KEY[DEFAULT_UI_FONT_KEY];
}

export const UI_FONT_SCALE_MIN = 0.85;
export const UI_FONT_SCALE_MAX = 1.6;
export const UI_FONT_SCALE_STEP = 0.05;
export const DEFAULT_UI_FONT_SCALE = 1;

export function roundUiFontScale(value: number): number {
  // 1/0.05 = 20: multiplying by the clean integer first (rather than
  // dividing by 0.05, which isn't exactly representable) keeps this from
  // accumulating float noise like 1.1500000000000001.
  return Math.round(value * 20) / 20;
}
