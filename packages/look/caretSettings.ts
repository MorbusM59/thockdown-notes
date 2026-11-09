// Bounds/defaults for the editor's block caret (see components/CM6Editor.tsx,
// `.thockdown-block-caret` in index.css, and the "Caret" section of
// SidebarOptionsPanel.tsx). Kept separate from appState.ts so the editor, the
// keyframe builder and the options UI can all import bounds without pulling in
// the persistence types -- same split as cursorSettings.ts, which this file
// deliberately mirrors.
//
// The caret's LOOK is layout-scoped (it lives in UiLayoutLoadout, next to
// highlightColors.caret which supplies the caret's fill colour). How it
// flashes is not: that is the app's global flashing curve (shared/flashing.ts
// in the app), which reaches the keyframe builder below as sampled levels.

import { clampAlphaChannel, clampColorChannel, parseCssColorToRgba, type RgbaColor } from './colorMath'

export interface CaretSettings {
  /**
   * Deviation in px from the caret's default box on EVERY side -- 0 is the
   * historical geometry (covering a grid cell's content but not the grid line
   * around it), -1 leaves a 1px gap to the surrounding primary grid lines, +1
   * spills 1px past them. See CM6Editor.tsx's updateCaret for the arithmetic.
   */
  sizeDeviationPx: number
  /** Outline drawn around the caret rectangle. 0 = no outline. */
  outlineWidthPx: number
  /** Halo: a box-shadow with no x/y offset. How far it reaches past the caret. */
  haloSpreadPx: number
  /** Softness of that halo's edge. 0 = a hard ring, the original look. */
  haloBlurPx: number
  outlineColor: string
  haloColor: string
}


// Deliberately symmetric around 0 so the slider's centre detent is the
// historical look; see CaretSettings.sizeDeviationPx.
export const CARET_SIZE_DEVIATION_MIN_PX = -5
export const CARET_SIZE_DEVIATION_MAX_PX = 5
export const CARET_SIZE_DEVIATION_STEP_PX = 1
export const CARET_SIZE_DEVIATION_DEFAULT_PX = 0

export const CARET_OUTLINE_WIDTH_MIN_PX = 0
export const CARET_OUTLINE_WIDTH_MAX_PX = 5
export const CARET_OUTLINE_WIDTH_STEP_PX = 1
export const CARET_OUTLINE_WIDTH_DEFAULT_PX = 0

export const CARET_HALO_SPREAD_MIN_PX = 0
export const CARET_HALO_SPREAD_MAX_PX = 20
export const CARET_HALO_SPREAD_STEP_PX = 1
export const CARET_HALO_SPREAD_DEFAULT_PX = 0

// Blur is independent of spread: a halo can be soft without reaching further
// (blur alone feathers the caret's own edge outward), or reach without
// softening (the hard ring the halo shipped as).
export const CARET_HALO_BLUR_MIN_PX = 0
export const CARET_HALO_BLUR_MAX_PX = 20
export const CARET_HALO_BLUR_STEP_PX = 1
export const CARET_HALO_BLUR_DEFAULT_PX = 0


/** Last-resort fill colour if `highlightColors.caret` cannot be parsed. */
export const DEFAULT_CARET_FILL_COLOR = 'rgba(0, 0, 0, 0.3)'
export const DEFAULT_CARET_OUTLINE_COLOR = 'rgba(0, 0, 0, 0.45)'
export const DEFAULT_CARET_HALO_COLOR = 'rgba(0, 0, 0, 0.18)'

export const DEFAULT_CARET_SETTINGS: CaretSettings = {
  sizeDeviationPx: CARET_SIZE_DEVIATION_DEFAULT_PX,
  outlineWidthPx: CARET_OUTLINE_WIDTH_DEFAULT_PX,
  haloSpreadPx: CARET_HALO_SPREAD_DEFAULT_PX,
  haloBlurPx: CARET_HALO_BLUR_DEFAULT_PX,
  outlineColor: DEFAULT_CARET_OUTLINE_COLOR,
  haloColor: DEFAULT_CARET_HALO_COLOR,
}

// ---------------------------------------------------------------------------
// Keyframe generation
// ---------------------------------------------------------------------------

export interface CaretBlinkKeyframeOptions {
  /**
   * The opacity, 0..1, at evenly spaced moments of one cycle, both ends
   * included (`flashLevels` in the app's `shared/flashing.ts`).
   */
  levels: ArrayLike<number>
  /** The caret's fill colour -- `highlightColors.caret`, not a caret setting. */
  caretColor: string
  outlineColor: string
  haloColor: string
  haloSpreadPx: number
  haloBlurPx: number
}

