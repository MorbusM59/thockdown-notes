/**
 * Which folds (AccordionSection, AccordionDivider) are animating their height
 * right now, and the moment each one settles.
 *
 * A scrollbar sizes its thumb from its scroller's content height, and a fold
 * changes that height every frame for the length of its animation. Following
 * it frame by frame redrew the thumb on every one of those frames for a
 * height nobody was going to keep, and fought the fold for the frame. So a
 * scrollbar asks `isFoldMovingWithin(scroller)` and leaves the thumb as it is
 * while any fold inside it moves, and `subscribeFoldSettled` tells it the
 * moment one settles: the fold writes its final height and then announces,
 * from inside the same animation-frame callback, so the thumb is redrawn in
 * exactly the frame the content takes its final size.
 *
 * The register is the fold's, not the scrollbar's: a new scrollbar or a new
 * kind of fold reads the same answer without knowing about the other.
 */

const moving = new Set<Element>()
const settledListeners = new Set<(element: Element) => void>()

/**
 * Marks `element` (the fold's animated body) as moving. Returns the call that
 * ends it; that call is latched, so ending twice announces once.
 */
export function beginFoldMotion(element: Element): () => void {
  moving.add(element)
  let settled = false
  return () => {
    if (settled) return
    settled = true
    moving.delete(element)
    for (const listener of settledListeners) listener(element)
  }
}

/** Whether a fold inside `container` (or the container itself) is animating. */
export function isFoldMovingWithin(container: Element): boolean {
  for (const element of moving) {
    if (container.contains(element)) return true
  }
  return false
}

/** Told the fold body that settled, after its final height is written. */
export function subscribeFoldSettled(listener: (element: Element) => void): () => void {
  settledListeners.add(listener)
  return () => { settledListeners.delete(listener) }
}
