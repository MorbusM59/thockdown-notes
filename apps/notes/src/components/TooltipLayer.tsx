import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const TOOLTIP_SELECTOR = '[data-tooltip], [data-live-tooltip]'
const SHOW_DELAY_MS = 600
const GAP_PX = 6

interface AnchorRect {
  left: number
  top: number
  right: number
  bottom: number
}

interface TooltipState {
  text: string
  anchor: AnchorRect
}

function readTooltipText(el: Element): string {
  return el.getAttribute('data-live-tooltip') ?? el.getAttribute('data-tooltip') ?? ''
}

function anchorOf(el: Element): AnchorRect {
  const { left, top, right, bottom } = el.getBoundingClientRect()
  return { left, top, right, bottom }
}

/** The gap every tooltip keeps to each window edge: the theme's --spacing-regular, read when placing. */
function windowMarginPx(): number {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--spacing-regular'))
  return Number.isFinite(value) ? value : 0
}

/**
 * Where a bubble of the MEASURED size goes: centred on the anchor, above it if
 * it fits there and below otherwise, then clamped so the whole box keeps
 * `margin` to every window edge. The bubble's CSS max-width already leaves
 * room for both side margins, so the clamp can always be satisfied
 * horizontally; vertically it can only fail for a tooltip taller than the
 * window, which is then pinned to the top margin.
 */
export function placeTooltip(
  anchor: AnchorRect,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  margin: number,
): { left: number; top: number } {
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
  const centreX = (anchor.left + anchor.right) / 2
  const left = clamp(centreX - width / 2, margin, viewportWidth - margin - width)
  const above = anchor.top - GAP_PX - height
  const below = anchor.bottom + GAP_PX
  const preferred = above >= margin ? above : below
  const top = Math.max(margin, Math.min(viewportHeight - margin - height, preferred))
  return { left, top }
}

/**
 * Single app-wide tooltip renderer. Every [data-tooltip]/[data-live-tooltip]
 * element keeps exactly the attribute it already had -- this component is
 * the only thing that changed to replace the old per-element CSS ::after
 * approach. Rendering into one fixed layer above the whole app (mounted
 * inside .app-saturate-wrapper in App.tsx, so it still sits under that
 * wrapper's own filter/glaze/colorize layers -- see the mount site's own
 * comment) means there's exactly one stacking context to reason about,
 * instead of a pile of per-container overflow/z-index workarounds each new
 * ancestor kept needing (options panel swatches, the sidebar's custom
 * scrollbar, the toolbar's container-query overflow, the search box's case
 * toggle, top-row chrome clipped against the window edge, ...). Screen-space
 * placement (`placeTooltip`: the measured bubble kept --spacing-regular from
 * every window edge, flipping below when there's no room above) is real arithmetic here instead of CSS overrides
 * bolted on per container as each clipping case turned up.
 *
 * `data-live-tooltip` content that changes while still hovering (dragging an
 * HSVA control, scrolling a CompactScrollbarSlider) is picked up via a
 * MutationObserver on the currently-hovered element rather than requiring
 * every call site to notify this layer -- it just watches the attribute.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<TooltipState | null>(null)
  const targetRef = useRef<Element | null>(null)
  const showTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const el = targetRef.current
      if (el) setTip((previous) => (previous ? { ...previous, text: readTooltipText(el) } : previous))
    })

    const clearShowTimer = () => {
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current)
        showTimerRef.current = null
      }
    }

    const hide = () => {
      clearShowTimer()
      observer.disconnect()
      targetRef.current = null
      setTip(null)
    }

    const showFor = (el: Element) => {
      observer.disconnect()
      observer.observe(el, { attributes: true, attributeFilter: ['data-tooltip', 'data-live-tooltip'] })
      setTip({ text: readTooltipText(el), anchor: anchorOf(el) })
    }

    const handleMouseOver = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const next = target.closest(TOOLTIP_SELECTOR)
      if (!next || next === targetRef.current) return
      clearShowTimer()
      observer.disconnect()
      targetRef.current = next
      setTip(null)
      showTimerRef.current = window.setTimeout(() => {
        showTimerRef.current = null
        if (targetRef.current === next) showFor(next)
      }, SHOW_DELAY_MS)
    }

    const handleMouseOut = (event: MouseEvent) => {
      const leavingTarget = event.target
      if (!(leavingTarget instanceof Element)) return
      const leaving = leavingTarget.closest(TOOLTIP_SELECTOR)
      if (!leaving || leaving !== targetRef.current) return
      const related = event.relatedTarget
      if (related instanceof Node && leaving.contains(related)) return
      hide()
    }

    const handleReposition = () => {
      const el = targetRef.current
      if (!el) return
      if (!el.isConnected) {
        hide()
        return
      }
      setTip((previous) => (previous ? { ...previous, anchor: anchorOf(el) } : previous))
    }

    window.addEventListener('mouseover', handleMouseOver, { capture: true })
    window.addEventListener('mouseout', handleMouseOut, { capture: true })
    window.addEventListener('scroll', handleReposition, { capture: true, passive: true })
    window.addEventListener('resize', handleReposition)
    window.addEventListener('blur', hide)

    return () => {
      hide()
      window.removeEventListener('mouseover', handleMouseOver, { capture: true })
      window.removeEventListener('mouseout', handleMouseOut, { capture: true })
      window.removeEventListener('scroll', handleReposition, { capture: true })
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('blur', hide)
    }
  }, [])

  // Placed after layout, before paint: the bubble is measured as rendered
  // (text, font scale, max-width all included) and positioned by writing its
  // style directly, so a show costs one measurement and no second render.
  // Runs only when a tooltip appears, its text changes, or its anchor moves.
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const bubble = bubbleRef.current
    if (!tip || !bubble) return
    const { width, height } = bubble.getBoundingClientRect()
    const { left, top } = placeTooltip(tip.anchor, width, height, window.innerWidth, window.innerHeight, windowMarginPx())
    bubble.style.left = `${left}px`
    bubble.style.top = `${top}px`
  }, [tip])

  if (!tip) return null

  return (
    <div className="app-tooltip-layer" aria-hidden="true">
      <div ref={bubbleRef} className="app-tooltip-bubble">
        {tip.text}
      </div>
    </div>
  )
}
