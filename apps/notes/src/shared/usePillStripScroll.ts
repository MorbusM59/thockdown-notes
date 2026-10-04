import { useCallback, useEffect, useState, type MutableRefObject, type WheelEvent as ReactWheelEvent } from 'react'
import { useRef } from 'react'

/**
 * A callback ref that also re-runs `onResize` whenever the element's own box
 * changes.
 *
 * A callback ref rather than an object ref because the observer has to be
 * attached in an effect, and an effect cannot depend on `ref.current`: it
 * would attach to whatever was mounted on the first pass and never notice a
 * remount. Routing the node through state is what gives the effect a real
 * dependency.
 */
export function useObservedBoxRef<T extends HTMLElement>(
  elementRef: MutableRefObject<T | null>,
  onResize: () => void,
  enabled = true,
) {
  const [element, setElement] = useState<T | null>(null)

  const attach = useCallback((node: T | null) => {
    elementRef.current = node
    setElement(node)
  }, [elementRef])

  useEffect(() => {
    if (!enabled || !element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => onResize())
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, onResize, enabled])

  return attach
}

/** Just enough of a scroller to decide its fades -- so the rule can be tested without one. */
export interface StripScrollMetrics {
  scrollLeft: number
  scrollWidth: number
  clientWidth: number
}

/**
 * Which edges of a strip have more beyond them.
 *
 * A pixel of slack at each end: a strip scrolled fully to one side lands on a
 * fractional boundary often enough that an exact compare flickers the fade
 * there -- and a strip that does not overflow at all can report a
 * `scrollWidth` a hair over its `clientWidth`, which would leave a permanent
 * fade on a bar with nothing hidden behind it.
 */
export function readScrollEdges(metrics: StripScrollMetrics): { left: boolean; right: boolean } {
  return {
    left: metrics.scrollLeft > 1,
    right: metrics.scrollLeft < metrics.scrollWidth - metrics.clientWidth - 1,
  }
}

export interface PillStripScroll {
  /** Attach to the SCROLLER -- the pill display row, not the shell around it. */
  ref: (node: HTMLDivElement | null) => void
  /** Append to the SHELL's class: the fade mask is the shell's, the scroll is the row's. */
  fadeClassName: string
  onScroll: () => void
  onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void
}

/**
 * Horizontal scrolling with edge fades, for a pill strip that is wider than
 * its bar.
 *
 * Every pill bar in the app works this way -- a strip that overflows stays
 * reachable rather than being clipped away, and the fade is what says there
 * is more of it. That is a property of the BAR, not of what happens to be in
 * it, so a mode's narration strip gets it by using this rather than by
 * looking like it does: the alternative is a copy that drifts, which is this
 * codebase's characteristic failure and is already four copies deep in the
 * tab bar (see TODO.md).
 *
 * `contentKey` is a cheap primitive summarising what is IN the strip. The
 * observer below catches every change to the strip's own box, but not a
 * change to what it contains -- an added pill changes `scrollWidth` without
 * changing the scroller's width, and nothing would re-measure. A primitive
 * rather than a dependency array so the effect's deps stay static (and so a
 * caller cannot silently pass a fresh array identity every render).
 */
export function usePillStripScroll(contentKey: string | number, enabled = true): PillStripScroll {
  const elementRef = useRef<HTMLDivElement | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const update = useCallback(() => {
    const el = elementRef.current
    if (!el) return
    const edges = readScrollEdges(el)
    setCanScrollLeft(edges.left)
    setCanScrollRight(edges.right)
  }, [])

  useEffect(() => {
    update()
  }, [contentKey, enabled, update])

  const ref = useObservedBoxRef(elementRef, update, enabled)

  // Vertical wheel input scrolls the bar horizontally, regardless of
  // browser/OS default wheel-axis behavior.
  const onWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.deltaY === 0) return
    event.preventDefault()
    event.currentTarget.scrollLeft += event.deltaY
  }, [])

  return {
    ref,
    fadeClassName: `${canScrollLeft ? ' fade-left' : ''}${canScrollRight ? ' fade-right' : ''}`,
    onScroll: update,
    onWheel,
  }
}
