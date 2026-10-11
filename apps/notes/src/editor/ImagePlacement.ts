import { imagesOnLine } from './MarkdownImageTransforms'
import { formatImageLayout, parseImageTitle, type ImageAlignment, type ImageLayout } from '../shared/imageLayout'

// WHERE AN IMAGE IN THE RENDER VIEW IS IN THE TEXT, and the two edits the
// render view's image gestures make (useImagePreviewGestures): reshaping an
// image's layout, and moving it to the start of another block.
//
// The render view knows an image only by the source line its element was
// parsed from (`data-source-line`, set by createPreviewSourceAnchorRehypePlugin)
// and its position among the images drawn from that line. That is matched to
// the text by counting the images the line holds in the plain shape the keys
// understand (imagesOnLine); when the two counts disagree -- a line holding an
// image written some other way -- the image is not addressable and the
// gesture does nothing, rather than reshaping a neighbour.

export interface ImageEdit {
  from: number
  to: number
  insert: string
}

export interface LocatedImage {
  from: number
  to: number
  /** The text of the line the image is on. */
  lineFrom: number
  lineTo: number
  titleFrom: number | null
  titleTo: number | null
  destinationTo: number
  layout: ImageLayout
}

function lineBounds(text: string, line0: number): { from: number; to: number } | null {
  let from = 0
  for (let line = 0; line < line0; line += 1) {
    const next = text.indexOf('\n', from)
    if (next === -1) return null
    from = next + 1
  }
  const end = text.indexOf('\n', from)
  return { from, to: end === -1 ? text.length : end }
}

/**
 * The `ordinal`-th image (0-based) of `drawnOnLine` on source line `line0`
 * (0-based), when the line's text holds exactly that many plain images and
 * that one's title is layout (an ordinary tooltip has no room for any).
 */
export function locateImage(text: string, line0: number, ordinal: number, drawnOnLine: number): LocatedImage | null {
  const bounds = lineBounds(text, line0)
  if (!bounds) return null
  const images = imagesOnLine(text, bounds.from).filter((image) => image.from >= bounds.from && image.to <= bounds.to)
  if (images.length !== drawnOnLine || ordinal >= images.length) return null
  const image = images[ordinal]
  const parsed = parseImageTitle(image.title)
  if (parsed.kind !== 'layout') return null
  return {
    from: image.from,
    to: image.to,
    lineFrom: bounds.from,
    lineTo: bounds.to,
    titleFrom: image.titleFrom,
    titleTo: image.titleTo,
    destinationTo: image.destinationTo,
    layout: parsed.layout,
  }
}

function imageWithLayout(text: string, image: LocatedImage, layout: ImageLayout): string {
  const formatted = formatImageLayout(layout)
  return `${text.slice(image.from, image.destinationTo)}${formatted ? ` "${formatted}"` : ''})`
}

/** Rewrites the image's title to `layout`. */
export function reshapeImage(text: string, image: LocatedImage, layout: ImageLayout): ImageEdit | null {
  const insert = imageWithLayout(text, image, layout)
  if (insert === text.slice(image.from, image.to)) return null
  return { from: image.from, to: image.to, insert }
}

// What a line may start with before its text: indentation, quote markers, a
// list marker. A moved image goes after these, so it lands inside the block
// rather than breaking its syntax.
const BLOCK_PREFIX = /^[ \t]*(?:>[ \t]?)*(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?(?:#{1,6}[ \t]+)?/

/**
 * Moves the image to the start of the block whose first line is `targetLine0`,
 * aligned `align`, as one edit. Where it left behind only whitespace, that
 * line goes too. Moving within its own line only changes the alignment.
 */
export function moveImage(text: string, image: LocatedImage, targetLine0: number, align: ImageAlignment): ImageEdit | null {
  const target = lineBounds(text, targetLine0)
  if (!target) return null
  const moved = imageWithLayout(text, image, { ...image.layout, align })
  if (target.from === image.lineFrom) return reshapeImage(text, image, { ...image.layout, align })

  // What removing the image does to its own line.
  const before = text.slice(image.lineFrom, image.from)
  const after = text.slice(image.to, image.lineTo)
  let removeFrom = image.from
  let removeTo = image.to
  if ((before + after).trim().length === 0) {
    // The line held only the image: take the line and its newline.
    removeFrom = image.lineFrom
    removeTo = Math.min(text.length, image.lineTo + 1)
  } else if (after.startsWith(' ')) {
    removeTo += 1
  } else if (before.endsWith(' ')) {
    removeFrom -= 1
  }

  const insertAt = target.from + (BLOCK_PREFIX.exec(text.slice(target.from, target.to))?.[0].length ?? 0)
  const insert = `${moved} `
  if (insertAt <= removeFrom) {
    return { from: insertAt, to: removeTo, insert: insert + text.slice(insertAt, removeFrom) }
  }
  return { from: removeFrom, to: insertAt, insert: text.slice(removeTo, insertAt) + insert }
}

/** Inserts `markdown` (one or more images) at the start of the block whose first line is `targetLine0`. */
export function insertAtBlockStart(text: string, targetLine0: number, markdown: string): ImageEdit | null {
  const target = lineBounds(text, targetLine0)
  if (!target) return null
  const at = target.from + (BLOCK_PREFIX.exec(text.slice(target.from, target.to))?.[0].length ?? 0)
  return { from: at, to: at, insert: `${markdown.replace(/\n/g, ' ')} ` }
}
