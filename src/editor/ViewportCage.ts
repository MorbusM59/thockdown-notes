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
  const { scrollTop, maxScrollTop, topBoundaryPx, bottomBoundaryPx } = input;
  const atTopEdge = scrollTop <= 0;
  const atBottomEdge = scrollTop >= maxScrollTop;

  return {
    // At absolute document edges we relax the cage so the terminal line is reachable.
    topPx: atTopEdge ? 0 : topBoundaryPx,
    bottomPx: atBottomEdge ? 0 : bottomBoundaryPx,
  };
}
