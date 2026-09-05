// The window: which blocks of a chunked document are mounted right now.
//
// WHY THIS EXISTS
// The virtualized preview gives its scroller the height of the WHOLE document,
// which means inventing a height for every block nobody has looked at. That
// invention is what the background survey, the fitted height model, the
// geometry caches and the discovery progress bar all exist to make convincing
// -- and it is never right, only less wrong (measured across four documents:
// +29%, -35%, +94%, +102% against the settled truth).
//
// A window does not invent anything. The scroller holds a contiguous run of
// blocks, all of them mounted, all of them measured by the browser in ordinary
// flow. Its height is a fact. What lies outside the window has no height,
// because it has no representation at all.
//
// The reader keeps scrolling because the window keeps moving: blocks are added
// ahead of them and dropped behind them, and the front edge's changes are
// compensated on `scrollTop` in the same pre-paint pass so nothing under the
// reader moves. What makes that possible is the RUNWAY -- the mounted content
// lying outside the viewport in the direction of travel. The runway is
// latency tolerance and nothing else: it buys the time to mount the next
// blocks before the reader arrives at the edge.
//
// A runway cannot buy throughput. If blocks cannot be mounted as fast as the
// reader consumes them, no depth of runway helps -- it only delays the stall.
// Measured at 6x CPU throttle on a 500k-character document: demand ~109
// blocks/s (7.0 screenfuls/s at ~15.6 blocks a screenful), supply ~131
// blocks/s (28 blocks mounted cold in 214ms). A ~20% margin, and the runway's
// job is to absorb the jitter around it -- the spread between the median and
// the p95 of that mount cost (214ms vs 251ms), not the mount cost itself.
//
// Measured on the same rig, the numbers that matter here do not scale with the
// document: refill cost was 206ms on a 1,500,000-character note against 214ms
// on a 500,000-character one, at 28 blocks a screenful in both. A screenful is
// a screenful. That is the whole argument for this design -- the window is a
// constant, so nothing here has to know how big the document is.

/** Inclusive on both ends. */
export interface PreviewWindowRange {
  startIndex: number
  endIndex: number
}

export interface PreviewWindowGeometry {
  scrollTopPx: number
  clientHeightPx: number
  /** The mounted content's own height. Measured, never estimated. */
  contentHeightPx: number
  /**
   * Mean height of the blocks currently mounted.
   *
   * The one place this module guesses, and deliberately the cheapest possible
   * guess to be wrong about: it decides HOW MANY blocks to add in one pass,
   * nothing else. Being wrong costs another pass on the next frame; it can
   * never place anything, land anything, or produce a position. Contrast the
   * fitted height model this design replaces, whose errors became scroll
   * offsets the reader actually landed on.
   */
  averageBlockHeightPx: number
}

/**
 * How much mounted content must lie beyond the viewport, in screenfuls, before
 * the window stops growing in that direction.
 *
 * Three, from the measurement above: the runway has to cover the jitter in
 * mount cost, and at 6x throttle three screenfuls is ~430ms of travel against
 * a p95 mount of 251ms. Deeper costs mount work that is never looked at;
 * shallower starts stalling on the ordinary spread.
 */
export const PREVIEW_WINDOW_RUNWAY_SCREENFULS = 3

/**
 * The runway depth that triggers a trim, and the depth a trim leaves behind.
 *
 * Hysteresis, and it is not optional: trimming back to the grow threshold
 * means the next frame is under it again, so the window would grow and trim on
 * alternating frames forever -- each trim paying a scrollTop compensation, at
 * the front edge, while the reader is moving. Trimming only from well above
 * the threshold down to comfortably above it means a steady scroll crosses the
 * boundary rarely.
 */
export const PREVIEW_WINDOW_TRIM_SCREENFULS = 6
export const PREVIEW_WINDOW_TRIM_TARGET_SCREENFULS = 4

/** Bounds on one adjustment, so a bad average can neither stall nor run away. */
export const PREVIEW_WINDOW_MIN_STEP_BLOCKS = 8
export const PREVIEW_WINDOW_MAX_STEP_BLOCKS = 400

/**
 * The smallest window worth holding.
 *
 * Below this the adjustment loop spends every frame growing, and a document
 * whose blocks are all taller than the viewport (one long code fence apiece)
 * would otherwise be trimmed to a single block and lose its runway entirely.
 */
export const PREVIEW_WINDOW_MIN_BLOCKS = 16

