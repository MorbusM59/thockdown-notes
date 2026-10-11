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
//
// A title is read as layout only when EVERY token parses. One that does not
// look like layout at all ("Sunset over the hills") is an ordinary tooltip.
// One made only of layout-shaped tokens where some do not parse ("12emm
// right") is MALFORMED: the preview treats it as a tooltip, and the edit view
// marks it, so a typo shows rather than silently doing nothing.

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
}

export type ImageTitle =
  | { kind: 'layout'; layout: ImageLayout }
  | { kind: 'tooltip'; text: string }
  | { kind: 'malformed'; text: string }

export const EMPTY_IMAGE_LAYOUT: ImageLayout = Object.freeze({ id: null, width: null, height: null, align: null })

const NUMBER = '(\\d+(?:\\.\\d+)?)'
const WIDTH_TOKEN = new RegExp(`^${NUMBER}(em|px|%)$`, 'i')
const HEIGHT_TOKEN = new RegExp(`^x${NUMBER}(em|px)$`, 'i')
const BOX_TOKEN = new RegExp(`^${NUMBER}(em|px|%)x${NUMBER}(em|px)$`, 'i')
const ALIGN_TOKEN = /^(left|right|center)$/i
// `;` is excluded because CommonMark decodes `&NAME;` as a character entity
// wherever the id later appears in a link destination.
const ID_TOKEN = /^&([^\s;()"'&]+)$/
// What a token that was MEANT as layout starts with. Used only to tell a
// malformed layout title from an ordinary tooltip.
const LAYOUT_SHAPED = /^(&|x?\d)|^(left|right|center)$/i

function lengthOf(value: string, unit: string): ImageLength | null {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  return { value: number, unit: unit.toLowerCase() as ImageLengthUnit }
}

export function parseImageTitle(title: string | null | undefined): ImageTitle {
  const text = title ?? ''
  const tokens = text.split(/\s+/).filter((token) => token.length > 0)
  if (tokens.length === 0) return { kind: 'layout', layout: EMPTY_IMAGE_LAYOUT }

  const layout: ImageLayout = { id: null, width: null, height: null, align: null }
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
  const id = ID_TOKEN.exec(token)
  if (id) {
    if (layout.id !== null) return false
    layout.id = id[1]
    return true
  }
  const align = ALIGN_TOKEN.exec(token)
  if (align) {
    if (layout.align !== null) return false
    layout.align = align[1].toLowerCase() as ImageAlignment
    return true
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
  return tokens.join(' ')
}

function cssLength(length: ImageLength): string {
  return `${length.value}${length.unit}`
}

/**
 * The inline styles that draw `layout`: the frame takes the width, the image
 * the height. With both, the image fills the frame's width and keeps its
 * aspect ratio inside the box (`object-fit: contain`), so it is never
 * stretched. Alignment is a class, not a style (see markdown.css).
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
    else image.objectFit = 'contain'
  }
  return { frame, image }
}
