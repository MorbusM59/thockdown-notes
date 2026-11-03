import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { useNonPassiveWheel } from './useNonPassiveWheel'

/**
 * How long a wheel-adjustable control inside a scrolling panel waits before
 * it takes the wheel. Until then the wheel scrolls the panel.
 */
export const WHEEL_GRACE_MS = 300

/** Marks an element whose wheel handling is graced; read by the window listener below. */
const GRACED_ATTRIBUTE = 'data-wheel-grace'

/**
 * Time of the last wheel event that scrolled something rather than adjusting
 * a graced control: one that landed outside every graced control, or one a
 * graced control declined because it was still in its grace period.
 */
let lastScrollingWheelAt = -Infinity
let windowListenerInstalled = false

function installWindowListener() {
  if (windowListenerInstalled || typeof window === 'undefined') return
  windowListenerInstalled = true
  // Capture phase, passive: it only reads the time and never interferes.
  window.addEventListener('wheel', (event) => {
    const target = event.target
    if (target instanceof Element && target.closest(`[${GRACED_ATTRIBUTE}]`)) return
    lastScrollingWheelAt = event.timeStamp
  }, { capture: true, passive: true })
}

function hasScrollableAncestor(el: HTMLElement): boolean {
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (node.scrollHeight <= node.clientHeight) continue
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return true
  }
  return false
}

/**
 * `useNonPassiveWheel` for a control that sits inside a scrolling panel (the
 * options sliders, the soundscape channel selector). The control takes the
 * wheel only once the pointer has rested over it for `WHEEL_GRACE_MS` AND no
 * wheel has scrolled anything for that long. Before that, `handler` is not
 * called and the event is left alone, so the panel scrolls.
 *
 * The second condition is what lets a continuous scroll pass over a control:
 * the panel moves the control under a stationary pointer, which fires no
 * `pointerenter`, so the pointer's arrival alone cannot be the clock. Every
 * wheel that scrolls instead of adjusting (including one this control just
 * declined) restarts the grace.
 *
 * A control with no scrollable ancestor has nothing to protect and takes the
 * wheel at once; that is decided when the pointer enters, not per event.
 */
export function useGracedWheel<T extends HTMLElement>(
  ref: RefObject<T | null>,
  handler: (event: WheelEvent) => void,
) {
  const enteredAtRef = useRef(-Infinity)
  const gracedRef = useRef(true)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    installWindowListener()
    el.setAttribute(GRACED_ATTRIBUTE, '')
    const onEnter = (event: PointerEvent) => {
      enteredAtRef.current = event.timeStamp
      gracedRef.current = hasScrollableAncestor(el)
    }
    el.addEventListener('pointerenter', onEnter)
    return () => {
      el.removeEventListener('pointerenter', onEnter)
      el.removeAttribute(GRACED_ATTRIBUTE)
    }
  }, [ref])

  const gated = useCallback((event: WheelEvent) => {
    if (gracedRef.current) {
      const now = event.timeStamp
      if (now - enteredAtRef.current < WHEEL_GRACE_MS || now - lastScrollingWheelAt < WHEEL_GRACE_MS) {
        lastScrollingWheelAt = now
        return
      }
    }
    handler(event)
    // A control that let the wheel through (disabled, no delta) scrolled the
    // panel, which restarts the grace for every control like any other scroll.
    if (!event.defaultPrevented) lastScrollingWheelAt = event.timeStamp
  }, [handler])

  useNonPassiveWheel(ref, gated)
}
