// Click-versus-hold on a scrollbar track.
//
// A left click on the track means "take me there". Two readings of that are
// both right, for different moods: travel there, so the reader keeps their
// bearings and sees what they are passing, or just BE there, because they know
// where they are going and the journey is in the way.
//
// Rather than a modifier key, the gesture itself distinguishes them: a normal
// click travels, and holding the button for a moment snaps. The hold fires on
// its own timer, not on release, so the snap happens *while the button is
// still down* -- that is what makes it discoverable. You hold, it jumps, and
// you have learned the gesture without being told.
//
// Shared by both scrollbars (render view's and the editor's) so the two cannot
// drift apart in feel; only what "snap" and "travel" mean differs between
// them, and that is the caller's business.

/**
 * How long the button must be held before the click becomes a snap.
 *
 * Long enough not to fire on an ordinary click (a deliberate click is well
 * under 200ms; a lazy one is around it), short enough that holding for a snap
 * does not feel like waiting.
 */
export const SCROLL_TRACK_SNAP_HOLD_MS = 250

export interface ScrollTrackHoldHandlers {
  /** The button was held past the threshold: go there now. */
  onSnap: () => void
  /** The button was released before the threshold: travel there. */
  onTravel: () => void
}

/**
 * Starts a click-or-hold gesture, returning a function that abandons it.
 *
 * Exactly one of the two handlers runs, and only if the gesture is neither
 * abandoned nor already resolved -- the release listener has to survive the
 * pointer leaving the track (a hold that wanders off the scrollbar is still a
 * hold), so it lives on the window and must clean itself up in every exit
 * path, including the caller unmounting mid-gesture.
 */
export function beginScrollTrackHold(handlers: ScrollTrackHoldHandlers): () => void {
  let resolved = false

  const cleanUp = () => {
    window.clearTimeout(timerId)
    window.removeEventListener('mouseup', onRelease)
    window.removeEventListener('blur', onAbandon)
  }

  const onRelease = () => {
    if (resolved) return
    resolved = true
    cleanUp()
    handlers.onTravel()
  }

  // The window losing focus mid-hold (an OS-level drag away, a shortcut that
  // opens something else) never delivers the mouseup, which would otherwise
  // leave the gesture armed and fire a snap the reader never asked for.
  const onAbandon = () => {
    if (resolved) return
    resolved = true
    cleanUp()
  }

  const timerId = window.setTimeout(() => {
    if (resolved) return
    resolved = true
    cleanUp()
    handlers.onSnap()
  }, SCROLL_TRACK_SNAP_HOLD_MS)

  window.addEventListener('mouseup', onRelease)
  window.addEventListener('blur', onAbandon)

  return onAbandon
}