/** Trims trailing zeroes so the generated CSS stays readable when inspected. */
function formatNumber(value: number, decimals = 3): string {
  const factor = 10 ** decimals
  return String(Math.round(value * factor) / factor)
}

/**
 * Emits a concrete `rgba()` with the colour's own alpha scaled by `alphaScale`.
 *
 * Concrete, and resolved here rather than left to the stylesheet, because
 * `color-mix()` and `var()` inside an animated property are NOT interpolable
 * in every engine that runs this app: Chromium 124 (Electron 30) animates such
 * keyframes DISCRETELY, flipping between stop values instead of ramping
 * between them, which silently reduced the whole blink to four hard steps and
 * made the frame setting invisible. Newer Chromium interpolates them fine,
 * which is exactly why the holds' alpha adjustments are the only deliberate
 * `var()` exception here. Keep them limited to alpha math; do not add
 * `color-mix()` or unrelated variables to the animated stops.
 */
/**
 * The caret's HOLD blends the animated alpha toward the colour's own alpha,
 * the peak of the blink: at 1 the caret stands still at its peak, and as the
 * hold falls the blink takes over again. Two holds, the larger wins, so
 * neither can break the other: the typing hold (`--caret-typing-hold`, 1 the
 * moment the caret moves, falling back on the typing trail's fade curve) and
 * the music's (`--beat-caret-hold`, 1 while the caret follows a beat, eased
 * in and out by a transition in index.css, so the blink and the beat hand
 * over without a jump).
 */
function holdAdjustedRgba(color: RgbaColor, alphaScale: number): string {
  const baseAlpha = formatNumber(clampAlphaChannel(color.a), 4)
  const animatedAlpha = formatNumber(
    clampAlphaChannel(color.a * Math.max(0, Math.min(1, alphaScale))),
    4,
  )
  const alpha = `calc(${animatedAlpha} + (${baseAlpha} - ${animatedAlpha}) * max(var(--caret-typing-hold, 0), var(--beat-caret-hold, 0)))`
  return `rgba(${clampColorChannel(color.r)}, ${clampColorChannel(color.g)}, ${clampColorChannel(color.b)}, ${alpha})`
}

function parseColorOrFallback(color: string, fallback: string): RgbaColor {
  return parseCssColorToRgba(color)
    ?? parseCssColorToRgba(fallback)
    ?? { r: 0, g: 0, b: 0, a: 1 }
}

/**
 * Builds the `@keyframes thockdown-blink` rule for one cycle of the flashing
 * curve: a stop per level, run straight between (the caret's animation is
 * `linear` in index.css; the curve's own shape is in the levels). Generated at
 * runtime because every part of it depends on user settings.
 *
 * All three animatable caret surfaces (fill, outline, halo) are faded together
 * from the same alpha so the caret reads as one object rather than a solid
 * ring around a blinking centre. None of them animates `opacity`, which would
 * put the caret on the compositor -- see `.thockdown-block-caret` in index.css
 * for the black edit pane that causes.
 */
export function buildCaretBlinkKeyframesCss(options: CaretBlinkKeyframeOptions): string {
  const { levels, caretColor, outlineColor, haloColor, haloSpreadPx, haloBlurPx } = options
  const fill = parseColorOrFallback(caretColor, DEFAULT_CARET_FILL_COLOR)
  const outline = parseColorOrFallback(outlineColor, DEFAULT_CARET_OUTLINE_COLOR)
  const halo = parseColorOrFallback(haloColor, DEFAULT_CARET_HALO_COLOR)
  const spread = formatNumber(Math.max(0, haloSpreadPx))
  const blur = formatNumber(Math.max(0, haloBlurPx))
  const last = Math.max(1, levels.length - 1)
  const blocks: string[] = []
  for (let i = 0; i < levels.length; i += 1) {
    const alpha = levels[i]
    const declarations = [
      `background-color: ${holdAdjustedRgba(fill, alpha)};`,
      `outline-color: ${holdAdjustedRgba(outline, alpha)};`,
      `box-shadow: 0 0 ${blur}px ${spread}px ${holdAdjustedRgba(halo, alpha)};`,
    ]
    blocks.push(`  ${formatNumber((i / last) * 100, 4)}% { ${declarations.join(' ')} }`)
  }
  return `@keyframes thockdown-blink {\n${blocks.join('\n')}\n}\n`
}
