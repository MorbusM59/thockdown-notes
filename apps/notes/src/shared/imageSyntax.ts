// THE ONE READER OF AN INLINE IMAGE'S MARKDOWN, `![alt](destination "title")`,
// shared by everything that finds images in a note's text without a full
// parse: the edit view's image keys and their caret checks
// (editor/MarkdownImageTransforms.ts), the image button's store/restore
// rewrite (editor/ImageStorageRewrite.ts), placing a library image
// (editor/ImagePlacement.ts) and the sidebar's list of a note's images
// (shared/images.ts's imageUsesIn). One reader, so they cannot disagree about
// where an image ends.
//
// What it accepts, following CommonMark where this app's notes go: alt text
// without brackets or line breaks; a destination either in angle brackets or
// bare, where a bare one may hold parentheses as long as they balance
// (`Foo_(bar).png`, as many Wikipedia addresses are); and an optional title
// in double or single quotes, after at least one space. Anything else is not
// an image to this reader.

export interface ImageSyntaxSpan {
  /** `!` */
  from: number
  /** One past `)`. */
  to: number
  altFrom: number
  altTo: number
  /** The destination as written, angle brackets included; empty for `![]()`. */
  destinationFrom: number
  destinationTo: number
  /** The title's text, inside its quotes; null when the image has no title. */
  titleFrom: number | null
  titleTo: number | null
}

const isBlank = (char: string | undefined) => char === ' ' || char === '\t'

/** The image starting at `start` (its `!`) in `line`, or null. */
function imageAt(line: string, start: number): ImageSyntaxSpan | null {
  const altFrom = start + 2
  const altTo = line.indexOf(']', altFrom)
  if (altTo === -1 || line[altTo + 1] !== '(') return null
  const altText = line.slice(altFrom, altTo)
  if (altText.includes('[') || altText.includes('\n')) return null
  let at = altTo + 2
  while (isBlank(line[at])) at += 1
  const destinationFrom = at
  if (line[at] === '<') {
    const close = line.indexOf('>', at + 1)
    if (close === -1 || /[<\n]/.test(line.slice(at + 1, close))) return null
    at = close + 1
  } else {
    let depth = 0
    while (at < line.length) {
      const char = line[at]
      if (char === '\n' || isBlank(char)) break
      if (char === '(') depth += 1
      else if (char === ')') {
        if (depth === 0) break
        depth -= 1
      }
      at += 1
    }
    if (depth !== 0) return null
  }
  const destinationTo = at
  let titleFrom: number | null = null
  let titleTo: number | null = null
  let blanks = 0
  while (isBlank(line[at])) { at += 1; blanks += 1 }
  const quote = line[at]
  if (blanks > 0 && destinationTo > destinationFrom && (quote === '"' || quote === "'")) {
    const close = line.indexOf(quote, at + 1)
    if (close === -1 || line.slice(at + 1, close).includes('\n')) return null
    titleFrom = at + 1
    titleTo = close
    at = close + 1
    while (isBlank(line[at])) at += 1
  }
  if (line[at] !== ')') return null
  return { from: start, to: at + 1, altFrom, altTo, destinationFrom, destinationTo, titleFrom, titleTo }
}

/** Every image in `line` (one line of text, or any text without line breaks inside an image), in order. */
export function imagesInLine(line: string): ImageSyntaxSpan[] {
  const spans: ImageSyntaxSpan[] = []
  let at = line.indexOf('![')
  while (at !== -1) {
    const span = imageAt(line, at)
    if (span) spans.push(span)
    at = line.indexOf('![', span ? span.to : at + 2)
  }
  return spans
}
