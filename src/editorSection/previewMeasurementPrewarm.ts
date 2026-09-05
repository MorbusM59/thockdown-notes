// Scheduling logic for the preview pane's background measurement prewarm.
//
// WHY THIS EXISTS
// The virtualizer positions blocks at a running sum of their heights, so it
// needs a height for every block including the ones nobody has scrolled to.
// Until something is measured that height is arithmetic over the source
// (lines x line height), and arithmetic is not close. Measured against the
// settled truth on four documents:
//
//   48k chars, 667 small blocks    +29%
//   45k chars, 150 normal blocks   -35%
//   400k chars, 768 blocks         +94%
//   1.5M chars                    +102%
//
// Wrong in both directions, by a factor that swings with the shape of the
// document -- so there is no constant to correct it by, and something has to
// go and look. That is what the sweep is.
//
// It now runs on CONTINUOUS documents only -- under
// CONTINUOUS_DOCUMENT_MAX_CHARS, where every block is measured and
// `scrollHeight` becomes a true total. A chunked document has no
// whole-document height to be wrong about: it is windowed
// (editorSection/previewWindow.ts), its scroller holds only the mounted run,
// and every height in it is one the browser produced. The sampled-and-fitted
// height model that used to serve that case is gone with it.
//
// This module owns only the PACING -- how many blocks to take in one slice,
// and how long to wait between them. Which blocks to take is the caller's
// decision now (it follows from the document's size), and the measuring
// itself lives in usePreviewMarkdownRendering.tsx, which has the DOM.
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

/**
 * How long one measurement slice may occupy the main thread.
 *
 * This is a THROUGHPUT budget, not a jank budget, and it has to be read
 * against the fixed cost of a slice. A slice costs `fixed + n * perBlock`,
 * where `fixed` -- a React commit plus a forced layout of the whole preview --
 * measured ~10ms and does not shrink with the batch. So a budget BELOW that
 * fixed cost is unsatisfiable at any batch size, and the adaptive sizer below
 * pins itself to its floor trying: at the original 8ms it settled on 2 blocks
 * a slice on a large-block document, which is 111 blocks/sec no matter how
 * cheap the blocks are. On a 1.5M-character document of ordinary short
 * paragraphs (18,108 blocks) that is a survey that takes minutes -- reported
 * live as "1% every other second", which is not a survey at all.
 *
 * Measured on that document (real Chromium via the harness):
 *
 *   budget  batch  blocks/sec  full survey
 *      8ms     14         825       21.5s
 *     32ms     77       1,973        8.7s
 *
 * Above ~32ms the curve flattens -- once `fixed` is amortized, throughput
 * approaches 1/perBlock and a bigger budget just buys longer slices for the
 * same rate -- so this is the knee, not a ceiling worth raising.
 */
export const PREVIEW_PREWARM_SLICE_BUDGET_MS = 32

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

/**
 * How many completed surveys to keep, keyed by the geometry each was taken at.
 *
 * Geometries repeat: a sidebar toggled off and back on, a font size tried and
 * undone, a split divider dragged and returned. Each of those is an exact hit,
 * so the re-survey costs nothing. Small on purpose -- the entries are cheap
 * (one number per block) but they are only worth keeping while the reader is
 * plausibly still moving between the same few layouts.
 */
export const PREVIEW_PREWARM_GEOMETRY_CACHE_SIZE = 4

/**
 * How far the slice budget may stretch to amortize a fixed cost it cannot
 * avoid, and the hard ceiling on a slice however slow the machine is.
 *
 * A slice cannot cost less than one React commit plus one forced layout. When
 * that alone is bigger than the budget, holding the budget means spending
 * every slice on overhead -- so the budget stretches to a multiple of it. The
 * ceiling is what stops that reasoning from running away on genuinely slow
 * hardware: 120ms is a long time to hold the main thread, and it is spent only
 * while calibrating, a handful of slices in total.
 */
export const PREVIEW_PREWARM_FIXED_COST_HEADROOM = 2.5
export const PREVIEW_PREWARM_MAX_SLICE_MS = 120

/**
 * How long a scheduled slice may be starved before it runs anyway.
 *
 * `requestIdleCallback`'s own timeout. The default this code shipped with was
 * 500ms, which on a main thread that never goes idle caps the survey at two
 * slices a second regardless of the batch size -- a failure mode that is
 * invisible on an idle machine and dominant on a busy one. 60ms keeps the
 * "use time nobody else needs" behaviour on an idle thread (where the callback
 * fires in the first idle period, long before this) while bounding the busy
 * case to ~16 slices a second instead of 2.
 */
export const PREVIEW_PREWARM_IDLE_TIMEOUT_MS = 60

/**
 * Where the adaptive batch size starts, and the range it may move in.
 *
 * The maximum is high because it is not a policy, it is a safety rail: the
 * budget above is what actually bounds a slice, and the batch size that fills
 * it is a property of the document (a page of one-line paragraphs measures
 * hundreds of blocks in the time a page of long blockquotes measures ten). A
 * cap of 24 was quietly the real limit on cheap documents.
 */
export const PREVIEW_PREWARM_MIN_BATCH = 1
export const PREVIEW_PREWARM_MAX_BATCH = 512
export const PREVIEW_PREWARM_INITIAL_BATCH = 6

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
  fixedCostMs = 0,
): number {
  if (previousBatchSize <= 0) return PREVIEW_PREWARM_INITIAL_BATCH
  // A slice that measured nothing measurable (0ms) tells us nothing about
  // cost, so step up gently rather than leaping to the maximum.
  if (!(previousDurationMs > 0)) {
    return Math.min(PREVIEW_PREWARM_MAX_BATCH, previousBatchSize * 2)
  }

  // Split the observed slice into the part that does not shrink with the batch
  // and the part that does. Without this the budget is spent on overhead: at
  // 6x CPU throttle a slice's fixed cost alone exceeded the whole budget, the
  // sizer pinned itself to the floor exactly as it did before this budget was
  // raised, and calibrating 160 blocks took 11.9s instead of ~1s. The budget
  // stretches to cover a fixed cost it cannot avoid, so that slow hardware
  // gets FEWER, bigger slices rather than a floor's worth of tiny ones.
  const fixed = Math.max(0, Math.min(fixedCostMs, previousDurationMs))
  const effectiveBudget = Math.min(
    PREVIEW_PREWARM_MAX_SLICE_MS,
    Math.max(budgetMs, fixed * PREVIEW_PREWARM_FIXED_COST_HEADROOM),
  )
  const perBlockMs = Math.max(0.001, (previousDurationMs - fixed) / previousBatchSize)
  const target = Math.floor((effectiveBudget - fixed) / perBlockMs)
  // Never move by more than 2x in one step: a single anomalous slice (a GC
  // pause landing inside it) shouldn't collapse the batch size to 1 and leave
  // the sweep crawling for the rest of the document.
  const bounded = Math.max(
    Math.ceil(previousBatchSize / 2),
    Math.min(previousBatchSize * 2, target),
  )
  return Math.max(PREVIEW_PREWARM_MIN_BATCH, Math.min(PREVIEW_PREWARM_MAX_BATCH, bounded))
}

