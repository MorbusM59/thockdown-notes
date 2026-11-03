// How long a hold has to last, and what happens when it does.
//
// Every press-and-hold gesture in the app used to carry its own threshold,
// each chosen on its own day: 200, 200, 250, 300, 500, 550, 700, 1000. None
// of those numbers disagreed with each other on purpose, and holding two
// controls that mean the same kind of thing should not feel different.
//
// There are two kinds, and only two:
//
// - CONFIRM -- "I meant this one, not the one next to it." Arming a purge,
//   splitting a chapter pill, snapping a scrollbar instead of travelling,
//   copying a colour. Long enough that an ordinary click cannot reach it,
//   short enough that it never feels like waiting.
// - COMMIT -- "I know this is not undoable." Pinning, branching, merging,
//   purging a song from the library. Long enough that the pause itself is
//   the warning.
//
// A third number would mean a third kind, and there is not one. If a gesture
// seems to want its own, the question to answer first is which of these two
// it actually is.

//
// A HOLD IS HELD IN PLACE. A press that travels while it is down is a drag,
// not a hold, so a hold whose pointer leaves a small grace radius around
// where it landed is abandoned on the spot (`armHold` watches the pointer
// itself), and leaving that same radius is what starts a drag
// (`apps/notes/src/shared/pointerDrag.ts`). One radius for both, so there is
// no distance at which a press is neither, or both.

import { beginCursorHold, endCursorHold } from './cursorHoldFeedback'

/** A deliberate press: past this, it was not an ordinary click. */
export const HOLD_CONFIRM_MS = 250

/** An irreversible press: the wait is the confirmation. */
export const HOLD_COMMIT_MS = 550

/**
 * How far a mouse or pen press may travel, in SCREEN pixels (a distance the
 * hand travels, the same at every zoom), and still be held in place.
 */
export const HOLD_GRACE_PX = 5

/**
 * The same for a finger, in CSS pixels. Larger, because a fingertip is not a
 * point: its reported centre drifts by several pixels while it rests.
 */
export const HOLD_GRACE_TOUCH_PX = 10

/** Where a press landed: what `hasLeftHoldGrace` measures from. */
export interface PressOrigin {
  readonly pointerType: string
  readonly screenX: number
  readonly screenY: number
  readonly clientX: number
  readonly clientY: number
}

/** Has a press that landed at `origin` and is now at `at` left its grace radius? */
export function hasLeftHoldGrace(origin: PressOrigin, at: { screenX: number; screenY: number; clientX: number; clientY: number }): boolean {
  if (origin.pointerType === 'touch') return Math.hypot(at.clientX - origin.clientX, at.clientY - origin.clientY) > HOLD_GRACE_TOUCH_PX
  return Math.hypot(at.screenX - origin.screenX, at.screenY - origin.screenY) >= HOLD_GRACE_PX
}

interface Press extends PressOrigin {
  readonly pointerId: number
  /** A hold completed during this press: it was held in place, not dragged. */
  holdCompleted: boolean
}

/**
 * The presses currently down, recorded in the window's capture phase so they
 * are known before any control's own `pointerdown` handler arms a hold.
 */
const presses = new Map<number, Press>()
let latestPress: Press | null = null

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (event) => {
    const press: Press = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      screenX: event.screenX,
      screenY: event.screenY,
      clientX: event.clientX,
      clientY: event.clientY,
      holdCompleted: false,
    }
    presses.set(event.pointerId, press)
    latestPress = press
  }, true)
  const release = (event: PointerEvent) => {
    presses.delete(event.pointerId)
    if (latestPress?.pointerId === event.pointerId) latestPress = null
  }
  window.addEventListener('pointerup', release, true)
  window.addEventListener('pointercancel', release, true)
}

/** Did a hold complete during the press of `pointerId`, still down? */
export function holdCompletedDuringPress(pointerId: number): boolean {
  return presses.get(pointerId)?.holdCompleted === true
}

/**
 * Arms a hold, returning the function that abandons it.
 *
 * A drop-in for the `window.setTimeout` every one of these gestures was
 * already doing, with two things folded in that were previously each site's
 * own business: the threshold comes from the two constants above, and the
 * gesture announces itself to the custom cursor
 * (`shared/cursorHoldFeedback.ts`) -- the halo swells while it runs and the
 * orbit twitches when it lands.
 *
 * That second part is why this exists rather than a bare constant. Wiring the
 * cursor at each of the nine call sites would make "and tell the cursor" a
 * thing to remember, which is the failure this codebase keeps repeating; here
 * a gesture cannot run, complete or be abandoned without saying so.
 *
 * `settled` is what makes begin and end exactly paired, once, whatever the
 * caller does: several sites cancel unconditionally on release, including
 * after the hold already fired (`editor/scrollTrackHold.ts` cleans up from
 * inside its own completion), and a second end would retract a swell that
 * belongs to a hold still running underneath it.
 *
 * The cursor is told before `onComplete` runs, deliberately: it acknowledges
 * the GESTURE, which happened whatever the action then does or throws.
 */
export function armHold(onComplete: () => void, holdMs: number = HOLD_CONFIRM_MS, options: { isDragPickup?: boolean } = {}): () => void {
  let settled = false
  beginCursorHold(holdMs)

  // The press this hold belongs to, if a pointer is down: a key hold has none
  // and nothing to leave.
  const press = latestPress
  const onMove = (event: PointerEvent) => {
    if (press && event.pointerId === press.pointerId && hasLeftHoldGrace(press, event)) abandon()
  }
  if (press) window.addEventListener('pointermove', onMove, true)

  const timerId = window.setTimeout(() => {
    if (settled) return
    settled = true
    if (press) window.removeEventListener('pointermove', onMove, true)
    // Picking a drag up is not a hold that claims the press: it is the drag's
    // own way of starting on a touch screen, and must not stop itself.
    if (press && !options.isDragPickup) press.holdCompleted = true
    endCursorHold(true)
    onComplete()
  }, holdMs)

  const abandon = () => {
    if (settled) return
    settled = true
    window.clearTimeout(timerId)
    if (press) window.removeEventListener('pointermove', onMove, true)
    endCursorHold(false)
  }
  return abandon
}
