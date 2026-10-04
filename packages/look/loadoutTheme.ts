/**
 * How a visual loadout (a preset's colours, filters, geometry and glaze; see
 * presets.ts) becomes what is on screen. Pure: it takes the loadout's values
 * and returns CSS custom properties, a filter and the overlays to draw, and
 * the caller puts them on its own elements.
 *
 * It exists so the desktop app (App.tsx) and the mobile soundscape app
 * (apps/soundscapes/) draw a preset the same way. Before it, these derivations lived
 * inline in App.tsx, where nothing else could reach them.
 *
 * Deliberately NOT here: textures (rendered to images by a worker and cached
 * by the desktop's main process), the caret and the custom cursor (editor
 * concerns), and layout. A loadout's texture settings are therefore ignored by
 * anything that only uses this module.
 *
 * The element structure the result is meant for is the desktop's, outermost
 * first:
 *   .app-root               style = rootVariables
 *     .app-saturate-wrapper style = wrapperStyle  (the whole scene is filtered once)
 *       .glaze-overlay-stack  (ThemeGlazeLayers)
 *       .app-sheen
 *         .app-shell[.shadow-flip]  style = shellVariables
 *     ThemeBlendOverlays   (invert / colorize, above everything)
 * plus applyDocumentTheme on <html>.
 */
import type { CSSProperties } from 'react'
import {
  type HsvaColor,
  hsvaToRgba,
  invertRgbaColor,
  parseCssColorToRgba,
  rgbaToCssColor,
  rgbaToHex,
  rgbaToHsva,
  scaleAlphaInCssValue,
} from './colorMath'
import {
  GLAZE_GLOOM_OPACITY_MAX,
  GLAZE_LINEAR_OPACITY_MAX,
  GLAZE_RADIAL_OPACITY_MAX,
  GLAZE_SHEEN_OPACITY_MAX,
  type GlazeSettings,
} from './glaze'
import type { UiLayoutLoadout } from './loadouts'
import { BORDER_ALPHA_TOKENS, BOX_SHADOW_ALPHA_TOKENS } from './borderShadowAlphaTokens'

/** The part of a loadout that decides how the app looks. */
export type ThemeLoadout = Pick<
  UiLayoutLoadout,
  | 'borderRadiusRegularPx'
  | 'spacingRegularPx'
  | 'borderAlphaPercent'
  | 'boxShadowAlphaPercent'
  | 'highlightColors'
  | 'editorTextColors'
  | 'glaze'
  | 'filterInvert'
  | 'filterSepia'
  | 'filterHueRotate'
  | 'filterBrightness'
  | 'filterContrast'
  | 'filterSaturate'
  | 'filterColorize'
>

export interface ThemeOptions {
  /** The low-power switch: drops glaze, colorize and every decorative filter (invert stays). */
  reduceVisualEffects: boolean
  /** Selection colour follows the active view: the render view has its own. */
  isPreviewMode: boolean
}

export interface ThemeGlazeImages {
  linear: string
  radial: string
  gloom: string
  sheen: string
}

