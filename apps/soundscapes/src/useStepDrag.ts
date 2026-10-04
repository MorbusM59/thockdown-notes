/**
 * A button that is tapped, or dragged up and down through a list of values
 * (LookButton.tsx's looks, the clip button's lengths).
 *
 * The drag goes by the schedule slot's minute-drag rules (ScheduleGrid.tsx),
 * so every such control feels alike: a press becomes a drag only once the
 * finger LEAVES THE BUTTON, a step is the button's own height measured from
 * where the press began (leaving is the first step, up is +1), and moving
 * back undoes steps. A release that never left the button is a tap.
 *
 * `adjusting` is true while a drag is under way and for SHOW_AFTER_DRAG_MS
 * after it, which is how long the button shows the value it was dragged to
 * before going back to its usual face.
 */
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'

const SHOW_AFTER_DRAG_MS = 2000

interface StepPress<T> {
  pointerId: number
  y: number
  box: DOMRect
  base: T
  stepPx: number
  dragging: boolean
}

export function useStepDrag<T>(options: {
  /** What a drag counts its steps from, read when the press begins. */
  begin: () => T
  /** The drag is `steps` steps from where it began (up positive). */
  step: (base: T, steps: number) => void
  tap: () => void
}) {
  const pressRef = useRef<StepPress<T> | null>(null)
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
      pressRef.current = {
        pointerId: event.pointerId,
        y: event.clientY,
        box: event.currentTarget.getBoundingClientRect(),
        base: optionsRef.current.begin(),
        stepPx: Math.max(1, event.currentTarget.offsetHeight),
        dragging: false,
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
      if (!press.dragging) {
        optionsRef.current.tap()
        return
      }
      setDragging(false)
      setLingering(true)
    },
    onPointerCancel: () => {
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
