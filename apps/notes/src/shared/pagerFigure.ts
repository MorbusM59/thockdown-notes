/** The largest number a pager, or a paged list's thumb, writes out. */
export const PAGER_MAX_FIGURE = 99

/** A count as the pager writes it: plain figures up to PAGER_MAX_FIGURE, "..." past it. */
export function pagerFigure(value: number): string {
  return value > PAGER_MAX_FIGURE ? '...' : String(value)
}