export interface ThemeFrame {
  /** For the outermost element. */
  rootVariables: Record<string, string>
  /** For the app shell. Overlaps rootVariables on purpose: see themeFrame. */
  shellVariables: Record<string, string>
  /** For the filter wrapper around the whole scene. */
  wrapperStyle: CSSProperties
  /** Invert drawn as a blend overlay instead of in the filter (see themeFrame). */
  invertViaBlendMode: boolean
  /** Each glaze layer's background image, or 'none' when that layer should not be mounted. */
  glaze: ThemeGlazeImages
  /** The colorize overlay, or null when it should not be mounted. */
  colorize: { hueDeg: number; opacity: number } | null
  /** Whether borders/shadows use their flipped variants (`.shadow-flip`): true for an inverted theme. */
  shadowFlip: boolean
  /** The opaque base background, as #rrggbb. */
  backgroundHex: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

const DEFAULT_BASE_PALETTE_COLOR = '#f9f6f4'
const DEFAULT_PALETTE_LIGHT = '#f5f3f2'
const DEFAULT_PALETTE_MID = '#e9e5e2'
const DEFAULT_PALETTE_DARK = '#ece8e4'
const DEFAULT_PALETTE_INPUT = '#ffffff'
const DEFAULT_PALETTE_SHADOW_LO = '#fcf9f677'
const DEFAULT_PALETTE_SHADOW_MID = '#fcf9f6bb'
const DEFAULT_PALETTE_SHADOW_HI = '#fcf9f6ee'

const GLAZE_RADIAL_CORNERS = ['top left', 'top right', 'bottom right', 'bottom left'] as const

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

type DerivedPaletteColors = {
  parchmentLightest: string
  parchmentLight: string
  parchmentMid: string
  parchmentDark: string
  parchmentInput: string
  shadowWhiteLo: string
  shadowWhiteMid: string
  shadowWhiteHi: string
}

function derivePaletteTokensFromBaseColor(baseColorCss: string): DerivedPaletteColors {
  const fallbackBase = parseCssColorToRgba(DEFAULT_BASE_PALETTE_COLOR) ?? { r: 249, g: 246, b: 244, a: 1 }
  const baseRgba = parseCssColorToRgba(baseColorCss) ?? fallbackBase
  const baseHsva = rgbaToHsva(baseRgba)
  const defaultBaseHsva = rgbaToHsva(fallbackBase)
  const safeBaseDefaultV = Math.max(0.0001, defaultBaseHsva.v)

  const defaultLightHsva = rgbaToHsva(parseCssColorToRgba(DEFAULT_PALETTE_LIGHT) ?? fallbackBase)
  const defaultMidHsva = rgbaToHsva(parseCssColorToRgba(DEFAULT_PALETTE_MID) ?? fallbackBase)
  const defaultDarkHsva = rgbaToHsva(parseCssColorToRgba(DEFAULT_PALETTE_DARK) ?? fallbackBase)
  const defaultInputHsva = rgbaToHsva(parseCssColorToRgba(DEFAULT_PALETTE_INPUT) ?? fallbackBase)

  const defaultShadowLo = parseCssColorToRgba(DEFAULT_PALETTE_SHADOW_LO) ?? { ...fallbackBase, a: 0.466 }
  const defaultShadowMid = parseCssColorToRgba(DEFAULT_PALETTE_SHADOW_MID) ?? { ...fallbackBase, a: 0.733 }
  const defaultShadowHi = parseCssColorToRgba(DEFAULT_PALETTE_SHADOW_HI) ?? { ...fallbackBase, a: 0.933 }
  const defaultShadowLoHsva = rgbaToHsva(defaultShadowLo)
  const defaultShadowMidHsva = rgbaToHsva(defaultShadowMid)
  const defaultShadowHiHsva = rgbaToHsva(defaultShadowHi)

  const withScaledValue = (valueScale: number, alpha = 1): string => {
    const nextHsva: HsvaColor = {
      h: baseHsva.h,
      s: baseHsva.s,
      v: clamp(baseHsva.v * valueScale, 0, 1),
      a: clamp(alpha, 0, 1),
    }
    return rgbaToCssColor(hsvaToRgba(nextHsva))
  }

  return {
    parchmentLightest: rgbaToCssColor({ ...baseRgba}),
    parchmentLight: withScaledValue(defaultLightHsva.v / safeBaseDefaultV, 1),
    parchmentMid: withScaledValue(defaultMidHsva.v / safeBaseDefaultV, 1),
    parchmentDark: withScaledValue(defaultDarkHsva.v / safeBaseDefaultV, 1),
    parchmentInput: withScaledValue(defaultInputHsva.v / safeBaseDefaultV, 1),
    shadowWhiteLo: withScaledValue(defaultShadowLoHsva.v / safeBaseDefaultV, defaultShadowLo.a),
    shadowWhiteMid: withScaledValue(defaultShadowMidHsva.v / safeBaseDefaultV, defaultShadowMid.a),
    shadowWhiteHi: withScaledValue(defaultShadowHiHsva.v / safeBaseDefaultV, defaultShadowHi.a),
  }
}

// Border/box-shadow tokens can reference other custom properties (e.g.
// `--btn-shadow-active` embeds `var(--color-shadow-white)`), and
// getComputedStyle().getPropertyValue() returns custom properties verbatim,
// unresolved. Inline every var() reference (recursively, since palette
// tokens can chain) so scaleAlphaInCssValue sees the literal colors.
function resolveCssVarValueDeep(rawValue: string, rootStyle: CSSStyleDeclaration, depth = 0): string {
  if (depth > 6) return rawValue
  let sawVar = false
  const resolved = rawValue.replace(/var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*([^)]+))?\)/g, (_match, name: string, fallback?: string) => {
    sawVar = true
    const resolvedValue = rootStyle.getPropertyValue(name).trim()
    return resolvedValue || (fallback ? fallback.trim() : '')
  })
  return sawVar ? resolveCssVarValueDeep(resolved, rootStyle, depth + 1) : resolved
}

