/**
 * The one record of which scrollers have a curve-driven scroll in flight.
 *
 * Both scroll engines -- the render view's (`NonQuantizedSmoothScroll.ts`)
 * and the edit view's row-grid engine (`apps/notes/src/editor/
 * QuantizedSmoothScroll.ts`) -- register their animations here rather than in
 * a map of their own. An element can only be scrolled toward one place at a
 * time, so "is this scroller travelling" and "stop whatever is moving it" are
 * facts about the ELEMENT, not about which engine started the travel: with a
 * map per engine, a travel started by one engine would not cancel one the
 * other engine had in flight on the same element, and both would write
 * `scrollTop` every frame.
 */
export interface SmoothScrollAnimation {
  rafId: number;
  targetScrollTopPx: number;
  releaseScrollBehavior: () => void;
  /**
   * Torn down however the animation ends. A bridged journey puts a curtain in
   * the DOM for the length of the cut, and the reader may interrupt a journey
   * at any moment, so the teardown lives where every exit path meets.
   */
  onCancel?: () => void;
}

const activeAnimations = new WeakMap<HTMLElement, SmoothScrollAnimation>();

/** The animation in flight on `scroller`, if any, from either engine. */
export function activeSmoothScroll(scroller: HTMLElement): SmoothScrollAnimation | undefined {
  return activeAnimations.get(scroller);
}

/** Records the animation now driving `scroller` (called once per frame). */
export function registerSmoothScroll(scroller: HTMLElement, animation: SmoothScrollAnimation): void {
  activeAnimations.set(scroller, animation);
}

/** Forgets an animation that finished on its own; its owner has already cleaned up. */
export function unregisterSmoothScroll(scroller: HTMLElement): void {
  activeAnimations.delete(scroller);
}

/** Stops whatever travel is moving `scroller`, whichever engine started it. */
export function cancelSmoothScroll(scroller: HTMLElement): void {
  const current = activeAnimations.get(scroller);
  if (!current) return;
  cancelAnimationFrame(current.rafId);
  current.onCancel?.();
  current.releaseScrollBehavior();
  activeAnimations.delete(scroller);
}

/**
 * Whether a curve-driven scroll is in flight for `scroller`.
 *
 * Every frame of an in-flight animation recomputes `scrollTop` from the start
 * position and target captured when it was planned, so any scroll write from
 * elsewhere is discarded on the very next frame and the animation still lands
 * on its own original target. Anything that scrolls this element for its own
 * reasons while a travel may be running -- the preview pane's anchor and find
 * landings, which scroll to a block and then correct onto the exact element
 * inside it -- has to wait for this to go false, or its correction is a no-op
 * precisely when it succeeds.
 */
export function isSmoothScrollActive(scroller: HTMLElement): boolean {
  return activeAnimations.has(scroller);
}
