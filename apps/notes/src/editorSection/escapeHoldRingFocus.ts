// WHERE THE KEYBOARD GOES when a slot's interface is a ring rather than an
// editor. Its own module because two components need it and they must not
// disagree: the panel, recovering focus that landed nowhere, and the
// backdrop, which is a click inside the ring's slot and therefore the ring's.
/** The ring element, for anything that has to find one from outside. */
const RING_SELECTOR = '.editor-escape-hold-ring'

/**
 * GIVE THE RING THE KEYBOARD -- the one expression for it, because there are
 * two places that have to and they must not disagree about which cell.
 *
 * `root` is the ring itself or anything containing it, so a caller that holds
 * the slot (the backdrop, which only knows its stage) and the ring's own
 * recovery path can both use it.
 *
 * The cell is the one the roving tabindex already names, never index 0: the
 * ring's focus is a POSITION the reader moved to, and putting the keyboard
 * back should hand it back where they left it rather than reset the dial.
 */
export function focusEscapeHoldRing(root: HTMLElement | null): void {
  if (!root) return
  const ring = root.matches(RING_SELECTOR) ? root : root.querySelector<HTMLElement>(RING_SELECTOR)
  ring?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus()
}