function mulberry32(seed: number): () => number {
  let state = (seed >>> 0) + 0x6d2b79f5
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildLinearGlazeLayers(settings: GlazeSettings): string[] {
  if (settings.linearStackCount <= 0 || settings.linearOpacity <= 0) return []

  const rand = mulberry32(settings.linearSeed)
  const averageDistancePx = 28 + (rand() * 128)
  const lightRatio = 0.2 + (rand() * 0.65)
  const layers: string[] = []

  for (let layerIndex = 0; layerIndex < settings.linearStackCount; layerIndex += 1) {
    const angle = 45
    const phase = rand() * averageDistancePx
    const stops: string[] = []
    let cursor = 0

    for (let stripIndex = 0; stripIndex < 18; stripIndex += 1) {
      const distance = Math.max(12, averageDistancePx * (0.55 + (rand() * 1.05)))
      const litWidth = Math.max(3, distance * lightRatio * (0.7 + (rand() * 0.65)))
      const clearWidth = Math.max(4, distance - litWidth)
      const lightAlpha = clamp(settings.linearOpacity * (0.55 + (rand() * 0.9)), 0, GLAZE_LINEAR_OPACITY_MAX)
      const warmJitter = Math.round((rand() * 22) - 11)
      const red = clamp(245 + warmJitter, 0, 255)
      const green = clamp(245 + warmJitter, 0, 255)
      const blue = clamp(255 - Math.round(rand() * 18), 0, 255)
      const clearEnd = cursor + clearWidth
      const lightEnd = clearEnd + litWidth
      stops.push(`transparent ${Math.max(0, cursor - phase).toFixed(1)}px`)
      stops.push(`transparent ${Math.max(0, clearEnd - phase).toFixed(1)}px`)
      stops.push(`rgba(${red}, ${green}, ${blue}, ${lightAlpha.toFixed(3)}) ${Math.max(0, clearEnd - phase).toFixed(1)}px`)
      stops.push(`rgba(${red}, ${green}, ${blue}, ${lightAlpha.toFixed(3)}) ${Math.max(0, lightEnd - phase).toFixed(1)}px`)
      cursor += distance
    }

    layers.push(`repeating-linear-gradient(${angle}deg, ${stops.join(', ')})`)
  }

  return layers
}

function buildRadialGlazeLayers(settings: GlazeSettings): string[] {
  if (settings.radialCount <= 0 || settings.radialOpacity <= 0) return []

  const rand = mulberry32(settings.radialSeed)
  const layers: string[] = []

  const nextPrismaticRgb = (): [number, number, number] => {
    const channels: [number, number, number] = [0, 0, 0]
    const channelOrder: [number, number, number] = [0, 1, 2]

    for (let i = channelOrder.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1))
      const temp = channelOrder[i]
      channelOrder[i] = channelOrder[j]
      channelOrder[j] = temp
    }

    channels[channelOrder[0]] = 255
    channels[channelOrder[1]] = 127 + Math.round(rand() * 128)
    channels[channelOrder[2]] = 0
    return channels
  }

  for (let index = 0; index < settings.radialCount; index += 1) {
    const corner = GLAZE_RADIAL_CORNERS[index % GLAZE_RADIAL_CORNERS.length]
    const [innerR, innerG, innerB] = nextPrismaticRgb()
    const [midR, midG, midB] = nextPrismaticRgb()
    const [outerR, outerG, outerB] = nextPrismaticRgb()
    const radiusInner = Math.round(18 + (rand() * 14))
    const radiusMid = Math.round(46 + (rand() * 20))
    const radiusOuter = Math.round(74 + (rand() * 22))
    const alphaScale = clamp(settings.radialOpacity * (0.8 + (rand() * 0.7)), 0, GLAZE_RADIAL_OPACITY_MAX)
    const alphaInner = clamp(alphaScale * (1.0 + (rand() * 0.2)), 0, GLAZE_RADIAL_OPACITY_MAX)
    const alphaMid = clamp(alphaScale * (0.8 + (rand() * 0.2)), 0, GLAZE_RADIAL_OPACITY_MAX)
    const alphaOuter = clamp(alphaScale * (0.52 + (rand() * 0.2)), 0, GLAZE_RADIAL_OPACITY_MAX)
    layers.push(
      `radial-gradient(circle at ${corner}, rgba(${innerR}, ${innerG}, ${innerB}, ${alphaInner.toFixed(3)}) ${radiusInner}%, rgba(${midR}, ${midG}, ${midB}, ${alphaMid.toFixed(3)}) ${radiusMid}%, rgba(${outerR}, ${outerG}, ${outerB}, ${alphaOuter.toFixed(3)}) ${radiusOuter}%, transparent 100%)`,
    )
  }

  return layers
}

