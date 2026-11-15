/** Gap between a tooltip and the element it describes. */
const GAP_PX = 6

export interface AnchorRect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Where a bubble of the MEASURED size goes: centred on the anchor, above it if
 * it fits there and below otherwise, then clamped so the whole box keeps
 * `margin` to every window edge. The bubble's CSS max-width already leaves
 * room for both side margins, so the clamp can always be satisfied
 * horizontally; vertically it can only fail for a tooltip taller than the
 * window, which is then pinned to the top margin.
 */
export function placeTooltip(
  anchor: AnchorRect,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  margin: number,
): { left: number; top: number } {
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
  const centreX = (anchor.left + anchor.right) / 2
  const left = clamp(centreX - width / 2, margin, viewportWidth - margin - width)
  const above = anchor.top - GAP_PX - height
  const below = anchor.bottom + GAP_PX
  const preferred = above >= margin ? above : below
  const top = Math.max(margin, Math.min(viewportHeight - margin - height, preferred))
  return { left, top }
}
