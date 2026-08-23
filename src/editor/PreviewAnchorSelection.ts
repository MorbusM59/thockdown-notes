/**
 * One rendered preview block's vertical extent, measured relative to the
 * preview container's own top edge (so 0 is the top of the viewport,
 * negatives are above it).
 */
export interface PreviewAnchorCandidate<T> {
  entry: T
  top: number
  bottom: number
}

/**
 * Picks the block that occupies the top of the preview viewport -- the one
 * the reader would name if asked "where are you in the document?", and so
 * the one the other mode must land on.
 *
 * The rule is "starts at or above the top edge and still reaches past it",
 * i.e. the block the edge cuts through. Requiring `bottom > 0` is the part
 * that is easy to get wrong: a block whose bottom sits exactly at (or just
 * above) the edge has scrolled entirely out of view, and choosing it hands
 * the other mode a block the reader can no longer see -- landing them one
 * block higher than where they actually are. When nothing straddles the edge
 * (the viewport starts in the gap between two blocks) the first block below
 * it is the honest answer.
 *
 * Returns null only for an empty candidate list.
 */
export function selectPreviewAnchorCandidate<T>(
  candidates: PreviewAnchorCandidate<T>[],
): PreviewAnchorCandidate<T> | null {
  if (candidates.length === 0) return null

  let straddling: PreviewAnchorCandidate<T> | null = null
  let firstBelow: PreviewAnchorCandidate<T> | null = null
  let lastAbove: PreviewAnchorCandidate<T> | null = null

  for (const candidate of candidates) {
    if (candidate.top <= 0 && candidate.bottom > 0) {
      if (!straddling || candidate.top > straddling.top) straddling = candidate
      continue
    }
    if (candidate.top > 0) {
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
