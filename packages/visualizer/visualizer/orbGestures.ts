/**
 * THE ORB AS A TOUCH CONTROL: what a finger on the visualizer's cutout means,
 * where an app supplies it (`VisualizerScene`'s `orbGestures`, the phone's
 * visualizer page). Without it the cutout keeps the desktop's presses (a left
 * press steps the soundstage forward, a right press back).
 *
 * One press is exactly one of two gestures, decided by the grace radius every
 * press in the app shares (`holdTiming.ts`): a finger that leaves it is a
 * SWIPE, its direction the dominant axis of where it lifted
 * (`swipeDirection`); anything else lifted is a TAP, however long it was
 * held. A hold means nothing on the orb (the transport it mirrors has no
 * hold either).
 *
 * The spectrum takes its presses by the same rules (`VisualizerScene`'s
 * `SPECTRUM_GESTURES`), so a tap and a swipe mean the same distance and the
 * same time on both.
 */
import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { hasLeftHoldGrace, type PressOrigin } from '@thockdown/interaction/holdTiming'

export type OrbSwipe = 'left' | 'right' | 'up' | 'down'

/** What the app does with each gesture on the orb. */
export interface OrbGestures {
  tap: () => void
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
}

/** The pointer handlers that turn presses on the orb into `gestures`, read live so a new set of handlers needs no new press. */
export function useOrbGestures(gestures: OrbGestures) {
  const gesturesRef = useRef(gestures)
  gesturesRef.current = gestures
  const pressRef = useRef<OrbPress | null>(null)

  const end = () => {
    pressRef.current = null
  }
  return {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (!event.isPrimary || event.button !== 0) return
      end()
      // The press is the orb's for its whole length, even once the finger has slid off it.
      event.currentTarget.setPointerCapture?.(event.pointerId)
      pressRef.current = {
        origin: { pointerId: event.pointerId, pointerType: event.pointerType, screenX: event.screenX, screenY: event.screenY, clientX: event.clientX, clientY: event.clientY },
        swiped: false,
      }
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const press = pressRef.current
      if (!press || press.swiped || event.pointerId !== press.origin.pointerId) return
      if (hasLeftHoldGrace(press.origin, event)) press.swiped = true
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      const press = pressRef.current
      if (!press || event.pointerId !== press.origin.pointerId) return
      end()
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
