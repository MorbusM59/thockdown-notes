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

/**
 * A thumb height that is decided once and then held.
 *
 * The rule at the top of this file says the size is computed once and then
 * left alone, but a call site that recomputes it on every sync does not honor
 * that on its own: it re-derives the same answer from whatever the layout
 * happens to say this frame, and any drift in that reading becomes a thumb
 * that resizes while the reader watches. The visible symptom was the end of a
 * long journey -- the leading edge lands, then the trailing edge settles a few
 * pixels further on, because the size that arrived was not quite the size that
 * set out.
 *
 * So the height is committed against a SIGNATURE of the things that may
 * legitimately change it: the document, the viewport, and the type geometry.
 * While the signature holds, the committed height is returned unchanged -- no
 * matter where the reader is, what the scroller currently reports its height
 * to be, or how much of the document has been measured since. When the
 * signature changes, the height is resolved once more and held again.
 *
 * Position is deliberately not part of this. Where the thumb SITS must stay
 * live and truthful; only how BIG it is is frozen.
 */
export interface CommittedThumbHeight {
  resolve(options: {
    /** Everything that may legitimately change the size, joined into one key. */
    signature: string
    /** The authoritative ratio, or null when the document cannot answer yet. */
    ratio: number | null
    /** Used only while `ratio` is null and nothing is committed. Never committed. */
    provisionalRatio: number
    usableTrackHeightPx: number
    minThumbHeightPx: number
  }): number
  /** Drop the commitment, so the next resolve decides afresh. */
  invalidate(): void
}

export function createCommittedThumbHeight(): CommittedThumbHeight {
  let committedSignature: string | null = null
  let committedHeightPx: number | null = null

  const toHeightPx = (ratio: number, usableTrackHeightPx: number, minThumbHeightPx: number) => Math.max(
    minThumbHeightPx,
    Math.min(usableTrackHeightPx, Math.round(usableTrackHeightPx * ratio)),
  )

  return {
    resolve({ signature, ratio, provisionalRatio, usableTrackHeightPx, minThumbHeightPx }) {
      // A commitment describes one document at one geometry. Once either
      // changes it is not a stale answer to this question, it is an answer to
      // a different one, and holding it would pin the new document's thumb to
      // the old document's size for as long as measuring takes.
      if (committedSignature !== signature) {
        committedSignature = null
        committedHeightPx = null
      }

      if (committedHeightPx !== null) return committedHeightPx

      // "Not yet" is not an answer. Draw the provisional ratio so the frame
      // is not empty -- and never commit to it, or a document entitled to an
      // exact scrollbar keeps whatever estimate was current when it first
      // managed to say anything at all.
      if (ratio === null) return toHeightPx(provisionalRatio, usableTrackHeightPx, minThumbHeightPx)

      committedHeightPx = toHeightPx(ratio, usableTrackHeightPx, minThumbHeightPx)
      committedSignature = signature
      return committedHeightPx
    },
    invalidate() {
      committedSignature = null
      committedHeightPx = null
    },
  }
}
