/**
 * A finger scrolls the page, except where it has been given to a control.
 *
 * The page cannot leave this to the browser: nearly everything on it is a
 * control, and the browser decides "pan" on the first movement, before a
 * control can say whether the press is its own. So the scroller is
 * `touch-action: none` and this module decides, ONCE per touch, at the moment
 * the finger leaves the tap radius (`HOLD_GRACE_TOUCH_PX`):
 *
 * - a HOLD has already completed on the press (`pressTakenByHold`: a drag
 *   picked up, a channel turned on, a soundscape picked up): the control
 *   keeps the finger, whatever direction it then moves;
 * - the press is on a SLIDER (`[data-touch-slider]`, which needs no hold)
 *   and the move is not vertical: the slider keeps it;
 * - otherwise it is a SWIPE: the control gets a `pointercancel` (the app's
 *   one way of abandoning a press, which every press handler already obeys)
 *   and sees nothing more of this finger, and the page scrolls with it, and
 *   coasts on when it is lifted while still moving.
 *
 * VERTICAL is `|dy| > VERTICAL_RATIO * |dx|`, measured from where the finger
 * landed to where it left the radius. Until the decision nothing is taken
 * from the control, so a tap stays a tap and a hold still runs; a control
 * that needs no hold therefore must not act on movement inside the radius
 * (the slider does not, on touch).
 */
import { HOLD_GRACE_TOUCH_PX, pressTakenByHold } from './holdTiming'

/** A move is vertical when its rise is more than this many times its run. */
export const VERTICAL_RATIO = 2

/** How quickly a coast slows: its speed falls by e every this many milliseconds. */
const COAST_TIME_CONSTANT_MS = 325
/** A coast slower than this (px per ms) is over; a lift slower than it does not coast. */
const COAST_MIN_SPEED = 0.05
/** The finger's speed at the lift is taken over this much of its last movement. */
const VELOCITY_WINDOW_MS = 80

export type TouchOwner = 'control' | 'scroll'

/** Who owns a touch that has left the tap radius by (dx, dy). Pure: the rule above. */
export function touchOwner(dx: number, dy: number, taken: boolean, onSlider: boolean): TouchOwner {
  if (taken) return 'control'
  const vertical = Math.abs(dy) > VERTICAL_RATIO * Math.abs(dx)
  if (onSlider && !vertical) return 'control'
  return 'scroll'
}

interface Touch {
  readonly pointerId: number
  readonly x: number
  readonly y: number
  readonly target: Element
  owner: TouchOwner | null
  lastY: number
  /** Recent positions while scrolling, for the speed at the lift. */
  samples: Array<{ y: number; t: number }>
}

/** Take fingers on `scroller` as described above. Returns the uninstaller. */
export function installTouchScroll(scroller: HTMLElement): () => void {
  let touch: Touch | null = null
  let coastFrame: number | null = null
  /** A click following a swipe's lift is the swipe's, not a tap. */
  let swallowClickUntil = 0
  /** Set while this module dispatches its own `pointercancel`, which its own listener must not take as the finger's. */
  let cancelling = false

  const stopCoast = () => {
    if (coastFrame !== null) cancelAnimationFrame(coastFrame)
    coastFrame = null
  }

  const coast = (speed: number) => {
    let last = performance.now()
    const frame = (now: number) => {
      const elapsed = now - last
      last = now
      const before = scroller.scrollTop
      scroller.scrollTop += speed * elapsed
      speed *= Math.exp(-elapsed / COAST_TIME_CONSTANT_MS)
      // At either end, or slow enough to read as stopped: done.
      if (Math.abs(speed) < COAST_MIN_SPEED || scroller.scrollTop === before) {
        coastFrame = null
        return
      }
      coastFrame = requestAnimationFrame(frame)
    }
    coastFrame = requestAnimationFrame(frame)
  }

  const takeFromControl = (current: Touch) => {
    for (let element: Element | null = current.target; element; element = element.parentElement) {
      if (element.hasPointerCapture?.(current.pointerId)) element.releasePointerCapture(current.pointerId)
    }
    cancelling = true
    try {
      current.target.dispatchEvent(new PointerEvent('pointercancel', {
        pointerId: current.pointerId, pointerType: 'touch', isPrimary: true, bubbles: true,
        clientX: current.x, clientY: current.lastY,
      }))
    } finally {
      cancelling = false
    }
  }

  const onDown = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') return
    // A finger landing stops a coast, as on any scrolling surface.
    stopCoast()
    const target = event.target as Element | null
    if (!event.isPrimary || !target || !scroller.contains(target)) {
      touch = null
      return
    }
    touch = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, target, owner: null, lastY: event.clientY, samples: [] }
  }

  const onMove = (event: PointerEvent) => {
    const current = touch
    if (!current || event.pointerId !== current.pointerId) return
    if (current.owner === null) {
      const dx = event.clientX - current.x
      const dy = event.clientY - current.y
      if (Math.hypot(dx, dy) <= HOLD_GRACE_TOUCH_PX) return
      current.owner = touchOwner(dx, dy, pressTakenByHold(current.pointerId), current.target.closest('[data-touch-slider]') !== null)
      if (current.owner === 'control') return
      takeFromControl(current)
    }
    if (current.owner !== 'scroll') return
    event.stopImmediatePropagation()
    event.preventDefault()
    scroller.scrollTop += current.lastY - event.clientY
    current.lastY = event.clientY
    current.samples.push({ y: event.clientY, t: event.timeStamp })
    while (current.samples.length > 2 && event.timeStamp - current.samples[0].t > VELOCITY_WINDOW_MS) current.samples.shift()
  }

  const onEnd = (event: PointerEvent) => {
    if (cancelling) return
    const current = touch
    if (!current || event.pointerId !== current.pointerId) return
    touch = null
    if (current.owner !== 'scroll') return
    event.stopImmediatePropagation()
    swallowClickUntil = event.timeStamp + 500
    if (event.type !== 'pointerup') return
    const first = current.samples[0]
    const last = current.samples[current.samples.length - 1]
    // A finger that stopped before it lifted has asked for nothing more.
    if (!first || !last || last === first || event.timeStamp - last.t > VELOCITY_WINDOW_MS) return
    const speed = (first.y - last.y) / (last.t - first.t)
    if (Math.abs(speed) >= COAST_MIN_SPEED) coast(speed)
  }

  const onClick = (event: MouseEvent) => {
    if (event.timeStamp > swallowClickUntil) return
    swallowClickUntil = 0
    event.stopImmediatePropagation()
    event.preventDefault()
  }

  window.addEventListener('pointerdown', onDown, true)
  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onEnd, true)
  window.addEventListener('pointercancel', onEnd, true)
  window.addEventListener('click', onClick, true)
  return () => {
    stopCoast()
    window.removeEventListener('pointerdown', onDown, true)
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onEnd, true)
    window.removeEventListener('pointercancel', onEnd, true)
    window.removeEventListener('click', onClick, true)
  }
}
