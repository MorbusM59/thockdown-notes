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
  const quantizedRowTopPx = Math.floor(caretTopInScrollPx / lineHeightPx) * lineHeightPx;

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
