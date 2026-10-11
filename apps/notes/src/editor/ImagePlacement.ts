import { imagesOnLine } from './MarkdownImageTransforms'
import { imageMarkdown } from '../shared/images'
import { imagesInLine, type ImageSyntaxSpan } from '../shared/imageSyntax'
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
// gesture does nothing, rather than reshaping a neighbour. Two miscounts can
// cancel out (an image in a code span the renderer did not draw, beside a
// reference image the count did not see), so the caller also compares the
// alt text with the drawn image's (sameAlt).

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
  /** The alt text as written, to check against the drawn image. */
  alt: string
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
    alt: text.slice(image.altFrom, image.altTo),
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

// Blocks whose first line an image cannot open without ending the block: a
// table row (the extra cell breaks the header), a code fence, a thematic
// break, an HTML block. Such a target is refused rather than broken.
const CLOSED_BLOCK = /^(?:\||`{3}|~{3}|<|(?:[-*_][ \t]*){3,}$)/

/** Where an image goes in the block whose first line is `targetLine0`, or null where it cannot go. */
function blockInsertPoint(text: string, targetLine0: number): number | null {
  const target = lineBounds(text, targetLine0)
  if (!target) return null
  const line = text.slice(target.from, target.to)
  const prefix = BLOCK_PREFIX.exec(line)?.[0].length ?? 0
  if (CLOSED_BLOCK.test(line.slice(prefix).replace(/\r$/, ''))) return null
  return target.from + prefix
}

/**
 * Moves the image to the start of the block whose first line is `targetLine0`,
 * aligned `align`, as two changes (a removal and an insertion, so nothing in
 * between is rewritten). Where it left behind only whitespace, that line goes
 * too. Moving within its own line only changes the alignment.
 */
export function moveImage(text: string, image: LocatedImage, targetLine0: number, align: ImageAlignment): ImageEdit[] | null {
  const target = lineBounds(text, targetLine0)
  if (!target) return null
  if (target.from === image.lineFrom) {
    const edit = reshapeImage(text, image, { ...image.layout, align })
    return edit && [edit]
  }
  const insertAt = blockInsertPoint(text, targetLine0)
  if (insertAt === null) return null
  const moved = imageWithLayout(text, image, { ...image.layout, align })

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

  const insertion = { from: insertAt, to: insertAt, insert: `${moved} ` }
  const removal = { from: removeFrom, to: removeTo, insert: '' }
  return insertAt <= removeFrom ? [insertion, removal] : [removal, insertion]
}

/** Inserts `markdown` (one or more images) at the start of the block whose first line is `targetLine0`; null where an image cannot open that block. */
export function insertAtBlockStart(text: string, targetLine0: number, markdown: string): ImageEdit | null {
  const at = blockInsertPoint(text, targetLine0)
  if (at === null) return null
  return { from: at, to: at, insert: `${markdown.replace(/\n/g, ' ')} ` }
}

/** Whether alt text as written and as drawn are the same, ignoring the inline markup the renderer resolves. */
export function sameAlt(written: string, drawn: string): boolean {
  const plain = (value: string) => value.replace(/[\\*_`~]/g, '').replace(/\s+/g, ' ').trim()
  return plain(written) === plain(drawn)
}

/**
 * A library image put at the caret (a card clicked in the image sidebar).
 * With the caret inside an image -- typically the empty `![]()` the toolbar's
 * image button leaves -- that image's destination becomes `id` and its alt
 * text `alt` (kept as written when `alt` is empty), and its title, which holds
 * the size and alignment, is untouched. Anywhere else a new reference replaces
 * the selection. The caret ends after the image.
 */
export function placeImageAt(
  text: string,
  selection: { start: number; end: number },
  id: string,
  alt: string,
  isInFencedCodeBlock: (offset: number) => boolean,
): { text: string; caret: number } {
  const image = selection.start === selection.end ? imageOrPlaceholderAt(text, selection.start) : null
  if (!image || isInFencedCodeBlock(image.from)) {
    const markdown = imageMarkdown(alt, id)
    return { text: text.slice(0, selection.start) + markdown + text.slice(selection.end), caret: selection.start + markdown.length }
  }
  const cleanAlt = alt.replace(/[[\]\n]/g, ' ').trim()
  const newAlt = cleanAlt || text.slice(image.altFrom, image.altTo)
  const next = text.slice(0, image.altFrom) + newAlt + text.slice(image.altTo, image.destinationFrom) + id + text.slice(image.destinationTo)
  return { text: next, caret: image.to + next.length - text.length }
}

// An image, or the toolbar's empty `![]()`, which the image keys do not count.
function imageOrPlaceholderAt(text: string, offset: number): ImageSyntaxSpan | null {
  const lineFrom = text.lastIndexOf('\n', offset - 1) + 1
  const lineEnd = text.indexOf('\n', offset)
  const line = text.slice(lineFrom, lineEnd === -1 ? text.length : lineEnd)
  const span = imagesInLine(line).find((each) => offset > lineFrom + each.from && offset <= lineFrom + each.to)
  if (!span) return null
  return {
    ...span,
    from: lineFrom + span.from,
    to: lineFrom + span.to,
    altFrom: lineFrom + span.altFrom,
    altTo: lineFrom + span.altTo,
    destinationFrom: lineFrom + span.destinationFrom,
    destinationTo: lineFrom + span.destinationTo,
  }
}
