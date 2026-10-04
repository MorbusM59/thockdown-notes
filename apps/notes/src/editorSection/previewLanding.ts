/**
 * Where a preview landing puts the scroller, stated once for both panes.
 *
 * Every restore into the render view -- a note switch, a mode toggle, a
 * snapshot preview -- wants the same thing: the reader's anchor block, sitting
 * `offsetPx` below the top of the pane rather than flush against its border
 * (`RESTORE_OFFSET_LINES`, the user-confirmed convention -- see
 * docs/editor-contract.md's Viewport Model section).
 *
 * The offset is a distance measured into the DOCUMENT, not into the pane, and
 * that distinction is the whole reason this function exists. `--preview-edge-
 * padding` is the page's own leading margin; it is not text the reader scrolled
 * past, so the offset may never be satisfied by eating into it. When there is
 * less than `offsetPx` of real content above the anchor, the honest landing is
 * the document's top -- there simply is not that much document above it to
 * show.
 *
 * The first block falls out of that with no special case: it has zero content
 * above it at every typography setting, so it always lands at 0.
 *
 * This used to be two different mechanisms that disagreed. The continuous pane
 * set `scroll-padding-top` and let a native `scrollIntoView` land there, using
 * the EDIT view's line height inside a pane laid out with the RENDER view's
 * metrics; the windowed pane applied no offset at all and landed on the block's
 * own top. Block 0 came out right on the continuous pane only because
 * `edgePadding - editLineHeight` happened to go negative and clamp at 0 -- an
 * accident that fails outright at the small end of the font-size slider
 * (EDITOR_FONT_SIZE_MIN_PX is 6, so one render line can be 9.6px against an
 * 18px margin) and never held on the windowed pane at all, which opened every
 * note one edge-padding down the page.
 */
export interface PreviewLandingParams {
  /**
   * The anchor block's top edge, in the scroller's own `scrollTop` space --
   * i.e. the scroll position that would put the block flush against the pane's
   * top border.
   */
  blockTopPx: number
  /**
   * How much real document content sits above this block, in pixels.
   *
   * Each pane answers this about itself, because only it can: a continuous
   * pane holds the whole document, so the answer is `blockTopPx` minus the
   * leading margin. A windowed pane holds a moving run, so the answer is that
   * same subtraction only while the run starts at block 0 -- anywhere else
   * there is at least a window of document above, which is `Infinity` as far
   * as a one-line offset is concerned.
   */
  contentAbovePx: number
  /** The offset to honour, in pixels. Zero for a plain "put this block at the top". */
  offsetPx: number
  /** The scroller's own upper bound (`scrollHeight - clientHeight`). */
  maxScrollTopPx: number
}

export function resolvePreviewLandingScrollTop(params: PreviewLandingParams): number {
  const { blockTopPx, contentAbovePx, offsetPx, maxScrollTopPx } = params

  const offset = Math.max(0, offsetPx)
  const landing = contentAbovePx >= offset ? blockTopPx - offset : 0

  const upperBound = Math.max(0, maxScrollTopPx)
  return Math.min(Math.max(0, landing), upperBound)
}
