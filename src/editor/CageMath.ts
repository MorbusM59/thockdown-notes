interface ResolveCagedScrollTargetInput {
  caretTopInScrollPx: number;
  scrollerScrollTopPx: number;
  scrollerClientHeightPx: number;
  scrollerScrollHeightPx: number;
  topBoundaryPx: number;
  bottomBoundaryPx: number;
  lineHeightPx: number;
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
  const quantizedRowTopPx = Math.round(caretTopInScrollPx / lineHeightPx) * lineHeightPx;

  const cageTopInScrollPx = scrollerScrollTopPx + topBoundaryPx;
  const lastRowTopOffsetPx = Math.max(
    topBoundaryPx,
    scrollerClientHeightPx - bottomBoundaryPx - lineHeightPx,
  );
  const cageLastRowTopInScrollPx = scrollerScrollTopPx + lastRowTopOffsetPx;

  let targetScrollTopPx = scrollerScrollTopPx;

  if (quantizedRowTopPx < cageTopInScrollPx) {
    // Place caret exactly on the first row of the middle section.
    targetScrollTopPx = quantizedRowTopPx - topBoundaryPx;
  } else if (quantizedRowTopPx > cageLastRowTopInScrollPx) {
    // Place caret exactly on the last row of the middle section.
    targetScrollTopPx = quantizedRowTopPx - lastRowTopOffsetPx;
  }

  targetScrollTopPx = Math.round(targetScrollTopPx / lineHeightPx) * lineHeightPx;
  targetScrollTopPx = Math.max(0, Math.min(maxScrollTopPx, targetScrollTopPx));

  return {
    targetScrollTopPx,
  };
}
