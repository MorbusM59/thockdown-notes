import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { decodeTooltip, tooltipLines } from '@thockdown/interaction/tooltipContent'
import { placeTooltip, type AnchorRect } from './tooltipPlacement'
import { SHORTCUTS, formatShortcut, type ShortcutId } from '../shared/keyboardShortcuts'
import type { TooltipSettings } from '../shared/tooltipSettings'

const TOOLTIP_SELECTOR = '[data-tooltip], [data-live-tooltip]'
/**
 * Once a tooltip has shown, moving straight on to another control shows its
 * tooltip at once, as long as the pointer arrives within this long of the
 * last one hiding: the reader is already reading tooltips, and making them
 * wait the whole delay again per control is what makes browsing a toolbar slow.
 */
const WARM_HANDOFF_MS = 400

function shortcutText(id: string): string | null {
  const declaration = (SHORTCUTS as Record<string, (typeof SHORTCUTS)[ShortcutId] | undefined>)[id]
  return declaration ? formatShortcut(declaration) : null
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
 * Single app-wide tooltip renderer. Every [data-tooltip]/[data-live-tooltip]
 * element keeps exactly the attribute it already had -- this component is
 * the only thing that changed to replace the old per-element CSS ::after
 * approach. Rendering into one fixed layer above the whole app (mounted
 * inside .app-saturate-wrapper in App.tsx, so the wrapper's filter still
 * applies, while it is stacked above the glaze -- see controls.css) means there's exactly one stacking context to reason about,
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
export function TooltipLayer({ settings }: { settings: TooltipSettings }) {
  const [tip, setTip] = useState<TooltipState | null>(null)
  const targetRef = useRef<Element | null>(null)
  const showTimerRef = useRef<number | null>(null)
  // Read by the listeners through a ref, so a settings change does not
  // re-install them.
  const delayRef = useRef(settings.delaySec)
  delayRef.current = settings.delaySec
  const lastShownAtRef = useRef(-Infinity)

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
      if (targetRef.current && showTimerRef.current === null) lastShownAtRef.current = performance.now()
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
      if (targetRef.current && showTimerRef.current === null) lastShownAtRef.current = performance.now()
      clearShowTimer()
      observer.disconnect()
      targetRef.current = next
      setTip(null)
      // A fixed explanation keeps its own delay and ignores the setting.
      const fixed = decodeTooltip(readTooltipText(next)).fixed
      const delaySec = delayRef.current
      if (!fixed && delaySec === 'never') return
      const warm = performance.now() - lastShownAtRef.current < WARM_HANDOFF_MS
      showTimerRef.current = window.setTimeout(() => {
        showTimerRef.current = null
        if (targetRef.current === next) showFor(next)
      }, fixed ? fixed.delayMs : warm ? 0 : (delaySec as number) * 1000)
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
  const content = decodeTooltip(tip.text)
  if (content.fixed) {
    const { title, detail, example } = content.fixed
    return (
      <div className="app-tooltip-layer" aria-hidden="true">
        <div ref={bubbleRef} className="app-tooltip-bubble">
          <strong>{title}</strong> {detail}{'\n'}Example: {example}
        </div>
      </div>
    )
  }
  // A tooltip with nothing left to say under the reader's choice is not shown.
  const lines = tooltipLines(content, settings.show, shortcutText)
  if (lines.length === 0) return null

  return (
    <div className="app-tooltip-layer" aria-hidden="true">
      <div ref={bubbleRef} className="app-tooltip-bubble">
        {lines.join('\n')}
      </div>
    </div>
  )
}
