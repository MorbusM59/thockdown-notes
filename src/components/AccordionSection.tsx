// AccordionSection — animated details/summary accordion.
//
// Height animation uses the same ScrollCurvePlan bell-curve engine as the
// editor scroll, but with fixed internal parameters that are not exposed to
// the user. The accordion feel is intentionally crisp and independent of
// the scroll dynamics settings.

import { useCallback, useEffect, useRef, useState } from 'react'
import { buildCurvePlan, buildScrollPlan, sampleScrollPlan } from '../editor/ScrollCurvePlan'

// Fixed accordion animation parameters — not user-configurable.
const ACCORDION_DYNAMIC       = 4   // bell width (a)
const ACCORDION_RESPONSIVENESS = 2  // bell height (b)
const ACCORDION_DURATION_SEC  = 0.12  // total animation time
const ACCORDION_MAX_SPEED     = 20000  // px/s cap
const ACCORDION_SKEW          = 1  // apex bias (0=early, 1=late)

const buildAccordionPlan = (signedDistance: number) => {
  const curve = buildCurvePlan(
    ACCORDION_DYNAMIC,
    ACCORDION_RESPONSIVENESS,
    ACCORDION_DURATION_SEC,
    ACCORDION_SKEW,
  )
  return buildScrollPlan(curve, ACCORDION_DURATION_SEC, signedDistance, ACCORDION_MAX_SPEED)
}

interface AccordionSectionProps {
  heading: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
  className?: string
  headingClassName?: string
  ariaLabel?: string
}

interface AnimState {
  rafId: number
  startHeightPx: number
  targetHeightPx: number
  startTimeMs: number | null
}

export function AccordionSection({
  heading,
  children,
  defaultOpen = true,
  className,
  headingClassName,
  ariaLabel,
}: AccordionSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<AnimState | null>(null)

  // Cancel any in-progress animation.
  const cancelAnim = useCallback(() => {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current.rafId)
      animRef.current = null
    }
  }, [])

  // Animate height from currentPx to targetPx using the scroll curve engine.
  const animateTo = useCallback((currentPx: number, targetPx: number, onDone?: () => void) => {
    cancelAnim()
    const content = contentRef.current
    if (!content) {
      onDone?.()
      return
    }

    const distance = targetPx - currentPx
    if (Math.abs(distance) < 0.5) {
      content.style.height = `${targetPx}px`
      onDone?.()
      return
    }

    const plan = buildAccordionPlan(distance)
    const totalDurationMs = plan.totalDurationSec * 1000

    const state: AnimState = {
      rafId: 0,
      startHeightPx: currentPx,
      targetHeightPx: targetPx,
      startTimeMs: null,
    }
    animRef.current = state

    const frame = (nowMs: number) => {
      if (state.startTimeMs === null) state.startTimeMs = nowMs
      const elapsedMs = nowMs - state.startTimeMs

      if (elapsedMs >= totalDurationMs) {
        content.style.height = `${targetPx}px`
        animRef.current = null
        onDone?.()
        return
      }

      const displacement = sampleScrollPlan(plan, elapsedMs / 1000)
      content.style.height = `${currentPx + displacement}px`
      state.rafId = requestAnimationFrame(frame)
      animRef.current = state
    }

    state.rafId = requestAnimationFrame(frame)
  }, [cancelAnim])

  const handleSummaryClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault()
    const details = detailsRef.current
    const content = contentRef.current
    if (!details || !content) return

    if (!isOpen) {
      // Opening: set open immediately so content is in the DOM and measurable,
      // then animate from 0 to natural height.
      details.open = true
      setIsOpen(true)
      const naturalHeight = content.scrollHeight
      content.style.height = '0px'
      content.style.overflow = 'hidden'
      animateTo(0, naturalHeight, () => {
        content.style.height = ''
        content.style.overflow = ''
      })
    } else {
      // Closing: animate from current height to 0, then remove open attribute.
      const currentHeight = content.getBoundingClientRect().height
      content.style.height = `${currentHeight}px`
      content.style.overflow = 'hidden'
      animateTo(currentHeight, 0, () => {
        details.open = false
        setIsOpen(false)
        content.style.height = ''
        content.style.overflow = ''
      })
    }
  }, [isOpen, animateTo])

  // Cleanup on unmount.
  useEffect(() => cancelAnim, [cancelAnim])

  return (
    <section
      className={`toolbar-flyout-section sidebar-options-section${className ? ` ${className}` : ''}`}
      aria-label={ariaLabel}
    >
      <details ref={detailsRef} className="sidebar-options-accordion" open={defaultOpen || undefined}>
        <summary
          className={`sidebar-options-section-heading${headingClassName ? ` ${headingClassName}` : ''}`}
          onClick={handleSummaryClick}
        >
          {heading}
        </summary>
        <div ref={contentRef}>
          {children}
        </div>
      </details>
    </section>
  )
}