/**
 * The window to open on a document nobody has scrolled yet, in blocks.
 *
 * A block count rather than a pixel target because at this moment nothing has
 * been measured -- there is no average to divide by. Whatever this gets wrong,
 * the first adjustment pass corrects from real geometry.
 */
export const PREVIEW_WINDOW_INITIAL_BLOCKS = 48

const clampIndex = (value: number, blockCount: number): number => (
  Math.min(Math.max(0, blockCount - 1), Math.max(0, value))
)

/**
 * The window to open around `anchorIndex`, with the anchor near its top.
 *
 * Biased backwards by a third rather than centred: the reader who lands
 * somewhere new is overwhelmingly about to travel FORWARD from it, so the
 * runway is worth more ahead of them than behind.
 */
export function planPreviewWindowAround(
  anchorIndex: number,
  blockCount: number,
  spanBlocks: number = PREVIEW_WINDOW_INITIAL_BLOCKS,
): PreviewWindowRange {
  if (blockCount <= 0) return { startIndex: 0, endIndex: -1 }
  const span = Math.max(1, Math.min(blockCount, spanBlocks))
  const anchor = clampIndex(anchorIndex, blockCount)
  const behind = Math.floor(span / 3)
  let startIndex = anchor - behind
  if (startIndex < 0) startIndex = 0
  let endIndex = startIndex + span - 1
  if (endIndex > blockCount - 1) {
    endIndex = blockCount - 1
    startIndex = Math.max(0, endIndex - span + 1)
  }
  return { startIndex, endIndex }
}

/**
 * The window this geometry asks for, or null when the current one will do.
 *
 * Growing is considered before trimming and both may happen in one answer.
 * Starving the reader is the only failure mode that is visible, so a pass that
 * can only afford one of the two always does the growing.
 */
export function resolvePreviewWindowAdjustment(
  current: PreviewWindowRange,
  blockCount: number,
  geometry: PreviewWindowGeometry,
): PreviewWindowRange | null {
  if (blockCount <= 0) return null
  const { scrollTopPx, clientHeightPx, contentHeightPx, averageBlockHeightPx } = geometry
  if (!(clientHeightPx > 0)) return null

  const average = averageBlockHeightPx > 0 ? averageBlockHeightPx : clientHeightPx
  const blocksFor = (px: number): number => Math.max(
    PREVIEW_WINDOW_MIN_STEP_BLOCKS,
    Math.min(PREVIEW_WINDOW_MAX_STEP_BLOCKS, Math.ceil(px / average)),
  )

  const growPx = clientHeightPx * PREVIEW_WINDOW_RUNWAY_SCREENFULS
  const trimPx = clientHeightPx * PREVIEW_WINDOW_TRIM_SCREENFULS
  const trimTargetPx = clientHeightPx * PREVIEW_WINDOW_TRIM_TARGET_SCREENFULS

  const forwardRunwayPx = contentHeightPx - (scrollTopPx + clientHeightPx)
  const backwardRunwayPx = scrollTopPx

  let { startIndex, endIndex } = current

  if (forwardRunwayPx < growPx && endIndex < blockCount - 1) {
    endIndex = Math.min(blockCount - 1, endIndex + blocksFor(growPx - forwardRunwayPx))
  } else if (forwardRunwayPx > trimPx) {
    const shed = blocksFor(forwardRunwayPx - trimTargetPx)
    endIndex = Math.max(startIndex + PREVIEW_WINDOW_MIN_BLOCKS - 1, endIndex - shed)
  }

  if (backwardRunwayPx < growPx && startIndex > 0) {
    startIndex = Math.max(0, startIndex - blocksFor(growPx - backwardRunwayPx))
  } else if (backwardRunwayPx > trimPx) {
    const shed = blocksFor(backwardRunwayPx - trimTargetPx)
    startIndex = Math.min(endIndex - PREVIEW_WINDOW_MIN_BLOCKS + 1, startIndex + shed)
  }

  startIndex = Math.max(0, Math.min(startIndex, blockCount - 1))
  endIndex = Math.max(startIndex, Math.min(endIndex, blockCount - 1))

  if (startIndex === current.startIndex && endIndex === current.endIndex) return null
  return { startIndex, endIndex }
}

/** Whether `blockIndex` is mounted, i.e. reachable without re-anchoring. */
export function isWithinPreviewWindow(range: PreviewWindowRange, blockIndex: number): boolean {
  return blockIndex >= range.startIndex && blockIndex <= range.endIndex
}

