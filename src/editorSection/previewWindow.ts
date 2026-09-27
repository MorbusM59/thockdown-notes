// The window: which blocks of a chunked document are mounted right now.
//
// WHY THIS EXISTS
// The virtualized preview this replaced gave its scroller the height of the
// WHOLE document, which meant inventing a height for every block nobody had
// looked at. That invention is what its background survey, fitted height
// model, geometry caches and discovery progress bar all existed to make
// convincing -- and it was never right, only less wrong (measured across four documents:
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
   * The one place this module guesses, and it is used for exactly one thing:
   * how far to GROW. The blocks being added are not mounted, so their heights
   * cannot be known, and no better answer exists.
   *
   * It is deliberately NOT used for trimming. A mean is a statement about a
   * window as a whole, and the blocks at an EDGE are the ones least likely to
   * resemble it -- two images or a code fence at the front of a run of
   * paragraphs is ordinary, not pathological. See `measuredBlockHeightPx`.
   */
  averageBlockHeightPx: number
  /**
   * The real height of a mounted block, when it is known.
   *
   * Trimming never has to guess: the blocks being REMOVED are mounted and the
   * browser has already measured them. What makes the difference matter is
   * that a front-edge trim is paid for on `scrollTop` by the carry, and
   * `scrollTop` IS the backward runway -- so a trim planned on a mean that
   * under-states the edge does not merely mis-count blocks, it removes those
   * pixels from the very quantity it was trying to leave behind. Modelled on
   * a 172px mean, two 900px edge blocks are shed as five blocks and 2136px:
   * a trim aiming to leave 1484px of runway leaves 336px, and the reader is
   * thrown against the mounted edge by a pass that was meant to be
   * housekeeping. That is what "the note fights the scrolling" is.
   *
   * Measured, the same trim sheds one block and lands inside the band.
   *
   * Optional so a caller with no measurements still gets sane behaviour from
   * the mean; absent, this degrades to the modelling it replaces.
   */
  measuredBlockHeightPx?: (blockIndex: number) => number | undefined
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
 * Whether `range` can simply be kept over a document of `blockCount` blocks.
 *
 * The question this answers is "does an edit to the document force the window
 * to be rebuilt", and the answer is almost always no. A window is a run of
 * block INDICES; typing a character inside one of those blocks changes what
 * that block says, not which blocks the window holds. Rebuilding it anyway
 * unmounts and remounts every block in it, and each remount is a full
 * markdown parse -- see the dependency list of the re-plan effect in
 * usePreviewWindow.tsx for what that cost when it was measured.
 *
 * Only two things genuinely make a range unusable: it holds nothing while the
 * document has blocks (the window was planned before the text arrived), or it
 * reaches past the end of a document that has since shrunk.
 */
export function isPreviewWindowRangeUsable(
  range: PreviewWindowRange,
  blockCount: number,
): boolean {
  if (blockCount <= 0) return range.endIndex < range.startIndex
  return range.startIndex >= 0
    && range.endIndex >= range.startIndex
    && range.endIndex < blockCount
}

/**
 * `range` pulled back inside a document of `blockCount` blocks, keeping its
 * span and moving it as little as possible.
 *
 * For the one case above that an edit really can produce: a deletion large
 * enough that the window now reaches past the last block. Re-planning from
 * scratch would answer that by throwing the reader back to the top of the
 * document, which is a far larger surprise than the deletion was. Sliding the
 * same-sized window back to the new end keeps them where the text still is.
 */
