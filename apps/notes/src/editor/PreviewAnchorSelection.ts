/**
 * One rendered preview element's vertical extent, measured relative to the
 * preview container's own top edge (so 0 is the top of the viewport,
 * negatives are above it).
 */
export interface PreviewAnchorCandidate<T> {
  entry: T
  top: number
  bottom: number
}

/**
 * Picks the element the reader is positioned on -- the one they would name
 * if asked "where are you in the document?", and so the one the other mode
 * must land on.
 *
 * `referenceOffsetPx` is the line this measurement is taken at, and it must
 * be the same one a restore lands on (EditRestoreMath's RESTORE_OFFSET_LINES,
 * in pixels). Reading at the container's top edge while restores land one
 * line-height below it makes every mode switch shift by that difference, and
 * a round trip walk.
 *
 * The rule is "starts at or above the reference line and still reaches past
 * it", i.e. the element the line cuts through. The `bottom > reference` half
 * is the part that is easy to get wrong: an element whose bottom sits exactly
 * at (or above) that line has scrolled past it, and choosing it hands the
 * other mode a position the reader has already left -- landing them higher
 * than where they actually are. When nothing straddles the line (it falls in
 * the gap between two elements) the first element below it is the honest
 * answer.
 *
 * Returns null only for an empty candidate list.
 */
/**
 * How much slack the straddle test allows at the reference line.
 *
 * Not a fudge factor: the reference line is exactly where a landing PUTS a
 * block's top, so the boundary case is not an edge case here -- it is the
 * normal case, hit on every single restore. At exact equality the rule below
 * is already right (the block starting at the line straddles it; the one
 * ending there has been scrolled past), but both numbers arrive as
 * accumulated floating-point sums of measured heights, and a difference of one
 * ULP flips the comparison to the block above. Measured in the round-trip
 * property test: a landing at 570.5999999999999 read back as the PREVIOUS
 * block, because that block's bottom and the next block's top were the same
 * quantity computed two different ways.
 *
 * A micron of a pixel is far below any geometry the browser can express (a
 * subpixel is 1/64px at worst) and far above double-precision noise on numbers
 * of this size, so it can only ever resolve the tie it is here for.
 */
const REFERENCE_BOUNDARY_TOLERANCE_PX = 1e-6

export function selectPreviewAnchorCandidate<T>(
  candidates: PreviewAnchorCandidate<T>[],
  referenceOffsetPx = 0,
): PreviewAnchorCandidate<T> | null {
  if (candidates.length === 0) return null

  const reference = referenceOffsetPx + REFERENCE_BOUNDARY_TOLERANCE_PX

  let straddling: PreviewAnchorCandidate<T> | null = null
  let firstBelow: PreviewAnchorCandidate<T> | null = null
  let lastAbove: PreviewAnchorCandidate<T> | null = null

  for (const candidate of candidates) {
    if (candidate.top <= reference && candidate.bottom > reference) {
      if (!straddling || candidate.top > straddling.top) straddling = candidate
      continue
    }
    if (candidate.top > reference) {
      if (!firstBelow || candidate.top < firstBelow.top) firstBelow = candidate
      continue
    }
    if (!lastAbove || candidate.top > lastAbove.top) lastAbove = candidate
  }

  // Fully-scrolled-past blocks are the last resort: reached only when every
  // candidate is above the edge, which means nothing is rendered at the top
  // of the viewport at all.
  return straddling ?? firstBelow ?? lastAbove
}
