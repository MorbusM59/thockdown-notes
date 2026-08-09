import { useEffect, useRef, useState } from 'react'

const TOOLTIP_SELECTOR = '[data-tooltip], [data-live-tooltip]'
const SHOW_DELAY_MS = 600
const GAP_PX = 6
const VIEWPORT_MARGIN_PX = 8
// Matches app-tooltip-bubble's own CSS max-width -- used only to keep a
// centered tooltip's assumed worst-case box inside the viewport without
// having to measure the actual rendered bubble (which would need a second
// render pass). A short/narrow tooltip just ends up with a little extra
// clamped-in margin near an edge instead of sitting dead-center; harmless.
const ASSUMED_MAX_WIDTH_PX = 260
const ASSUMED_BUBBLE_HEIGHT_PX = 26

interface TooltipState {
  text: string
  left: number
  top: number
  placement: 'above' | 'below'
}

function readTooltipText(el: Element): string {
  return el.getAttribute('data-live-tooltip') ?? el.getAttribute('data-tooltip') ?? ''
}

function clampCenterX(centerX: number): number {
  const halfWidth = ASSUMED_MAX_WIDTH_PX / 2
  const min = VIEWPORT_MARGIN_PX + halfWidth
  const max = window.innerWidth - VIEWPORT_MARGIN_PX - halfWidth
  if (max < min) return window.innerWidth / 2
  return Math.min(max, Math.max(min, centerX))
}

function positionFor(el: Element): { left: number; top: number; placement: 'above' | 'below' } {
  const rect = el.getBoundingClientRect()
  const left = clampCenterX(rect.left + rect.width / 2)
  const fitsAbove = rect.top - GAP_PX - ASSUMED_BUBBLE_HEIGHT_PX >= VIEWPORT_MARGIN_PX
  return fitsAbove
    ? { left, top: rect.top - GAP_PX, placement: 'above' }
    : { left, top: rect.bottom + GAP_PX, placement: 'below' }
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
 * clamping (never rendering off the left/right edge, flipping below when
 * there's no room above) is real arithmetic here instead of CSS overrides
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
      setTip({ text: readTooltipText(el), ...positionFor(el) })
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
      setTip((previous) => (previous ? { ...previous, ...positionFor(el) } : previous))
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

  if (!tip) return null

  return (
    <div className="app-tooltip-layer" aria-hidden="true">
      <div
        className="app-tooltip-bubble"
        style={{
          left: tip.left,
          top: tip.top,
          transform: `translate(-50%, ${tip.placement === 'above' ? '-100%' : '0'})`,
        }}
      >
        {tip.text}
      </div>
    </div>
  )
}
