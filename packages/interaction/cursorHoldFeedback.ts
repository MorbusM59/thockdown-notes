// What the custom cursor says about a hold gesture, from the press to the
// moment it resolves.
//
// A press-and-hold has two things worth saying and no natural way to say
// either. While it runs, nothing tells the reader that a gesture is under way
// at all, let alone how close it is to firing. And when it fires it fires
// while the button is still DOWN -- nothing clicks, nothing releases, and what
// it did may be off-screen or purely internal (a purge armed, a tab pinned, a
// scrollbar snapped). The cursor is the one surface every hold shares, so it
// carries both:
//
// - the HALO swells while the hold runs, reaching full extension exactly at
//   the threshold, so a partial swell means "not yet" (`begin`/`end`);
// - a TWITCH -- one brief excursion of the orbit AGAINST whatever the press is
//   doing to it -- fires the instant the hold completes (`end`, completed).
//
// They are one module and `end` takes one flag because they resolve together:
// a completed hold releases the halo AND twitches, an abandoned one only
// releases the halo. Two separate emitters would let a caller do one and
// forget the other, and "abandoned but twitched anyway" is exactly the wrong
// thing to be able to express.
//
// This module is only the wire. It carries no polarity, no strength and no
// shape: `MouseCursorOverlay` derives the twitch's direction from which way
// the press is currently deforming the orbit, and both curves from the user's
// own cursor settings. A caller that had to name its polarity would be a
// caller that can get it wrong -- and would have to know that a left press
// contracts, which is a fact about the cursor, not about the gesture.
//
// Emitting when no custom cursor is mounted is a no-op by construction rather
// than by a check at the call site.

/** How long this hold will take to complete, so the halo can land on it. */
export interface CursorHoldStart {
  holdMs: number
}

export interface CursorHoldEnd {
  /** True: it fired. False: released early, wandered off, window blurred. */
  completed: boolean
}

interface CursorHoldListener {
  onBegin(start: CursorHoldStart): void
  onEnd(end: CursorHoldEnd): void
}

const listeners = new Set<CursorHoldListener>()

/**
 * A hold gesture just started. Paired with exactly one `endCursorHold`,
 * guaranteed by `shared/holdTiming.ts`'s `armHold` -- which is the only
 * caller, apart from the one rAF-driven hold that cannot use a timer.
 *
 * Holds NEST: the temp tab arms a left pin-hold and a right unpin-hold on the
 * same press. The overlay counts them rather than tracking one, so the halo
 * stays up until the last of them resolves.
 */
export function beginCursorHold(holdMs: number): void {
  for (const listener of listeners) listener.onBegin({ holdMs })
}

/** That hold resolved, one way or the other. */
export function endCursorHold(completed: boolean): void {
  for (const listener of listeners) listener.onEnd({ completed })
}

/** Subscribes the mounted cursor overlay. Returns its own unsubscribe. */
export function subscribeCursorHoldFeedback(listener: CursorHoldListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
