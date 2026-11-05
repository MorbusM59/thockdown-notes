/**
 * The box bevel (Options > Colors > Box bevel): how the box outline grows
 * into the corners of each box and how it is shaded.
 *
 * Two images, both built once per change of setting (never per frame) and
 * repeated one per box by the browser:
 *
 * - the OUTLINE TILE (`boxOutlineTile`), a mask: alpha 1 on the outline and,
 *   as `shape` rises, on the box's corners. The box less a rounded rectangle
 *   that runs from the box's inside (`shape` 0: the outline alone, exactly as
 *   before) to the ellipse inscribed in it (`shape` 1: the corners filled),
 *   its edge blurred by `softness`. The grid line itself is never in it.
 * - the SHADING (`boxShadingImage`), black and white overlays drawn over the
 *   outline colour (and the beat pane's) inside that mask: `shading` is the
 *   alpha at full strength, black to the left of centre and white to the
 *   right; `contrast` fades one side of the box to nothing at +-0.5 and on
 *   to the opposite overlay at +-1; `direction` turns the axis that runs
 *   along, a full turn over 0..1 (0: top to bottom, 0.25: right to left).
 *
 * TILE GEOMETRY. A tile is one box, W by H, placed one pixel AFTER its grid
 * line (`mask-position`: the line's position + 1), so the box's own outline
 * pixels are column 0 and column W-2, row 0 and row H-2, and the next grid
 * line is column W-1 and row H-1, which nothing covers (the grid-line layer
 * draws it). Every pixel of the outline is covered by exactly one rect, so a
 * translucent outline colour is applied once everywhere.
 */

export interface BoxBevelSettings {
  /** -1 (black at full alpha) .. 0 (nothing) .. 1 (white at full alpha). */
  shading: number
  /** 0 (the outline alone) .. 1 (everything outside the inscribed ellipse). */
  shape: number
  /** 0 (a hard edge) .. 1 (blurred by a quarter of the box's shorter side). */
  softness: number
  /** -1 .. 1: 0 shades the box evenly; towards +1 the far side fades and then inverts, towards -1 the near side does. */
  contrast: number
  /** 0 .. 1, one full turn: 0 runs top to bottom, 0.25 right to left, 0.5 bottom to top. */
  direction: number
}

export const DEFAULT_BOX_BEVEL: BoxBevelSettings = { shading: 0, shape: 0, softness: 0, contrast: 0, direction: 0 }

const SOFTNESS_MAX_SHARE = 0.25

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

export function sanitizeBoxBevel(input: unknown, fallback: BoxBevelSettings = DEFAULT_BOX_BEVEL): BoxBevelSettings {
  const source = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof BoxBevelSettings, unknown>>
  return {
    shading: finite(source.shading, fallback.shading, -1, 1),
    shape: finite(source.shape, fallback.shape, 0, 1),
    softness: finite(source.softness, fallback.softness, 0, 1),
    contrast: finite(source.contrast, fallback.contrast, -1, 1),
    direction: finite(source.direction, fallback.direction, 0, 1),
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
 * The outline tile for a box of `width` by `height` CSS px (one grid cell,
 * line included). See the module comment for its geometry.
 */
export function boxOutlineTile(width: number, height: number, shape: number, softness: number): string {
  const w = Math.max(4, width)
  const h = Math.max(4, height)
  const boxW = w - 1
  const boxH = h - 1
  const innerW = w - 3
  const innerH = h - 3
  const outline =
    `<rect x='0' y='0' width='1' height='${n(boxH)}'/>` +
    `<rect x='${n(w - 2)}' y='0' width='1' height='${n(boxH)}'/>` +
    `<rect x='1' y='0' width='${n(innerW)}' height='1'/>` +
    `<rect x='1' y='${n(h - 2)}' width='${n(innerW)}' height='1'/>`
  const blur = softness * SOFTNESS_MAX_SHARE * Math.min(innerW, innerH)
  let corners = ''
  if (shape > 0 || blur > 0) {
    // The box less the rounded inside, the inside blurred by `softness`:
    // a luminance mask, white where the corners are filled.
    const filter = blur > 0
      ? `<filter id='b' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='${n(blur)}'/></filter>`
      : ''
    corners =
      `<defs>${filter}<mask id='m' maskUnits='userSpaceOnUse' x='0' y='0' width='${n(boxW)}' height='${n(boxH)}'>` +
      `<rect width='${n(boxW)}' height='${n(boxH)}' fill='#fff'/>` +
      `<rect x='1' y='1' width='${n(innerW)}' height='${n(innerH)}' rx='${n(shape * innerW / 2)}' ry='${n(shape * innerH / 2)}' fill='#000'${blur > 0 ? " filter='url(#b)'" : ''}/>` +
      `</mask></defs><rect width='${n(boxW)}' height='${n(boxH)}' mask='url(#m)'/>`
  }
  return svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='${n(w)}' height='${n(h)}'>${corners}${outline}</svg>`)
}

/** The shading's strength at the two ends of its axis, before `shading` scales it. */
export function shadingEnds(contrast: number): readonly [start: number, end: number] {
  return contrast >= 0 ? [1, 1 - 2 * contrast] : [1 + 2 * contrast, 1]
}

/**
 * The shading overlay as a background image (`none` when there is none),
 * sized in percentages so one image serves every box size.
 */
export function boxShadingImage(settings: BoxBevelSettings): string {
  if (settings.shading === 0) return 'none'
  const [a, b] = shadingEnds(settings.contrast).map((end) => end * settings.shading)
  // Stops along the axis: the two ends, and the point where the signed
  // strength crosses zero when it changes sign, so each overlay's alpha is
  // the positive (white) or negative (black) part of one straight line.
  const points: Array<[t: number, value: number]> = [[0, a]]
  if (a * b < 0) points.push([a / (a - b), 0])
  points.push([1, b])
  const stops = (sign: 1 | -1) => points
    .map(([t, value]) => `<stop offset='${n(t)}' stop-color='${sign > 0 ? '#fff' : '#000'}' stop-opacity='${n(Math.max(0, sign * value))}'/>`)
    .join('')
  const angle = settings.direction * 2 * Math.PI
  const x1 = 0.5 + 0.5 * Math.sin(angle)
  const y1 = 0.5 - 0.5 * Math.cos(angle)
  const axis = `x1='${n(x1)}' y1='${n(y1)}' x2='${n(1 - x1)}' y2='${n(1 - y1)}'`
  return svgUrl(
    `<svg xmlns='http://www.w3.org/2000/svg' width='100%' height='100%'>` +
    `<defs><linearGradient id='k' ${axis}>${stops(-1)}</linearGradient><linearGradient id='w' ${axis}>${stops(1)}</linearGradient></defs>` +
    `<rect width='100%' height='100%' fill='url(#k)'/><rect width='100%' height='100%' fill='url(#w)'/></svg>`,
  )
}
