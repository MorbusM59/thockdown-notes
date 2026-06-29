// AccordionSection — animated details/summary accordion.
//
// Height animation reuses the same ScrollCurvePlan bell-curve engine that
// drives the editor's smooth scroll, so accordion dynamics follow the same
// user-configured curve parameters (dynamic, responsiveness, total time, skew).
//
// The distance fed into buildScrollPlanFromCurrentParams is the pixel height
// delta, exactly as if the user had scrolled that many pixels.

import { useCallback, useEffect, useRef, useState } from 'react'
import { buildScrollPlanFromCurrentParams, sampleScrollPlan } from '../editor/ScrollCurvePlan'

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

    const plan = buildScrollPlanFromCurrentParams(distance)
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
