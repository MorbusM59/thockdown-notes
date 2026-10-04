// One owner for `scroll-behavior`, however many things want it at once.
//
// ## The bug this exists to make impossible
//
// `.markdown-preview` carries `scroll-behavior: smooth` in CSS, so every
// programmatic write to `scrollTop` is animated by the browser unless the
// property is overridden. Anything that drives its own animation therefore
// borrows `auto` for the length of its run: save the inline value, set
// `auto`, put the old value back when finished.
//
// That is correct for one borrower and wrong for two. The render view has
// four that outlive a frame -- a journey, a wheel glide or coast, a held
// page key, a thumb drag -- and they overlap constantly. Two of them
// overlapping produces one of two failures, and the app shipped both:
//
//   * the inner borrower finishes first and hands the property back to what
//     it found, which is the OUTER borrower's `auto` -- so the pane is left
//     on `auto` for good and the CSS never applies again;
//   * the outer borrower finishes first and restores the real value while
//     the inner one is still animating -- so every remaining write is
//     natively smooth-scrolled, each frame retargeting the last. Measured:
//     a 400px journey that should run 0-19-65-201-336-382-397-400 instead
//     moved four pixels and stopped. It reads as a short nudge in the right
//     direction that gives up, which is exactly what it is.
//
// The second is what a wheel gesture followed by a scrollbar click did every
// single time, because the glide's teardown fires precisely when it notices
// a journey has taken the scroller.
//
// ## What this does instead
//
// The property has one owner -- this module -- and callers take a borrow
// against it. The first borrow records the real inline value and sets `auto`;
// the last release puts the real value back. In between, nothing else
// touches it, so no borrower can hand back a value that belonged to another
// one, and no borrower can have the property pulled out from under it.
//
// Releases are idempotent, because teardown paths here are reached from
// several directions (a frame loop finishing, a cancel, an unmount) and
// double-releasing must not unbalance the count for everyone else.
//
// Synchronous save-set-restore around a single write does not need this: no
// other borrower can interleave with it, and whatever it saves is whatever
// it restores. Only borrows that outlive a frame do.

interface ScrollBehaviorBorrow {
  count: number
  /** The inline value from before anybody borrowed. */
  previous: string
}

const borrows = new WeakMap<HTMLElement, ScrollBehaviorBorrow>()

/**
 * Hold `scroll-behavior: auto` on `element` until the returned function runs.
 *
 * Safe to nest and to overlap with any other borrower. Calling the returned
 * release more than once is a no-op.
 */
export function borrowAutoScrollBehavior(element: HTMLElement): () => void {
  let entry = borrows.get(element)
  if (!entry) {
    entry = { count: 0, previous: element.style.scrollBehavior }
    borrows.set(element, entry)
  }
  entry.count += 1
  element.style.scrollBehavior = 'auto'

  let released = false
  return () => {
    if (released) return
    released = true
    const current = borrows.get(element)
    if (!current) return
    current.count -= 1
    if (current.count > 0) return
    borrows.delete(element)
    element.style.scrollBehavior = current.previous
  }
}

/** Whether anything currently holds the property. For traces and assertions. */
export function isScrollBehaviorBorrowed(element: HTMLElement): boolean {
  const entry = borrows.get(element)
  return entry !== undefined && entry.count > 0
}
