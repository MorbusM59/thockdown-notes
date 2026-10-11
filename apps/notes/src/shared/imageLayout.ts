// HOW AN IMAGE IN A NOTE IS SIZED, PLACED AND NAMED, read from and written
// to the image's Markdown TITLE: `![Logo](logo.png "&LOGO 12em right")`.
//
// The title is the one part of a Markdown image every other renderer
// accepts and none of them draws inline (it becomes a tooltip), so a note
// that carries layout this way is still a valid, readable document anywhere
// else. The grammar is space-separated tokens, in any order, at most one of
// each kind:
//
//   &NAME        the image's id (stored images, docs/images plan section 3.2)
//   12em         width; the unit is required: em, px, or % of the text column
//   x8em         height only, em or px (a % height has no height to refer to)
//   12emx8em     both: the image keeps its aspect ratio inside that box
//   left, right  floats in its paragraph, text flowing round it
//   center       a block of its own, centred
//   inset(...)   a crop, in CSS's shorthand order and percent of the image's
//                own size: `inset(10%)` all round, `inset(10% 0)` top and
//                bottom, `inset(10% 0 5%)`, `inset(10% 0 5% 2%)` (top, right,
//                bottom, left). Written after the alignment; its spaces stay
//                inside the parentheses, so it is one token.
//
// A title is read as layout only when EVERY token parses. One that does not
// look like layout at all ("Sunset over the hills") is an ordinary tooltip.
// One made only of layout-shaped tokens where some do not parse ("12emm
// right") is MALFORMED: the preview treats it as a tooltip, and the edit view
// marks it, so a typo shows rather than silently doing nothing.

import { normalizeImageId } from './images'

export type ImageLengthUnit = 'em' | 'px' | '%'

export interface ImageLength {
  value: number
  unit: ImageLengthUnit
}

export type ImageAlignment = 'left' | 'right' | 'center'

export interface ImageLayout {
  id: string | null
  width: ImageLength | null
  /** Never a percentage. */
  height: ImageLength | null
  align: ImageAlignment | null
  /** The crop, null when there is none. */
  inset: ImageInset | null
}

/** Percentages of the image's own width (left, right) and height (top, bottom). */
export interface ImageInset {
  top: number
  right: number
  bottom: number
  left: number
}

export type ImageTitle =
  | { kind: 'layout'; layout: ImageLayout }
  | { kind: 'tooltip'; text: string }
  | { kind: 'malformed'; text: string }

export const EMPTY_IMAGE_LAYOUT: ImageLayout = Object.freeze({ id: null, width: null, height: null, align: null, inset: null })

const NUMBER = '(\\d+(?:\\.\\d+)?)'
const WIDTH_TOKEN = new RegExp(`^${NUMBER}(em|px|%)$`, 'i')
const HEIGHT_TOKEN = new RegExp(`^x${NUMBER}(em|px)$`, 'i')
const BOX_TOKEN = new RegExp(`^${NUMBER}(em|px|%)x${NUMBER}(em|px)$`, 'i')
const ALIGN_TOKEN = /^(left|right|center)$/i
const INSET_TOKEN = /^inset\(([^)]*)\)$/i
const INSET_VALUE = /^(\d+(?:\.\d+)?)%$|^0$/
// What a token that was MEANT as layout starts with. Used only to tell a
// malformed layout title from an ordinary tooltip.
const LAYOUT_SHAPED = /^(&|x?\d|inset\()|^(left|right|center)$/i
// A title's tokens: an `inset(...)` group with its spaces, or a run without any.
const TITLE_TOKEN = /inset\([^)]*\)|\S+/gi

function lengthOf(value: string, unit: string): ImageLength | null {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  return { value: number, unit: unit.toLowerCase() as ImageLengthUnit }
}

export function parseImageTitle(title: string | null | undefined): ImageTitle {
  const text = title ?? ''
  const tokens = text.match(TITLE_TOKEN) ?? []
  if (tokens.length === 0) return { kind: 'layout', layout: EMPTY_IMAGE_LAYOUT }

  const layout: ImageLayout = { id: null, width: null, height: null, align: null, inset: null }
  let parsedAll = true
  for (const token of tokens) {
    if (!applyToken(layout, token)) {
      parsedAll = false
      break
    }
  }
  if (parsedAll) return { kind: 'layout', layout }
  return tokens.every((token) => LAYOUT_SHAPED.test(token))
    ? { kind: 'malformed', text }
    : { kind: 'tooltip', text }
}