export function clampPreviewWindowRange(
  range: PreviewWindowRange,
  blockCount: number,
): PreviewWindowRange {
  if (blockCount <= 0) return { startIndex: 0, endIndex: -1 }
  const span = Math.max(1, range.endIndex - range.startIndex + 1)
  const endIndex = Math.min(Math.max(0, range.endIndex), blockCount - 1)
  const startIndex = Math.max(0, Math.min(Math.max(0, range.startIndex), endIndex - span + 1))
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
  const { scrollTopPx, clientHeightPx, contentHeightPx, averageBlockHeightPx, measuredBlockHeightPx } = geometry
  if (!(clientHeightPx > 0)) return null

  const average = averageBlockHeightPx > 0 ? averageBlockHeightPx : clientHeightPx
  const growPx = clientHeightPx * PREVIEW_WINDOW_RUNWAY_SCREENFULS
  const trimPx = clientHeightPx * PREVIEW_WINDOW_TRIM_SCREENFULS
  const trimTargetPx = clientHeightPx * PREVIEW_WINDOW_TRIM_TARGET_SCREENFULS

  const forwardRunwayPx = contentHeightPx - (scrollTopPx + clientHeightPx)
  const backwardRunwayPx = scrollTopPx

  /**
   * ONE rule, applied in both directions: move the runway to the TARGET.
   *
   * The window has a target depth (`trimTargetPx`, four screenfuls) and a band
   * around it it is willing to tolerate (`growPx`..`trimPx`, three to six).
   * It acts only outside the band, and when it acts it aims at the target --
   * never at the threshold it is escaping.
   *
   * Both halves of that were broken, and each produced a cycle.
   *
   * TRIM already aimed at the target, but `blocksFor` imposed a minimum of
   * eight blocks that overrode the aim. The minimum is counted in BLOCKS
   * while the band is counted in SCREENFULS, and nothing kept the two
   * commensurable -- so when a block is large relative to the viewport, one
   * step is wider than the whole band and every correction lands past the
   * opposite threshold. Measured: viewport 371px, mean block 171px, band
   * 1113px wide, minimum step 1368px. Growing from 1017px of runway landed at
   * 2385 (trim it); trimming from 2386 landed at 1018 (grow it). The window
   * flipped between 16 and 24 blocks forever, burning every frame.
   *
   * GROW aimed at `growPx` -- the very edge it was trying to get off. The
   * trim constants' own doc says landing on a threshold is what makes a
   * steady scroll grow and trim on alternating frames; grow had the same flaw
   * mirrored, hidden because the minimum step usually carried it past. Aiming
   * both directions at the same target is what makes the band a resting place
   * instead of a boundary to bounce between.
   *
   * The step is then capped so it cannot cross the far threshold, which
   * matters only when a single block is wider than the band. There the two
   * directions part company, and the asymmetry is the point: GROWING protects
   * the reader, because too little runway means scrolling into unmounted
   * space, so it goes ahead and overshoots and pays in mounted DOM. TRIMMING
   * only reclaims that DOM and is never urgent, so a trim that would
   * immediately need undoing is not made at all. Given a choice between too
   * much runway and a window that never settles, too much runway is right.
   */
  const stepsToward = (deltaPx: number): number => Math.max(
    1,
    Math.min(PREVIEW_WINDOW_MAX_STEP_BLOCKS, Math.ceil(deltaPx / average)),
  )
  /** The most blocks that can be ADDED before the far threshold is crossed, modelled. */
  const affordableSteps = (headroomPx: number): number => Math.floor(headroomPx / average)
  const heightOf = (blockIndex: number): number => {
    const measured = measuredBlockHeightPx?.(blockIndex)
    return typeof measured === 'number' && measured > 0 ? measured : average
  }

  let { startIndex, endIndex } = current

  /**
   * GROWING must model, because the blocks being added are not mounted. It
   * therefore keeps the minimum step and the overshoot cap, and when nothing
   * fits it grows anyway: a reader short of runway is the failure that
   * matters, extra mounted DOM is not.
   */
  const growBy = (runwayPx: number): number => {
    const wanted = Math.max(PREVIEW_WINDOW_MIN_STEP_BLOCKS, stepsToward(trimTargetPx - runwayPx))
    const affordable = affordableSteps(trimPx - runwayPx)
    return affordable < 1 ? wanted : Math.min(wanted, affordable)
  }

  /**
   * TRIMMING measures, because the blocks being removed are mounted and the
   * browser has already told us how tall they are. Blocks are taken, in the
   * order they will actually be dropped, while their REAL accumulated height
   * still fits inside what may be given up -- so the runway lands where it
   * aimed rather than where a mean predicted.
   *
   * This is what makes an overshooting grow self-correcting instead of the
   * start of a cycle: a grow must guess, so it may land above the trim
   * threshold, and the trim that follows is exact and settles on the target.
   * Modelling the trim as well meant both ends guessed, and two guesses in
   * opposite directions do not have to converge.
   *
   * Note what this walk fixes on its own and what needs the measurement, so
   * neither is credited with the other's work. Stopping BEFORE the block that
   * would carry the runway past the target already tolerates a modest mean
   * error, because the band between the target and the grow threshold absorbs
   * it -- a 19% error over five blocks did not survive this change even with
   * the mean. The measurement is what covers an edge block that does not
   * resemble the window at all, where the error is a multiple rather than a
   * percentage and no band is wide enough. See the tests.
   *
   * `takeFrom` walks outward from the edge being trimmed: forward from
   * `startIndex` when trimming the back, backward from `endIndex` when
   * trimming the front.
   */
  const trimBy = (runwayPx: number, takeFrom: (offset: number) => number, maxBlocks: number): number => {
    // Never give up more than would drop the runway past the grow threshold,
    // and aim to land on the target.
    const idealPx = runwayPx - trimTargetPx
    const limitPx = runwayPx - growPx
    let shed = 0
    let accumulatedPx = 0
    while (shed < maxBlocks) {
      const nextPx = accumulatedPx + heightOf(takeFrom(shed))
      // Stop before the block that would carry us past either the target we
      // are aiming for or the threshold we must not cross.
      if (nextPx > idealPx || nextPx > limitPx) break
      accumulatedPx = nextPx
      shed += 1
    }
    return shed
  }

  if (forwardRunwayPx < growPx && endIndex < blockCount - 1) {
    endIndex = Math.min(blockCount - 1, endIndex + growBy(forwardRunwayPx))
  } else if (forwardRunwayPx > trimPx) {
    const room = endIndex - (startIndex + PREVIEW_WINDOW_MIN_BLOCKS - 1)
    const shed = trimBy(forwardRunwayPx, (offset) => endIndex - offset, Math.max(0, room))
    if (shed > 0) endIndex = endIndex - shed
  }

  if (backwardRunwayPx < growPx && startIndex > 0) {
    startIndex = Math.max(0, startIndex - growBy(backwardRunwayPx))
  } else if (backwardRunwayPx > trimPx) {
    const room = (endIndex - PREVIEW_WINDOW_MIN_BLOCKS + 1) - startIndex
    const shed = trimBy(backwardRunwayPx, (offset) => startIndex + offset, Math.max(0, room))
    if (shed > 0) startIndex = startIndex + shed
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

