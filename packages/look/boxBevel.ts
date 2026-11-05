/**
 * The box bevel (Options > Colors > Box bevel): how the box outline grows
 * into the corners of each box and how it is shaded.
 *
 * Two images, both built once per change of setting (never per frame) and
 * repeated one per box by the browser:
 *
 * - the OUTLINE TILE, a mask: alpha 1 on the outline and on the CORNER
 *   REGION, the whole box less a rounded rectangle of the box's size whose
 *   corners run from square (`shape` 0: no region, the outline alone,
 *   exactly as before) to the inscribed ellipse (`shape` 1), its curve
 *   blurred by `softness`. The grid line itself is never in it.
 * - the SHADING, black and white overlays drawn over the outline colour
 *   (and the beat pane's) in the corner region only, so the outline is
 *   shaded only where the corners reach it: `shading` is the
 *   alpha at full strength, black to the left of centre and white to the
 *   right (before the scene's invert filter, see `onScreenBoxBevel`); `contrast` fades the far side of the box to nothing at 0.5 and on
 *   to the opposite overlay at 1; `direction` turns the axis that runs
 *   along, in degrees (0: top to bottom, 90: right to left).
 *
 * TILE GEOMETRY. A tile is one box, W by H, placed one pixel AFTER its grid
 * line (`mask-position`: the line's position + 1), so the box's own outline
 * pixels are column 0 and column W-2, row 0 and row H-2, and the next grid
 * line is column W-1 and row H-1, which nothing covers (the grid-line layer
 * draws it). Every pixel of the outline is covered by exactly one rect, so a
 * translucent outline colour is applied once everywhere.
 */

export interface BoxBevelSettings {
  /** -1 (black at full alpha) .. 0 (nothing) .. 1 (white at full alpha), as drawn: a layout that inverts the scene shows it the other way round, which `onScreenBoxBevel` corrects for. */
  shading: number
  /** 0 (the outline alone) .. 1 (everything outside the inscribed ellipse). */
  shape: number
  /** 0 (a hard edge) .. 1 (the corners' curve blurred by half its radius). */
  softness: number
  /** 0 .. 1: 0 shades the box evenly; towards 1 the far side fades and then inverts (the near side is the far side at `direction` + 180). */
  contrast: number
  /** Degrees, 0 .. 360: 0 runs top to bottom, 90 right to left, 180 bottom to top. */
  direction: number
}

export const DEFAULT_BOX_BEVEL: BoxBevelSettings = { shading: 0, shape: 0, softness: 0, contrast: 0, direction: 0 }

/**
 * The black overlay is drawn at half the alpha the slider names. Black is
 * what reads as DARKENING in a light layout and, under the invert filter, as
 * BRIGHTENING in a dark one (`onScreenBoxBevel`), which are the two sides
 * that read twice as strong as the other on screen; halving the one drawn
 * colour halves both, by construction, wherever the contrast puts it.
 */
const BLACK_OVERLAY_GAIN = 0.5

const SOFTNESS_MAX_SHARE = 0.25 // x2 x the corner radius: half of it

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

export function sanitizeBoxBevel(input: unknown, fallback: BoxBevelSettings = DEFAULT_BOX_BEVEL): BoxBevelSettings {
  const source = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof BoxBevelSettings, unknown>>
  return {
    shading: finite(source.shading, fallback.shading, -1, 1),
    shape: finite(source.shape, fallback.shape, 0, 1),
    softness: finite(source.softness, fallback.softness, 0, 1),
    contrast: finite(source.contrast, fallback.contrast, 0, 1),
    direction: finite(source.direction, fallback.direction, 0, 360),
  }
}

