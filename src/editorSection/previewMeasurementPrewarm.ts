// Scheduling logic for the preview pane's background measurement prewarm.
//
// WHY THIS EXISTS
// The preview virtualizes blocks with a flat 56px size estimate
// (PREVIEW_BLOCK_ESTIMATED_HEIGHT_PX). Every block the reader has not scrolled
// past keeps that estimate, which measures badly on a real document: on a
// 300k-character note the cold total size is 14,216px against a true 49,439px
// -- 71% short. Two visible consequences:
//
//   * dragging or clicking to the bottom of the scrollbar lands ~3,700px short
//     of the end, unless the document has already been scrolled through;
//   * a long scroll churns -- the total size changed 37 times across 60
//     viewport hops, the biggest single jump 1,091px, each one a visible
//     stutter of the scroll thumb.
//
// The fix is to measure every block up front, in the background, and hand the
// real heights to the virtualizer before the reader ever gets there. This
// module owns only the *scheduling*: which blocks to measure next and how many
// to take in one slice. The measuring itself lives in
// usePreviewMarkdownRendering.tsx, which has the DOM.
//
// FIDELITY IS THE WHOLE GAME
// A prewarmed height that is wrong is worse than no prewarm at all: the
// virtualizer would hold a confident wrong number until the block really
// mounts, then correct it -- the same flicker, just moved. Two traps were
// found by measurement while building this, both of which silently
// under-measure (see the host's own comments in the hook):
//
//   1. The measurement host must live INSIDE the virtualizer's spacer div, not
//      in the scroller. The scroller is position:relative, so an absolutely
//      positioned host attached there resolves width:100% against its PADDING
//      box -- 36px wider than the real blocks (2x --preview-edge-padding), so
//      every block that wraps measures short.
//   2. Each measured block must keep the real wrapper's absolute positioning.
//      Stacked in normal flow they collapse margins with each other, which the
//      real (absolutely positioned) blocks never do.

/** How long one measurement slice may occupy the main thread. */
export const PREVIEW_PREWARM_SLICE_BUDGET_MS = 8

/**
 * How long the preview's geometry must hold still before a survey restarts.
 *
 * A window or split-view drag resizes the pane on every frame; restarting per
 * frame means the survey never finishes while the drag is in progress, on
 * exactly the hardware where it is already slowest.
 */
export const PREVIEW_PREWARM_RESIZE_SETTLE_MS = 300

/**
 * How long after the reader's last scroll the survey stays out of the way.
 *
 * The survey has no deadline; the reader does. Measured at 6x CPU throttle
 * while scrolling a large document, a survey that kept working through the
 * scroll cost ~36% median frame time (29.9ms against 22.1ms once it had
 * finished). Yielding while the reader is moving costs the survey a few
 * seconds it does not care about.
 */
export const PREVIEW_PREWARM_SCROLL_QUIET_MS = 180

/** Where the adaptive batch size starts, and the range it may move in. */
export const PREVIEW_PREWARM_MIN_BATCH = 1
export const PREVIEW_PREWARM_MAX_BATCH = 24
export const PREVIEW_PREWARM_INITIAL_BATCH = 6

/**
 * Picks the next run of unmeasured block indices.
 *
 * Order matters, and it is not "0 upward". The virtualizer compensates
 * scrollTop whenever a block ABOVE the fold changes size -- correct behaviour
 * (it keeps the content under the reader still), but it means measuring
 * upward from the top while the reader sits mid-document moves the scroll
 * thumb under their hand. So: sweep from the reader's position to the end
 * first, where corrections are invisible, and only then come back for what is
 * above them. On a freshly opened note -- the case this feature is really for
 * -- the reader is at the top, so the entire sweep is below the fold and
 * nothing shifts at all.
 */
export function planNextPrewarmBatch(options: {
  blockCount: number
  /** Whether this index already has a real (non-estimated) height. */
  isMeasured: (index: number) => boolean
  /** Roughly where the reader is; the downward sweep starts here. */
  cursorIndex: number
  batchSize: number
}): number[] {
  const { blockCount, isMeasured, cursorIndex, batchSize } = options
  if (blockCount <= 0 || batchSize <= 0) return []

  const start = Math.max(0, Math.min(cursorIndex, blockCount - 1))
  const picked: number[] = []

  for (let index = start; index < blockCount && picked.length < batchSize; index += 1) {
    if (!isMeasured(index)) picked.push(index)
  }
  for (let index = 0; index < start && picked.length < batchSize; index += 1) {
    if (!isMeasured(index)) picked.push(index)
  }

  return picked
}

/**
 * Grows or shrinks the next batch so a slice lands near the time budget.
 *
 * Block cost varies by two orders of magnitude in the same document -- a
 * one-line heading against a 1,100px blockquote -- so a fixed batch size is
 * either needlessly slow on cheap blocks or janky on expensive ones. Adapting
 * on the previous slice's real cost keeps each slice inside the budget without
 * needing to know anything about the content.
 */
export function resolveNextPrewarmBatchSize(
  previousBatchSize: number,
  previousDurationMs: number,
  budgetMs: number = PREVIEW_PREWARM_SLICE_BUDGET_MS,
): number {
  if (previousBatchSize <= 0) return PREVIEW_PREWARM_INITIAL_BATCH
  // A slice that measured nothing measurable (0ms) tells us nothing about
  // cost, so step up gently rather than leaping to the maximum.
  if (!(previousDurationMs > 0)) {
    return Math.min(PREVIEW_PREWARM_MAX_BATCH, previousBatchSize * 2)
  }

  const perBlockMs = previousDurationMs / previousBatchSize
  const target = Math.floor(budgetMs / perBlockMs)
  // Never move by more than 2x in one step: a single anomalous slice (a GC
  // pause landing inside it) shouldn't collapse the batch size to 1 and leave
  // the sweep crawling for the rest of the document.
  const bounded = Math.max(
    Math.ceil(previousBatchSize / 2),
    Math.min(previousBatchSize * 2, target),
  )
  return Math.max(PREVIEW_PREWARM_MIN_BATCH, Math.min(PREVIEW_PREWARM_MAX_BATCH, bounded))
}
