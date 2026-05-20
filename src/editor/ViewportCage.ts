interface CageBoundaryInput {
  scrollTop: number;
  maxScrollTop: number;
  topBoundaryPx: number;
  bottomBoundaryPx: number;
}

export interface EffectiveCageBoundaries {
  topPx: number;
  bottomPx: number;
}

export function getEffectiveCageBoundaries(input: CageBoundaryInput): EffectiveCageBoundaries {
  const { topBoundaryPx, bottomBoundaryPx } = input;

  return {
    // The middle section boundaries are fixed; scroll range is handled by content padding.
    topPx: topBoundaryPx,
    bottomPx: bottomBoundaryPx,
  };
}
