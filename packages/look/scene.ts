import { mapThroughScene, type SceneEffect } from './imageCorrection'

/**
 * What the theme's scene does to a colour on its way to the screen, as data:
 * the one description `themeFrame` builds the filter string and the blend
 * overlays from, and that anything needing a colour's ON-SCREEN value (the
 * flow colour, `flowColor.ts`) reads instead of restating the order.
 *
 * The order on screen is: content, then the invert blend overlay (only when
 * invert is the scene's sole effect, see `invertViaBlendMode`), then the
 * colorize overlay, all inside the filter wrapper, whose filter applies last.
 */
export interface SceneDescription {
  /** The wrapper's filter, in the order it applies (invert first, when it is in the filter). */
  filterEffects: SceneEffect[]
  /** Invert is drawn as a `difference` overlay inside the wrapper instead of in the filter. */
  invertViaBlendMode: boolean
  /** The `color`-blend overlay, or null. */
  colorize: { hueDeg: number; opacity: number } | null
}

export interface SceneSettings {
  filterInvert: number
  filterSepia: number
  filterHueRotate: number
  filterBrightness: number
  filterContrast: number
  filterSaturate: number
  filterColorize: number
}

// Saturate slider: position x in [0,1] maps to CSS saturate value via
// s(x) = x / (1 - 4^(x-1)), capped at SATURATE_MAX.
// At x=0: s=0 (greyscale), x=0.5: s=1 (neutral), x->1: s->infinity (capped).
const SATURATE_MAX = 64

function saturatePosToValue(x: number): number {
  const xClamped = Math.max(0, Math.min(0.9999, x))
  if (xClamped <= 0) return 0
  const denom = 1 - Math.pow(4, xClamped - 1)
  if (Math.abs(denom) < 1e-9) return SATURATE_MAX
  const s = xClamped / denom
  return Math.max(0, Math.min(SATURATE_MAX, s))
}

export function sceneOf(settings: SceneSettings, reduceVisualEffects: boolean): SceneDescription {
  const inverted = settings.filterInvert > 0.5
  const decorative: SceneEffect[] = []
  if (!reduceVisualEffects) {
    if (settings.filterSepia > 0) decorative.push({ kind: 'sepia', amount: settings.filterSepia })
    if (settings.filterHueRotate !== 0) decorative.push({ kind: 'hue-rotate', deg: settings.filterHueRotate })
    if (settings.filterBrightness !== 1) decorative.push({ kind: 'brightness', amount: settings.filterBrightness })
    if (settings.filterContrast !== 1) decorative.push({ kind: 'contrast', amount: settings.filterContrast })
    const saturate = saturatePosToValue(settings.filterSaturate)
    if (Math.abs(saturate - 1) > 0.001) decorative.push({ kind: 'saturate', amount: saturate })
  }
  // Invert alone is drawn as a blend overlay rather than a filter: a filter
  // re-rasterizes the whole subtree on every repaint, a blend is composited.
  const invertViaBlendMode = inverted && decorative.length === 0
  const filterEffects: SceneEffect[] = invertViaBlendMode
    ? decorative
    : (settings.filterInvert > 0 ? [{ kind: 'invert', amount: settings.filterInvert }, ...decorative] : decorative)
  const colorize = settings.filterColorize > 0 && !reduceVisualEffects
    ? { hueDeg: settings.filterHueRotate, opacity: settings.filterColorize }
    : null
  return { filterEffects, invertViaBlendMode, colorize }
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

/** Rec. 601 luma, the `Lum` of the Compositing spec's non-separable blend modes. */
function lum([r, g, b]: readonly number[]): number {
  return 0.3 * r + 0.59 * g + 0.11 * b
}

/** The Compositing spec's SetLum with its ClipColor. */
function setLum(c: readonly number[], l: number): number[] {
  const d = l - lum(c)
  const x = c.map((v) => v + d)
  const L = lum(x)
  const n = Math.min(...x)
  const m = Math.max(...x)
  return x.map((v) => {
    if (n < 0) v = L + ((v - L) * L) / (L - n)
    if (m > 1) v = L + ((v - L) * (1 - L)) / (m - L)
    return v
  })
}

/** HSL (h in degrees, s and l 0..1) to RGB 0..1. */
export function hslToRgb(h: number, s: number, l: number): number[] {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  return [0, 8, 4].map((n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))
}

/**
 * A content colour (RGB 0..1, opaque) as the reader sees it through the
 * scene. Each stage is clamped the way the browser clamps it; the filter
 * chain itself is treated as one affine map (`imageCorrection.ts` says what
 * that misses: a colour pushed out of range between two filter functions).
 */
export function screenColorOf(scene: SceneDescription, rgb: readonly number[]): number[] {
  let c = rgb.map(clamp01)
  if (scene.invertViaBlendMode) c = c.map((v) => 1 - v)
  if (scene.colorize) {
    const tinted = setLum(hslToRgb(scene.colorize.hueDeg, 0.5, 0.5), lum(c))
    c = c.map((v, i) => v + (tinted[i] - v) * scene.colorize!.opacity)
  }
  return mapThroughScene(scene.filterEffects, c).map(clamp01)
}