function buildGloomGlazeLayer(settings: GlazeSettings, useLightColor: boolean): string {
  if (settings.gloomOpacity <= 0) return 'none'
  const centerPct = clamp(settings.gloomPosition, -0.5, 1.5) * 100
  const edgeScale = clamp(settings.gloomShape, 0, 2)
  const edgeAlpha = clamp(settings.gloomOpacity * edgeScale, 0, GLAZE_GLOOM_OPACITY_MAX)
  const centerAlpha = clamp(settings.gloomOpacity, 0, GLAZE_GLOOM_OPACITY_MAX)
  const channel = useLightColor ? 255 : 0
  return `linear-gradient(180deg, rgba(${channel}, ${channel}, ${channel}, ${edgeAlpha.toFixed(3)}) -100%, rgba(${channel}, ${channel}, ${channel}, ${centerAlpha.toFixed(3)}) ${centerPct.toFixed(1)}%, rgba(${channel}, ${channel}, ${channel}, ${edgeAlpha.toFixed(3)}) 200%)`
}

function buildSheenGlazeLayer(settings: GlazeSettings, useDarkColor: boolean): string {
  if (settings.sheenOpacity <= 0) return 'none'
  const centerPct = clamp(settings.sheenPosition, -0.5, 1.5) * 100
  const edgeScale = clamp(settings.sheenShape, 0, 2)
  const edgeAlpha = clamp(settings.sheenOpacity * edgeScale, 0, GLAZE_SHEEN_OPACITY_MAX)
  const centerAlpha = clamp(settings.sheenOpacity, 0, GLAZE_SHEEN_OPACITY_MAX)
  const channel = useDarkColor ? 0 : 255
  return `linear-gradient(180deg, rgba(${channel}, ${channel}, ${channel}, ${edgeAlpha.toFixed(3)}) -100%, rgba(${channel}, ${channel}, ${channel}, ${centerAlpha.toFixed(3)}) ${centerPct.toFixed(1)}%, rgba(${channel}, ${channel}, ${channel}, ${edgeAlpha.toFixed(3)}) 200%)`
}


function textRamp(textBase: string): Record<string, string> {
  const rgba = parseCssColorToRgba(textBase) ?? { r: 0, g: 0, b: 0, a: 0.867 }
  const ramp: Record<string, string> = {}
  for (const step of [90, 80, 70, 60, 50, 40, 30, 20, 10]) {
    ramp[`--color-text-${step}`] = rgbaToCssColor({ ...rgba, a: clamp(rgba.a * (step / 100), 0, 1) })
  }
  return ramp
}

function embossSecondary(primary: string): string {
  const rgba = parseCssColorToRgba(primary) ?? { r: 255, g: 255, b: 255, a: 1 }
  return rgbaToCssColor(invertRgbaColor(rgba, 0.22))
}

/**
 * Everything a loadout decides about the look, for the elements named in the
 * module comment.
 *
 * rootVariables and shellVariables overlap (geometry, emboss, the text ramp):
 * that is how App.tsx has always set them, and an element between the two
 * that redefines one of them would otherwise change what the shell sees. The
 * surface colours are set on the shell only, so what sits outside it
 * (tooltips, overlays) keeps the stylesheet's defaults for them, as before.
 *
 * Invert is the theming primitive every dark preset uses, so it is treated as
 * binary (> 0.5). When it is the ONLY active effect it is drawn as a
 * `difference` blend overlay rather than a filter: a filter re-rasterizes the
 * whole subtree on every repaint underneath it, an overlay only changes how
 * an already-current frame composites. Whenever sepia, brightness, contrast
 * or saturate are also active, invert stays first in the filter chain, since
 * it does not commute with them and moving it would change every tuned dark
 * preset.
 */
