import { isMonoFontKey, type MonoFontKey } from '../visualizer/visualizerFonts'

/**
 * The visualizer scene's typography, one setting for every visualizer and
 * independent of the editor's: Options > Visualizer's font on the desktop
 * (its size remembered per size mode, in App's fontSizesByMode), the
 * Visualizer tab's Font on the phone, the same controls and ranges on both.
 * The scene is a grid of SQUARE boxes, so where the editor has an x-box and
 * a y-box this has one `boxSize`: a multiple of the font size, read exactly
 * as the editor's y-box (line height) is, and the box's width is its height.
 * The font size's range is the editor's own; the box size's starts at 1.
 */
export type VisualizerFont = {
  style: MonoFontKey
  sizePx: number
  boxSize: number
}

export const VISUALIZER_FONT_SIZE_PX = { min: 6, max: 24, step: 0.5 } as const
/**
 * The box over the font size: the scene's LINE HEIGHT, from 1 (the box as tall
 * as the font, so a letter is never cut) to 3. Below 1 the box cut its letters.
 */
export const VISUALIZER_BOX_SIZE = { min: 1, max: 3, step: 0.05 } as const

export const DEFAULT_VISUALIZER_STYLE: MonoFontKey = 'kodemono'
export const DEFAULT_VISUALIZER_BOX_SIZE = 1.2

export const DEFAULT_VISUALIZER_FONT: VisualizerFont = {
  style: DEFAULT_VISUALIZER_STYLE,
  sizePx: 18,
  boxSize: DEFAULT_VISUALIZER_BOX_SIZE,
}

/**
 * The font the scene draws with in a size mode. The setting is one for both
 * modes; double size mode doubles the page, so it draws at half the size and
 * the letters stay as large on screen as in regular mode.
 */
export function visualizerFontForMode(font: VisualizerFont, isDoubleSize: boolean): VisualizerFont {
  return isDoubleSize ? { ...font, sizePx: font.sizePx / 2 } : font
}

/** A font size on its 0.5px step, inside its range. */
export function clampVisualizerFontSizePx(value: number): number {
  return Math.max(VISUALIZER_FONT_SIZE_PX.min, Math.min(VISUALIZER_FONT_SIZE_PX.max, Math.round(value * 2) / 2))
}

/** A box size on its 0.05 step (times 20 rather than over 0.05, which is not exact), inside its range. */
export function clampVisualizerBoxSize(value: number): number {
  return Math.max(VISUALIZER_BOX_SIZE.min, Math.min(VISUALIZER_BOX_SIZE.max, Math.round(value * 20) / 20))
}

/** The scene's box in pixels, whole like the editor's line height so the grid tiles pixel-exact. */
export function visualizerBoxPx(font: VisualizerFont): number {
  return Math.max(1, Math.round(font.sizePx * font.boxSize))
}

/** A missing setting stays missing (the reader applies the defaults); a damaged field takes its default. */
export function sanitizeVisualizerFont(input: unknown): VisualizerFont | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const raw = input as Record<string, unknown>
  const base = DEFAULT_VISUALIZER_FONT
  return {
    style: isMonoFontKey(raw.style) ? raw.style : base.style,
    sizePx: typeof raw.sizePx === 'number' && Number.isFinite(raw.sizePx) ? clampVisualizerFontSizePx(raw.sizePx) : base.sizePx,
    boxSize: typeof raw.boxSize === 'number' && Number.isFinite(raw.boxSize) ? clampVisualizerBoxSize(raw.boxSize) : base.boxSize,
  }
}
