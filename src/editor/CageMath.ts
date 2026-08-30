interface ResolveCagedScrollTargetInput {
  caretTopInScrollPx: number;
  scrollerScrollTopPx: number;
  scrollerClientHeightPx: number;
  scrollerScrollHeightPx: number;
  topBoundaryPx: number;
  bottomBoundaryPx: number;
  lineHeightPx: number;
  // Row 0's absolute-content-Y offset beyond topBoundaryPx -- 0 for
  // Lexical/Editor.tsx, which has no such offset; CM6Editor.tsx passes
  // halfLineHeightPx here since its contentDOM padding-top is
  // topBoundaryPx + halfLineHeightPx (the "infinity grid" edge-breathing-
  // room shift), so every real row's true position is half a line below
  // where a phase-0 grid would put it. Used in two places below, NOT
  // uniformly: quantizing the caret's OWN row (a real, measured DOM
  // position) always needs it, or rounding lands on the wrong neighboring
  // row whenever this offset is exactly half a line (real rows then sit
  // precisely on the phase-0 rounding tie line -- confirmed live as the
  // "arrow-up back to document start" caret-refocus caging bug, scrollTop
  // settling on a small nonzero value instead of 0). The cage's OWN
  // threshold/target positions (cageTopInScrollPx, lastRowTopOffsetPx)
  // stay phase-0: those are screen-anchored (viewport pixel offsets
  // converted to absolute-Y via + scrollTop), not content-row positions,
  // so they don't carry this offset themselves -- confirmed live too:
  // adding it there over-scrolled by exactly this offset every reconcile,
  // fighting CM6's own native scroll-into-view every keystroke.
  rowPhaseOffsetPx?: number;
}

interface ResolveCagedScrollTargetResult {
  targetScrollTopPx: number;
}

export function resolveCagedScrollTarget(
  input: ResolveCagedScrollTargetInput,
): ResolveCagedScrollTargetResult {
  const {
    caretTopInScrollPx,
    scrollerScrollTopPx,
    scrollerClientHeightPx,
    scrollerScrollHeightPx,
    topBoundaryPx,
    bottomBoundaryPx,
    lineHeightPx,
    rowPhaseOffsetPx = 0,
  } = input;

  const maxScrollTopPx = Math.max(0, scrollerScrollHeightPx - scrollerClientHeightPx);
  // Math.round, not Math.floor: matches the row BlockCaretPlugin itself
  // resolves the caret onto (see its own quantizedRowTopInScroll comment).
  // Font baseline/hinting jitter can put the measured caret top a hair on
  // either side of a row's clean multiple of lineHeightPx; flooring only
  // tolerates the overshoot direction; a value one row's-and-a-hair *before*
  // the boundary (as at the join between one full-width line and the start
  // of the next) floors to the previous row. When that previous row sits at
  // the cage's edge, this function and BlockCaretPlugin's own row calc then
  // disagree about whether a scroll is needed, and BlockCaretPlugin's
  // "hide caret until the caged scroll settles" guard never sees its target
  // scrollTop match the actual one -- the caret stays hidden indefinitely.
  //
  // rowPhaseOffsetPx shifts the rounding reference point to match where
  // real rows actually sit (see this input's own doc comment) -- without
  // it, a caller with a half-line offset would round every real row
  // position to the wrong neighboring row.
  const quantizedRowTopPx = rowPhaseOffsetPx
    + Math.round((caretTopInScrollPx - rowPhaseOffsetPx) / lineHeightPx) * lineHeightPx;

  const cageTopInScrollPx = scrollerScrollTopPx + topBoundaryPx;
  const lastRowTopOffsetPx = Math.max(
    topBoundaryPx,
    scrollerClientHeightPx - bottomBoundaryPx - lineHeightPx,
  );
  const cageLastRowTopInScrollPx = scrollerScrollTopPx + lastRowTopOffsetPx;

  let targetScrollTopPx = scrollerScrollTopPx;

  if (quantizedRowTopPx < cageTopInScrollPx) {
    // Place caret exactly on the first row of the middle section -- at its
    // natural resting position (topBoundaryPx + rowPhaseOffsetPx below the
    // viewport top), not flush against topBoundaryPx, so this matches
    // where the row already sits by construction rather than fighting it.
    //
    // From the caret's MEASURED position, not from its rounded one. The
    // rounded value is right for deciding whether the caret has left the
    // cage -- that is a comparison, and a hair of baseline jitter should not
    // change the answer -- but wrong for computing where to land, because
    // rounding introduces an error the reader then sees. Where the caret
    // actually is minus where it should sit is the whole calculation, and it
    // needs no quantization to come out on a row: if the caret is on a real
    // row and the target is a real row, their difference is a whole number
    // of rows already. Quantizing it can only move the answer AWAY from that,
    // by up to half a row per press, in whichever direction the rounding
    // happens to favour -- and a bias that favours one direction accumulates
    // into the multi-row skips reported here.
    targetScrollTopPx = caretTopInScrollPx - topBoundaryPx - rowPhaseOffsetPx;
  } else if (quantizedRowTopPx > cageLastRowTopInScrollPx) {
    // Place caret exactly on the last row of the middle section. No
    // rowPhaseOffsetPx term here: lastRowTopOffsetPx is a screen-anchored
    // target position (fit one more full row above the bottom boundary),
    // not a content-row position -- it was never phase-0 by virtue of
    // representing an actual row, so it doesn't carry the offset.
    //
    // Math.ceil, not round: lastRowTopOffsetPx is derived from
    // scrollerClientHeightPx, an arbitrary window/pane pixel height with no
    // reason to be a multiple of lineHeightPx, so the raw target here
    // essentially never lands on one either. Rounding to the NEAREST
    // multiple can come up short by as much as half a row, clipping the
    // very last row this branch exists to keep fully visible -- confirmed
    // live: CM6's own native scroll-into-view then immediately re-corrects
    // the clipped row on every subsequent keystroke, which this reconcile
    // then immediately undoes again, an infinite fight. Rounding up costs
    // at most a few px of extra clearance above the boundary; rounding
    // down risked cutting off real text.
    targetScrollTopPx = Math.ceil((quantizedRowTopPx - lastRowTopOffsetPx) / lineHeightPx) * lineHeightPx;
  } else {
    targetScrollTopPx = Math.round(targetScrollTopPx / lineHeightPx) * lineHeightPx;
  }

  targetScrollTopPx = Math.max(0, Math.min(maxScrollTopPx, targetScrollTopPx));

  return {
    targetScrollTopPx,
  };
}