export function themeFrame(loadout: ThemeLoadout, options: ThemeOptions): ThemeFrame {
  const colors = loadout.highlightColors
  const reduce = options.reduceVisualEffects
  const inverted = loadout.filterInvert > 0.5
  const palette = derivePaletteTokensFromBaseColor(colors.base)
  const lineNumberRgba = parseCssColorToRgba(colors.lineNumber) ?? { r: 0, g: 0, b: 0, a: 0.6 }

  const glaze: ThemeGlazeImages = reduce
    ? { linear: 'none', radial: 'none', gloom: 'none', sheen: 'none' }
    : {
        linear: buildLinearGlazeLayers(loadout.glaze).join(', ') || 'none',
        radial: buildRadialGlazeLayers(loadout.glaze).join(', ') || 'none',
        gloom: buildGloomGlazeLayer(loadout.glaze, inverted),
        sheen: buildSheenGlazeLayer(loadout.glaze, inverted),
      }

  const embossUiSecondary = embossSecondary(colors.textEmbossUi)
  const shared: Record<string, string> = {
    '--border-radius-regular': `${loadout.borderRadiusRegularPx}px`,
    '--border-radius-small': `${Math.max(0, loadout.borderRadiusRegularPx / 2)}px`,
    '--spacing-regular': `${loadout.spacingRegularPx}px`,
    '--text-shadow-emboss-main': colors.textEmbossUi,
    '--text-shadow-emboss-secondary': embossUiSecondary,
    '--text-shadow-emboss-ui-main': colors.textEmbossUi,
    '--text-shadow-emboss-ui-secondary': embossUiSecondary,
    '--text-shadow-emboss-edit-main': colors.textEmbossEdit,
    '--text-shadow-emboss-edit-secondary': embossSecondary(colors.textEmbossEdit),
    '--text-shadow-emboss-render-main': colors.textEmbossRender,
    '--text-shadow-emboss-render-secondary': embossSecondary(colors.textEmbossRender),
    '--color-text-base': colors.textBase,
    ...textRamp(colors.textBase),
  }

  const rootVariables: Record<string, string> = {
    ...shared,
    '--glaze-linear-background-image': glaze.linear,
    '--glaze-radial-background-image': glaze.radial,
    '--glaze-gloom-background-image': glaze.gloom,
    '--glaze-sheen-background-image': glaze.sheen,
    '--palette-parchment-lightest': palette.parchmentLightest,
    '--palette-parchment-light': palette.parchmentLight,
    '--palette-parchment-mid': palette.parchmentMid,
    '--palette-parchment-dark': palette.parchmentDark,
    '--palette-parchment-input': palette.parchmentInput,
    '--palette-shadow-white-lo': palette.shadowWhiteLo,
    '--palette-shadow-white-mid': palette.shadowWhiteMid,
    '--palette-shadow-white-hi': palette.shadowWhiteHi,
  }

  const shellVariables: Record<string, string> = {
    ...shared,
    '--color-bg-regular': colors.background,
    '--color-bg-leading': colors.topBackground,
    '--color-bg-trailing': colors.bottomBackground,
    '--color-grid-outline': colors.gridOutline,
    '--color-grid-bg': colors.grid,
    '--color-gutter-bg': colors.gutterBackground,
    '--color-immersive-scroll-thumb': colors.immersiveScrollThumb,
    '--color-review-line': colors.reviewLine,
    '--color-warning-line': colors.warningLine,
    // Opaque, with the chosen alpha applied as opacity on the whole number:
    // the glyph and its emboss shadow then fade as one unit.
    '--color-line-number': rgbaToCssColor({ ...lineNumberRgba, a: 1 }),
    '--line-number-opacity': String(lineNumberRgba.a),
    '--color-caret': colors.caret,
    '--color-selection': options.isPreviewMode ? colors.selectionRender : colors.selectionEdit,
    '--color-input-backdrop': colors.inputFields,
    '--canonical-scroll-track-bg': colors.inputFields,
    '--btn-bg-default': colors.appButtons,
    '--canonical-handle-bg': colors.appButtons,
    '--color-editor-edit-text': loadout.editorTextColors.editorEditText,
    '--color-editor-render-text': loadout.editorTextColors.editorRenderText,
    '--markdown-headline-color': colors.markdownHeadline,
    '--markdown-list-color': colors.markdownList,
    '--markdown-blockquote-color': colors.markdownBlockquote,
    '--markdown-code-color': colors.markdownCode,
    '--markdown-checked-color': colors.markdownChecked,
    '--markdown-unchecked-color': colors.markdownUnchecked,
  }

  const decorative: string[] = []
  if (!reduce) {
    if (loadout.filterSepia > 0) decorative.push(`sepia(${loadout.filterSepia})`)
    if (loadout.filterHueRotate !== 0) decorative.push(`hue-rotate(${loadout.filterHueRotate}deg)`)
    if (loadout.filterBrightness !== 1) decorative.push(`brightness(${loadout.filterBrightness})`)
    if (loadout.filterContrast !== 1) decorative.push(`contrast(${loadout.filterContrast})`)
    const saturate = saturatePosToValue(loadout.filterSaturate)
    if (Math.abs(saturate - 1) > 0.001) decorative.push(`saturate(${saturate.toFixed(4)})`)
  }
  const invertViaBlendMode = inverted && decorative.length === 0
  const filterParts = invertViaBlendMode
    ? decorative
    : (loadout.filterInvert > 0 ? [`invert(${loadout.filterInvert})`, ...decorative] : decorative)
  const wrapperStyle: CSSProperties = { backgroundColor: 'var(--palette-parchment-lightest)' }
  if (filterParts.length > 0) wrapperStyle.filter = filterParts.join(' ')

  const baseRgba = parseCssColorToRgba(palette.parchmentLightest) ?? { r: 249, g: 246, b: 244, a: 1 }

  return {
    rootVariables,
    shellVariables,
    wrapperStyle,
    invertViaBlendMode,
    glaze,
    colorize: loadout.filterColorize > 0 && !reduce
      ? { hueDeg: loadout.filterHueRotate, opacity: loadout.filterColorize }
      : null,
    shadowFlip: inverted,
    backgroundHex: rgbaToHex({ ...baseRgba, a: 1 }).slice(0, 7),
  }
}