/** Adds one token to `layout`; false when it does not parse or its kind is already set. */
function applyToken(layout: ImageLayout, token: string): boolean {
  // The id's rule is shared/images.ts's, so a name given here is one the
  // store accepts; it is kept normalized (`&logo` reads as `&LOGO`).
  const id = token.startsWith('&') ? normalizeImageId(token) : null
  if (id) {
    if (layout.id !== null) return false
    layout.id = id.slice(1)
    return true
  }
  const align = ALIGN_TOKEN.exec(token)
  if (align) {
    if (layout.align !== null) return false
    layout.align = align[1].toLowerCase() as ImageAlignment
    return true
  }
  const inset = INSET_TOKEN.exec(token)
  if (inset) {
    if (layout.inset !== null) return false
    layout.inset = insetOf(inset[1])
    return layout.inset !== null
  }
  if (layout.width !== null || layout.height !== null) return false
  const box = BOX_TOKEN.exec(token)
  if (box) {
    layout.width = lengthOf(box[1], box[2])
    layout.height = lengthOf(box[3], box[4])
    return layout.width !== null && layout.height !== null
  }
  const width = WIDTH_TOKEN.exec(token)
  if (width) {
    layout.width = lengthOf(width[1], width[2])
    return layout.width !== null
  }
  const height = HEIGHT_TOKEN.exec(token)
  if (height) {
    layout.height = lengthOf(height[1], height[2])
    return layout.height !== null
  }
  return false
}

/** CSS's one-to-four-value shorthand, each a percentage (or a bare 0); null when it does not parse or crops everything away. */
function insetOf(body: string): ImageInset | null {
  const parts = body.trim().split(/\s+/)
  if (parts.length < 1 || parts.length > 4) return null
  const values: number[] = []
  for (const part of parts) {
    const match = INSET_VALUE.exec(part)
    if (!match) return null
    values.push(match[1] === undefined ? 0 : Number(match[1]))
  }
  const [top, right = top, bottom = top, left = right] = values
  if (top + bottom >= 100 || left + right >= 100) return null
  return { top, right, bottom, left }
}

function formatInsetValue(value: number): string {
  const rounded = Number(value.toFixed(1))
  return rounded === 0 ? '0' : `${rounded}%`
}

/** The shortest shorthand for `inset`, or '' when it crops nothing. */
export function formatImageInset(inset: ImageInset | null): string {
  if (!inset) return ''
  const [top, right, bottom, left] = [inset.top, inset.right, inset.bottom, inset.left].map(formatInsetValue)
  if ([top, right, bottom, left].every((value) => value === '0')) return ''
  const values = left !== right ? [top, right, bottom, left]
    : bottom !== top ? [top, right, bottom]
    : right !== top ? [top, right]
    : [top]
  return `inset(${values.join(' ')})`
}

function formatLength(length: ImageLength): string {
  return `${Number(length.value.toFixed(2))}${length.unit}`
}

/** The canonical title for `layout`, in a fixed token order; '' when it says nothing. */
export function formatImageLayout(layout: ImageLayout): string {
  const tokens: string[] = []
  if (layout.id) tokens.push(`&${layout.id}`)
  if (layout.width && layout.height) tokens.push(`${formatLength(layout.width)}x${formatLength(layout.height)}`)
  else if (layout.width) tokens.push(formatLength(layout.width))
  else if (layout.height) tokens.push(`x${formatLength(layout.height)}`)
  if (layout.align) tokens.push(layout.align)
  const inset = formatImageInset(layout.inset)
  if (inset) tokens.push(inset)
  return tokens.join(' ')
}

function cssLength(length: ImageLength): string {
  return `${length.value}${length.unit}`
}

/** `inset` as CSS's `inset()` with all four values, for `object-view-box`. */
export function cssInset(inset: ImageInset): string {
  return `inset(${inset.top}% ${inset.right}% ${inset.bottom}% ${inset.left}%)`
}

/**
 * The inline styles that draw `layout`: the frame takes the width, the image
 * the height. With both, the image is drawn at exactly that size, stretched
 * if the two do not match its own proportions: giving both is how a reader
 * asks for that (Ctrl+Shift-drag in the render view). Alignment is a class, not a style (see markdown.css).
 */
export function imageLayoutStyles(layout: ImageLayout): {
  frame: Record<string, string>
  image: Record<string, string>
} {
  const frame: Record<string, string> = {}
  const image: Record<string, string> = {}
  if (layout.width) {
    frame.width = cssLength(layout.width)
    image.width = '100%'
  }
  if (layout.height) {
    image.height = cssLength(layout.height)
    if (!layout.width) image.width = 'auto'
  }
  // The crop: the image draws only that part of itself, and its own size and
  // proportions become that part's, so every size above applies to the crop.
  if (layout.inset) image.objectViewBox = cssInset(layout.inset)
  return { frame, image }
}
