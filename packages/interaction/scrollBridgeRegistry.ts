/**
 * Where a smooth-scroll journey finds the curtain it draws over a long jump.
 *
 * The scroll engines in this package cut a long journey short under a cover
 * (a "bridge") so the reader sees motion rather than a teleport. What the cover
 * looks like is the host app's business -- the desktop paints a texture of the
 * note's own typography -- so the engines see only this interface, and a
 * scroller with no provider registered simply travels uncovered.
 */

export interface ScrollBridge {
  /**
   * Opens the curtain for a journey.
   *
   * Returns the distance it will actually take to sweep through, which may be
   * longer than asked: the band has to be at least a viewport tall to cover
   * anything, and the sweep has to be at least a viewport longer than that.
   * Returns null when no curtain can be drawn, which the caller must treat as
   * "do not cut" rather than cutting without cover.
   */
  begin: (requestedDistancePx: number, direction: -1 | 1) => number | null
  /** Moves the curtain to `travelledPx` into its sweep. */
  advance: (travelledPx: number) => void
  /**
   * Re-sizes the sweep once its true length is known.
   *
   * The curtain has to stop covering exactly when real text becomes available
   * again, and how far away that is depends on where the journey lands --
   * which is not known until the cut, because the cut is what decides it. So
   * the band opens at its longest and is trimmed here.
   *
   * Legal only while fully covering, which is when the cut happens: the band
   * is trimmed from its trailing edge, and that edge is below the pane. A
   * caller that resized at any other moment would be dragging a visible edge
   * across the reader's view.
   */
  resizeSweep: (sweepPx: number) => number
  /** Whether the viewport is fully covered, and so safe to jump underneath. */
  isCovering: (travelledPx: number) => boolean
  end: () => void
}

const providers = new WeakMap<HTMLElement, () => ScrollBridge | null>()

/** Registers how to open a bridge for `scroller`. Returns a function that unregisters it. */
export function provideScrollBridge(scroller: HTMLElement, open: () => ScrollBridge | null): () => void {
  providers.set(scroller, open)
  return () => {
    if (providers.get(scroller) === open) providers.delete(scroller)
  }
}

/** The bridge for a scroller, or null if nothing has registered one. */
export function resolveScrollBridge(scroller: HTMLElement): ScrollBridge | null {
  return providers.get(scroller)?.() ?? null
}
