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
  const quantizedRowBottomPx = quantizedRowTopPx + lineHeightPx;

  const cageTopInScrollPx = scrollerScrollTopPx + topBoundaryPx;
  const cageBottomInScrollPx = scrollerScrollTopPx + scrollerClientHeightPx - bottomBoundaryPx;

  let targetScrollTopPx = scrollerScrollTopPx;

  if (quantizedRowTopPx < cageTopInScrollPx) {
    const differencePx = cageTopInScrollPx - quantizedRowTopPx;
    const rows = Math.ceil(differencePx / lineHeightPx);
    targetScrollTopPx -= rows * lineHeightPx;
  } else if (quantizedRowBottomPx > cageBottomInScrollPx) {
    const differencePx = quantizedRowBottomPx - cageBottomInScrollPx;
    const rows = Math.ceil(differencePx / lineHeightPx);
    targetScrollTopPx += rows * lineHeightPx;
  }

  targetScrollTopPx = Math.round(targetScrollTopPx / lineHeightPx) * lineHeightPx;
  targetScrollTopPx = Math.max(0, Math.min(maxScrollTopPx, targetScrollTopPx));

  return {
    targetScrollTopPx,
  };
}
