/**
 * Characters the scene's FONT draws wider than one box, dropped before they
 * are drawn. `shared/singleCellText.ts` already removes everything Unicode
 * says is not one cell wide, and names the case it deliberately leaves: a
 * character that is one cell by Unicode but missing from the chosen font, so
 * the browser borrows it from a font of another width (a ★ or ✿ in a song
 * tag). In the editor that is a property of the font; in the scene every
 * character sits alone in its own box, so one that overflows it is visibly
 * wrong. This answers it the only way it can be answered, by measuring the
 * glyph in the font that will draw it: wider than the font's own digit by
 * more than a rounding margin, and it is dropped.
 *
 * Measured once per font and character (a canvas `measureText`, no layout).
 */

const MARGIN = 1.05
const cache = new Map<string, Map<string, boolean>>()
let context: OffscreenCanvasRenderingContext2D | null = null

function fitsFor(font: string): (char: string) => boolean {
  let known = cache.get(font)
  if (!known) {
    known = new Map()
    cache.set(font, known)
  }
  const fonts = known
  context ??= new OffscreenCanvas(1, 1).getContext('2d')
  const ctx = context
  if (!ctx) return () => true
  ctx.font = font
  const reference = ctx.measureText('0').width * MARGIN
  return (char) => {
    let fits = fonts.get(char)
    if (fits === undefined) {
      ctx.font = font
      fits = ctx.measureText(char).width <= reference
      fonts.set(char, fits)
    }
    return fits
  }
}

/** `text` without the characters `font` (a CSS font shorthand) draws wider than its digit. */
export function dropWideGlyphs(text: string, font: string): string {
  // eslint-disable-next-line no-control-regex -- the ASCII range: a monospace font has every one of these
  if (/^[\x00-\x7F]*$/.test(text)) return text
  const fits = fitsFor(font)
  return Array.from(text).filter((char) => char === ' ' || fits(char)).join('')
}
