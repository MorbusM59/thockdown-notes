// The UI font scale: the desktop's UI Font size and the phone's Text size are one setting with one range.
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
