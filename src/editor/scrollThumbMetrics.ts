// How big the scrollbar thumb is, measured in lines of text.
//
// THE RULE
// The thumb's size answers "how much of this document is on screen", and the
// honest unit for that is a LINE: a screen holds a fixed number of them
// however full each one happens to be. So the ratio is
//
//     viewport lines / document lines
//
// computed once from the source text, and then left alone.
//
// WHY NOT PIXELS
// Because a pixel ratio is a question about layout, and layout is not known
// until it has been measured. That is what made the thumb resize once shortly
// after every note load -- including switching between notes already seen --
// as the estimated document height was replaced by a better one. Nothing about
// the reader's situation changed at that moment; only the app's knowledge did,
// and a scrollbar that twitches when the app learns something is telling the
// reader about the wrong thing.
//
// WHY NOT CHARACTERS
// A five-thousand-line file of short lines -- a list, dialogue, code, a table
// of contents -- has few characters and many screens. Counting characters
// calls it short. Counting lines does not.
//
// WHY WRAPPED LINES RATHER THAN SOURCE LINES
// Measured on ordinary prose: 7,353 source lines render as 22,367 wrapped
// ones. Using source lines would make the thumb three times too big, and the
// error would swing with how the author happened to hard-wrap.
//
// WHAT THIS DELIBERATELY GETS WRONG
// A document dominated by images, or by code blocks set in another size, will
// have a thumb that is off -- perhaps by a third. That is accepted: the reader
// does not check the thumb against a ruler, and a thumb that is consistently a
// bit wrong beats one that is briefly right and then moves. Being stable is
// the feature.

/** Below this the ratio is meaningless; the caller's minimum takes over. */
const MIN_RATIO = 0.0001

/**
 * Rendered lines a source text occupies, in one linear pass.
 *
 * Measured cost: 0.26ms at 200k characters, 0.75ms at 1.5M, 0.97ms at 5M --
 * affordable enough to do outright rather than sampling, which is why there is
 * no sampling here to get wrong.
 *
 * An empty source line still occupies a line box, which is why the zero case
 * counts as one rather than none.
 */
export function countWrappedLines(text: string, charsPerLine: number): number {
  if (!(charsPerLine > 0)) return Math.max(1, text.length === 0 ? 1 : text.split('\n').length)

  let lines = 0
  let start = 0
  while (start <= text.length) {
    let end = text.indexOf('\n', start)
    if (end === -1) end = text.length
    const length = end - start
    lines += length === 0 ? 1 : Math.ceil(length / charsPerLine)
    start = end + 1
  }
  return Math.max(1, lines)
}

/**
 * The fraction of the track the thumb should occupy.
 *
 * Returns 1 for a document that fits on screen (the caller decides whether
 * that means a full-length thumb or an inactive scrollbar), and null when it
 * has not been given enough to answer -- a caller with no line height yet
 * should keep whatever it last drew rather than draw a wrong one.
 */
export function resolveThumbLineRatio(options: {
  viewportHeightPx: number
  lineHeightPx: number
  documentLines: number
}): number | null {
  const { viewportHeightPx, lineHeightPx, documentLines } = options
  if (!(lineHeightPx > 0) || !(viewportHeightPx > 0) || !(documentLines > 0)) return null

  const viewportLines = viewportHeightPx / lineHeightPx
  return Math.min(1, Math.max(MIN_RATIO, viewportLines / documentLines))
}
