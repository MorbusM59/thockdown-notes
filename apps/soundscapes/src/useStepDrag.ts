/**
 * A button that is tapped, or dragged up and down through a list of values
 * (LookButton.tsx's looks, the clip button's lengths, the schedule's times).
 *
 * On touch, a drag needs a HOLD first (HOLD_CONFIRM_MS): a finger that moves
 * on without one is a swipe of the page (touchScroll.ts).
 *
 * Every such control feels alike: a press becomes a drag only once the
 * finger LEAVES THE BUTTON, a step is the button's own height measured from
 * where the press began (leaving is the first step, up is +1), and moving
 * back undoes steps. A release that never left the button is a tap, unless
 * the hold before a drag had completed.
 *
 * `adjusting` is true while a drag is under way and for SHOW_AFTER_DRAG_MS
 * after it, which is how long the button shows the value it was dragged to
 * before going back to its usual face.
 */
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { armTouchDragHold } from '@thockdown/interaction/holdTiming'

const SHOW_AFTER_DRAG_MS = 2000

interface StepPress<T> {
  pointerId: number
  y: number
  box: DOMRect
  base: T
  stepPx: number
  dragging: boolean
  /** The hold before a drag completed (touch). */
  held: boolean
}

export function useStepDrag<T>(options: {
  /** What a drag counts its steps from, read when the press begins. */
  begin: () => T
  /** The drag is `steps` steps from where it began (up positive). */
  step: (base: T, steps: number) => void
  tap: () => void
}) {
  const pressRef = useRef<StepPress<T> | null>(null)
  /** A finger's hold before a drag (armTouchDragHold); a swipe without it scrolls the page. */
  const dragHoldRef = useRef<(() => void) | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const [dragging, setDragging] = useState(false)
  const [lingering, setLingering] = useState(false)

  useEffect(() => {
    if (!lingering) return undefined
    const timer = window.setTimeout(() => setLingering(false), SHOW_AFTER_DRAG_MS)
    return () => window.clearTimeout(timer)
  }, [lingering])

  const handlers = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      dragHoldRef.current?.()
      const pointerId = event.pointerId
      dragHoldRef.current = event.pointerType === 'touch'
        ? armTouchDragHold(() => { if (pressRef.current?.pointerId === pointerId) pressRef.current.held = true })
        : null
      pressRef.current = {
        pointerId: event.pointerId,
        y: event.clientY,
        box: event.currentTarget.getBoundingClientRect(),
        base: optionsRef.current.begin(),
        stepPx: Math.max(1, event.currentTarget.offsetHeight),
        dragging: false,
        held: false,
      }
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const press = pressRef.current
      if (!press || press.pointerId !== event.pointerId) return
      if (!press.dragging) {
        const { box } = press
        if (event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom) return
        press.dragging = true
        setDragging(true)
        setLingering(false)
      }
      // Up is +1: screen y grows downwards.
      optionsRef.current.step(press.base, Math.round((press.y - event.clientY) / press.stepPx))
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      const press = pressRef.current
      if (!press || press.pointerId !== event.pointerId) return
      pressRef.current = null
      dragHoldRef.current?.()
      if (!press.dragging) {
        // A release after a hold was the start of a drag that did not happen: no step.
        if (!press.held) optionsRef.current.tap()
        return
      }
      setDragging(false)
      setLingering(true)
    },
    onPointerCancel: () => {
      dragHoldRef.current?.()
      if (pressRef.current?.dragging) {
        setDragging(false)
        setLingering(true)
      }
      pressRef.current = null
    },
    onContextMenu: (event: MouseEvent<HTMLElement>) => event.preventDefault(),
  }
  return { handlers, adjusting: dragging || lingering }
}
