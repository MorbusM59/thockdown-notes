// UI chrome font (Options > UI Font, between Borders & Spacing and Mouse
// Options). Distinct from EditorTypography.ts's editor/render content fonts:
// this scales the app's own labels/buttons/tags/tooltips, not note text.

export type UiFontKey =
  | 'system'
  | 'atkinson'
  | 'inter'
  | 'ibmplexsans'
  | 'nunitosans'
  | 'publicsans'
  | 'carlito';

export const DEFAULT_UI_FONT_KEY: UiFontKey = 'system';

// The picker grid (Options > UI Font) renders exactly these 6 -- 'system'
// (the default, matching the app's current look) is deliberately not a
// clickable tile, so a fresh install shows no tile highlighted rather than
// forcing a visible font change before the user has opted into one.
export const UI_FONT_OPTIONS: Array<{ key: UiFontKey; label: string; family: string }> = [
  { key: 'atkinson', label: 'Atkinson Hyperlegible', family: "'Atkinson Hyperlegible', system-ui, sans-serif" },
  { key: 'inter', label: 'Inter', family: "'Inter', system-ui, sans-serif" },
  { key: 'ibmplexsans', label: 'IBM Plex Sans', family: "'IBM Plex Sans', system-ui, sans-serif" },
  { key: 'nunitosans', label: 'Nunito Sans', family: "'Nunito Sans', system-ui, sans-serif" },
  { key: 'publicsans', label: 'Public Sans', family: "'Public Sans', system-ui, sans-serif" },
  { key: 'carlito', label: 'Calibri Light (Carlito)', family: "'Carlito', 'Calibri Light', system-ui, sans-serif" },
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
