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
 * setting for every visualizer and independent of the editor's (the size is
 * remembered per size mode, in App's fontSizesByMode). Its scene is
 * a grid of SQUARE boxes, so where the editor has an x-box and a y-box this
 * has one `boxSize`: a multiple of the font size, read exactly as the
 * editor's y-box (line height) is, and the box's width is its height.
 */
export type VisualizerFont = {
  style: EditorStyleKey
  sizePx: number
  boxSize: number
}

export const DEFAULT_VISUALIZER_STYLE: EditorStyleKey = 'kodemono'
/** The default size in each size mode (double size mode then doubles the page, so 12 there draws at 24). */
export const DEFAULT_VISUALIZER_FONT_SIZE_PX = { regular: 18, double: 12 } as const
export const DEFAULT_VISUALIZER_BOX_SIZE = 1.05

/** The scene's box in pixels, whole like the editor's line height so the grid tiles pixel-exact. */
export function visualizerBoxPx(font: VisualizerFont): number {
  return Math.max(1, Math.round(font.sizePx * font.boxSize))
}

export const DEFAULT_VISUALIZER_FONT: VisualizerFont = {
  style: DEFAULT_VISUALIZER_STYLE,
  sizePx: DEFAULT_VISUALIZER_FONT_SIZE_PX.regular,
  boxSize: DEFAULT_VISUALIZER_BOX_SIZE,
}

/** A missing setting stays missing (the renderer applies the defaults); a damaged field takes its default. */
export function sanitizeVisualizerFont(input: unknown): VisualizerFont | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const raw = input as Record<string, unknown>
  const base = DEFAULT_VISUALIZER_FONT
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
