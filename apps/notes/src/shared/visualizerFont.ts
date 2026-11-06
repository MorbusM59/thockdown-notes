import {
  EDITOR_FONT_SIZE_MAX_PX,
  EDITOR_FONT_SIZE_MIN_PX,
  EDITOR_LINE_HEIGHT_MULTIPLIER_MAX,
  EDITOR_LINE_HEIGHT_MULTIPLIER_MIN,
  EDITOR_STYLE_OPTIONS,
  roundEditorFontSizePx,
  roundLineHeightMultiplier,
  type EditorStyleKey,
} from '../editor/EditorTypography'

/**
 * The full-screen visualizer's typography (Options > Visualizer Font), one
 * setting for every visualizer and independent of the editor's. Its scene is
 * a grid of SQUARE boxes, so where the editor has an x-box and a y-box this
 * has one `boxSize`: a multiple of the font size, read exactly as the
 * editor's y-box (line height) is, and the box's width is its height.
 */
export type VisualizerFont = {
  style: EditorStyleKey
  sizePx: number
  boxSize: number
}

/**
 * 1.05 at the default 16px gives a 17px box, which is what the scene drew
 * before it had a font of its own: the editor's default font (Share Tech
 * Mono, 0.54em wide) at an x-box of 4px each side, round(8.64 + 8).
 */
export const DEFAULT_VISUALIZER_BOX_SIZE = 1.05

/** The scene's box in pixels, whole like the editor's line height so the grid tiles pixel-exact. */
export function visualizerBoxPx(font: VisualizerFont): number {
  return Math.max(1, Math.round(font.sizePx * font.boxSize))
}

/**
 * A save without the setting yields `undefined` rather than a default, so the
 * renderer can seed it from the editor's font, which is what the visualizer
 * followed until it had its own. A damaged field takes `fallback`'s value.
 */
export function sanitizeVisualizerFont(input: unknown, fallback: VisualizerFont): VisualizerFont
export function sanitizeVisualizerFont(input: unknown, fallback?: VisualizerFont): VisualizerFont | undefined
export function sanitizeVisualizerFont(input: unknown, fallback?: VisualizerFont): VisualizerFont | undefined {
  if (typeof input !== 'object' || input === null) return fallback
  const raw = input as Record<string, unknown>
  const base: VisualizerFont = fallback ?? { style: 'sharetech', sizePx: 16, boxSize: DEFAULT_VISUALIZER_BOX_SIZE }
  const style = EDITOR_STYLE_OPTIONS.some((option) => option.key === raw.style)
    ? raw.style as EditorStyleKey
    : base.style
  const sizePx = typeof raw.sizePx === 'number' && Number.isFinite(raw.sizePx)
    ? Math.max(EDITOR_FONT_SIZE_MIN_PX, Math.min(EDITOR_FONT_SIZE_MAX_PX, roundEditorFontSizePx(raw.sizePx)))
    : base.sizePx
  const boxSize = typeof raw.boxSize === 'number' && Number.isFinite(raw.boxSize)
    ? Math.max(EDITOR_LINE_HEIGHT_MULTIPLIER_MIN, Math.min(EDITOR_LINE_HEIGHT_MULTIPLIER_MAX, roundLineHeightMultiplier(raw.boxSize)))
    : base.boxSize
  return { style, sizePx, boxSize }
}