function svgUrl(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/** Fixed to three decimals: enough below a pixel, and a stable string for the browser's image cache. */
function n(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

/**
 * The CORNER REGION's luminance mask, `#m` (white where the bevel applies),
 * or '' when it is empty: the whole box, outline included, less a rounded
 * rectangle of the same size whose corner radii run from 0 (`shape` 0: the
 * box itself, so nothing) to half the box (`shape` 1: the inscribed
 * ellipse). The centre of every edge is inside the rounded rectangle at any
 * shape, so it is never affected. Softness blurs the curved corners only,
 * by up to half the corner radius: the rounded rectangle is unioned with two
 * bands running past the box by the blur's reach, so blurring cannot pull
 * the straight parts in from the edges, and at shape 0 there is no blur.
 */
function cornerMask(boxW: number, boxH: number, shape: number, softness: number): string {
  if (shape <= 0) return ''
  const rx = shape * boxW / 2
  const ry = shape * boxH / 2
  const blur = softness * SOFTNESS_MAX_SHARE * 2 * Math.min(rx, ry)
  const reach = 3 * blur + 1
  const filter = blur > 0
    ? `<filter id='b' filterUnits='userSpaceOnUse' x='${n(-2 * reach)}' y='${n(-2 * reach)}' width='${n(boxW + 4 * reach)}' height='${n(boxH + 4 * reach)}'><feGaussianBlur stdDeviation='${n(blur)}'/></filter>`
    : ''
  return (
    filter +
    `<mask id='m' maskUnits='userSpaceOnUse' x='0' y='0' width='${n(boxW)}' height='${n(boxH)}'>` +
    `<rect width='${n(boxW)}' height='${n(boxH)}' fill='#fff'/>` +
    `<g fill='#000'${blur > 0 ? " filter='url(#b)'" : ''}>` +
    `<rect width='${n(boxW)}' height='${n(boxH)}' rx='${n(rx)}' ry='${n(ry)}'/>` +
    `<rect x='${n(rx)}' y='${n(-reach)}' width='${n(Math.max(0, boxW - 2 * rx))}' height='${n(boxH + 2 * reach)}'/>` +
    `<rect x='${n(-reach)}' y='${n(ry)}' width='${n(boxW + 2 * reach)}' height='${n(Math.max(0, boxH - 2 * ry))}'/>` +
    `</g></mask>`
  )
}

/** The shading's strength at the two ends of its axis, before `shading` scales it. */
export function shadingEnds(contrast: number): readonly [start: number, end: number] {
  return [1, 1 - 2 * contrast]
}

export interface BoxBevelImages {
  /** The mask: the outline, plus the corner region. */
  tile: string
  /** The shading overlay, inside the corner region only (`none` when there is none). */
  shading: string
}

/**
 * The bevel's two images for a box of `width` by `height` CSS px (one grid
 * cell, line included). See the module comment for the tile's geometry.
 */
export function boxBevelImages(width: number, height: number, settings: BoxBevelSettings): BoxBevelImages {
  const w = Math.max(4, width)
  const h = Math.max(4, height)
  const boxW = w - 1
  const boxH = h - 1
  const innerW = w - 3
  const outline =
    `<rect x='0' y='0' width='1' height='${n(boxH)}'/>` +
    `<rect x='${n(w - 2)}' y='0' width='1' height='${n(boxH)}'/>` +
    `<rect x='1' y='0' width='${n(innerW)}' height='1'/>` +
    `<rect x='1' y='${n(h - 2)}' width='${n(innerW)}' height='1'/>`
  const mask = cornerMask(boxW, boxH, settings.shape, settings.softness)
  const region = `<rect width='${n(boxW)}' height='${n(boxH)}' mask='url(#m)'`
  const svg = (body: string) => svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='${n(w)}' height='${n(h)}'>${body}</svg>`)
  const tile = svg(mask ? `<defs>${mask}</defs>${region}/>${outline}` : outline)
  if (!mask || settings.shading === 0) return { tile, shading: 'none' }

  const [a, b] = shadingEnds(settings.contrast).map((end) => end * settings.shading)
  // Stops along the axis: the two ends, and the point where the signed
  // strength crosses zero when it changes sign, so each overlay's alpha is
  // the positive (white) or negative (black) part of one straight line.
  const points: Array<[t: number, value: number]> = [[0, a]]
  if (a * b < 0) points.push([a / (a - b), 0])
  points.push([1, b])
  const stops = (sign: 1 | -1) => points
    .map(([t, value]) => `<stop offset='${n(t)}' stop-color='${sign > 0 ? '#fff' : '#000'}' stop-opacity='${n(Math.max(0, sign * value) * (sign > 0 ? 1 : BLACK_OVERLAY_GAIN))}'/>`)
    .join('')
  const angle = settings.direction * Math.PI / 180
  const x1 = 0.5 + 0.5 * Math.sin(angle)
  const y1 = 0.5 - 0.5 * Math.cos(angle)
  const axis = `x1='${n(x1)}' y1='${n(y1)}' x2='${n(1 - x1)}' y2='${n(1 - y1)}'`
  const shading = svg(
    `<defs>${mask}<linearGradient id='k' ${axis}>${stops(-1)}</linearGradient><linearGradient id='w' ${axis}>${stops(1)}</linearGradient></defs>` +
    `${region} fill='url(#k)'/>${region} fill='url(#w)'/>`,
  )
  return { tile, shading }
}

/**
 * The setting as it must be DRAWN for it to read as set: a layout whose
 * scene filter inverts (`filterInvert` past half, every dark layout) shows
 * white as dark, so its shading is drawn with the sign turned. The slider
 * then brightens to the right and darkens to the left in every layout.
 */
export function onScreenBoxBevel(settings: BoxBevelSettings, filterInvert: number): BoxBevelSettings {
  return filterInvert >= 0.5 && settings.shading !== 0 ? { ...settings, shading: -settings.shading } : settings
}

/** The bevel the factory's dark layouts start from (packages/look/presets.ts). */
export const DARK_PRESET_BOX_BEVEL: BoxBevelSettings = { ...DEFAULT_BOX_BEVEL, shading: 0.08, shape: 0.2 }