/** The stylesheet's own value of each border/shadow token, read once per document root. */
const tokenBaseValues = new WeakMap<HTMLElement, Map<string, string>>()

/**
 * What a loadout sets on the document root (<html>) rather than on an app
 * element: geometry, and the border and shadow strength, which scale the
 * alpha of every border/shadow token in tokens.css (this package). Each token is
 * scaled from the stylesheet's ORIGINAL value, captured the first time it is
 * read, so repeated changes never compound.
 */
export function applyDocumentTheme(root: HTMLElement, loadout: Pick<ThemeLoadout, 'borderRadiusRegularPx' | 'spacingRegularPx' | 'borderAlphaPercent' | 'boxShadowAlphaPercent'>): void {
  root.style.setProperty('--border-radius-regular', `${loadout.borderRadiusRegularPx}px`)
  root.style.setProperty('--border-radius-small', `${Math.max(0, loadout.borderRadiusRegularPx / 2)}px`)
  root.style.setProperty('--spacing-regular', `${loadout.spacingRegularPx}px`)
  let bases = tokenBaseValues.get(root)
  if (!bases) {
    bases = new Map()
    tokenBaseValues.set(root, bases)
  }
  const computed = getComputedStyle(root)
  const scale = (tokens: readonly string[], factor: number) => {
    for (const token of tokens) {
      let base = bases!.get(token)
      if (base === undefined) {
        base = resolveCssVarValueDeep(computed.getPropertyValue(token).trim(), computed)
        bases!.set(token, base)
      }
      root.style.setProperty(token, scaleAlphaInCssValue(base, factor))
    }
  }
  scale(BORDER_ALPHA_TOKENS, loadout.borderAlphaPercent / 100)
  scale(BOX_SHADOW_ALPHA_TOKENS, loadout.boxShadowAlphaPercent / 100)
}
