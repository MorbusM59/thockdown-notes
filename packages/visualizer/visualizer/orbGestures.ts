/**
 * THE ORB AS A TOUCH CONTROL: what a finger on the visualizer's cutout means,
 * where an app supplies it (`VisualizerScene`'s `orbGestures`, the phone's
 * visualizer page). Without it the cutout keeps the desktop's presses (a left
 * press steps the soundstage forward, a right press back).
 *
 * One press is exactly one of three gestures, decided by the touch rules every
 * hold in the app shares (`holdTiming.ts`): a finger that leaves the grace
 * radius is a SWIPE, its direction the dominant axis of where it lifted
 * (`swipeDirection`); one held still inside it for `HOLD_CONFIRM_MS` is a
 * HOLD, fired while the finger is still down, the same threshold as the
 * dashboard's transport hold that does the same thing; anything else lifted
 * is a TAP. A swipe abandons the hold (`armHold` watches the grace radius
 * itself), and a completed hold takes the press, so its lift is nothing.
 */
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { armHold, hasLeftHoldGrace, HOLD_CONFIRM_MS, type PressOrigin } from '@thockdown/interaction/holdTiming'

export type OrbSwipe = 'left' | 'right' | 'up' | 'down'

/** What the app does with each gesture on the orb. */
export interface OrbGestures {
  tap: () => void
  hold: () => void
  swipe: (direction: OrbSwipe) => void
}

/** The direction of a swipe that travelled `dx`, `dy` (screen axes, y down): its dominant axis, a tie going horizontal. */
export function swipeDirection(dx: number, dy: number): OrbSwipe {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'down' : 'up'
}

interface OrbPress {
  readonly origin: PressOrigin & { readonly pointerId: number }
  swiped: boolean
  held: boolean
  abandonHold: () => void
}

/** The pointer handlers that turn presses on the orb into `gestures`, read live so a new set of handlers needs no new press. */
export function useOrbGestures(gestures: OrbGestures) {
  const gesturesRef = useRef(gestures)
  gesturesRef.current = gestures
  const pressRef = useRef<OrbPress | null>(null)
  useEffect(() => () => pressRef.current?.abandonHold(), [])

  const end = () => {
    pressRef.current?.abandonHold()
    pressRef.current = null
  }
  return {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (!event.isPrimary || event.button !== 0) return
      end()
      // The press is the orb's for its whole length, even once the finger has slid off it.
      event.currentTarget.setPointerCapture?.(event.pointerId)
      const press: OrbPress = {
        origin: { pointerId: event.pointerId, pointerType: event.pointerType, screenX: event.screenX, screenY: event.screenY, clientX: event.clientX, clientY: event.clientY },
        swiped: false,
        held: false,
        abandonHold: () => {},
      }
      press.abandonHold = armHold(() => {
        press.held = true
        gesturesRef.current.hold()
      }, HOLD_CONFIRM_MS)
      pressRef.current = press
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const press = pressRef.current
      if (!press || press.held || press.swiped || event.pointerId !== press.origin.pointerId) return
      if (hasLeftHoldGrace(press.origin, event)) press.swiped = true
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      const press = pressRef.current
      if (!press || event.pointerId !== press.origin.pointerId) return
      end()
      if (press.held) return
      if (press.swiped || hasLeftHoldGrace(press.origin, event)) {
        gesturesRef.current.swipe(swipeDirection(event.clientX - press.origin.clientX, event.clientY - press.origin.clientY))
      } else {
        gesturesRef.current.tap()
      }
    },
    // A cancelled press (the system took the finger) does nothing.
    onPointerCancel: end,
  }
}
