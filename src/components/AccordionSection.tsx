// AccordionSection — animated details/summary accordion.
//
// Height animation uses the same ScrollCurvePlan bell-curve engine as the
// editor scroll, but with fixed internal parameters that are not exposed to
// the user. The accordion feel is intentionally crisp and independent of
// the scroll dynamics settings.
//
// Left-click: opens this section, closes all siblings.
// Right-click: opens this section without closing siblings.
// All sections are closed by default.

import { type MouseEvent, type ReactNode, createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { buildCurvePlan, buildScrollPlan, sampleScrollPlan } from '../editor/ScrollCurvePlan'

// Fixed accordion animation parameters — not user-configurable.
const ACCORDION_DYNAMIC        = 4
const ACCORDION_RESPONSIVENESS = 2
const ACCORDION_DURATION_SEC   = 0.12
const ACCORDION_MAX_SPEED      = 20000
const ACCORDION_SKEW           = 1

const buildAccordionPlan = (signedDistance: number) => {
  const curve = buildCurvePlan(
    ACCORDION_DYNAMIC,
    ACCORDION_RESPONSIVENESS,
    ACCORDION_DURATION_SEC,
    ACCORDION_SKEW,
  )
  return buildScrollPlan(curve, ACCORDION_DURATION_SEC, signedDistance, ACCORDION_MAX_SPEED)
}

// ── Accordion group context ────────────────────────────────────────────────
// Siblings share a registry of close callbacks so left-click can collapse all
// others before expanding the clicked one.

type CloseCallback = () => void

interface AccordionGroupCtx {
  register:   (id: string, close: CloseCallback) => void
  unregister: (id: string) => void
  closeOthers: (exceptId: string) => void
}

const AccordionGroupContext = createContext<AccordionGroupCtx | null>(null)

export function AccordionGroup({ children }: { children: ReactNode }) {
  const registry = useRef<Map<string, CloseCallback>>(new Map())

  const register = useCallback((id: string, close: CloseCallback) => {
    registry.current.set(id, close)
  }, [])

  const unregister = useCallback((id: string) => {
    registry.current.delete(id)
  }, [])

  const closeOthers = useCallback((exceptId: string) => {
    registry.current.forEach((close: CloseCallback, id: string) => {
      if (id !== exceptId) close()
    })
  }, [])

  return (
    <AccordionGroupContext.Provider value={{ register, unregister, closeOthers }}>
      {children}
    </AccordionGroupContext.Provider>
  )
}

// ── AccordionSection ───────────────────────────────────────────────────────

interface AccordionSectionProps {
  heading: ReactNode
  children: ReactNode
  className?: string
  headingClassName?: string
  ariaLabel?: string
  /** Increment to programmatically open this section (e.g. from an external button). */
  forceOpenNonce?: number
}

interface AnimState {
  rafId: number
  startTimeMs: number | null
  fromPx: number
  toPx: number
}

export function AccordionSection({
  heading,
  children,
  className,
  headingClassName,
  ariaLabel,
  forceOpenNonce,
}: AccordionSectionProps) {
  const id = useId()
  const group = useContext(AccordionGroupContext)
  const [isOpen, setIsOpen] = useState(false)
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<AnimState | null>(null)

  const cancelAnim = useCallback(() => {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current.rafId)
      animRef.current = null
    }
  }, [])

  const animateTo = useCallback((fromPx: number, toPx: number, onDone?: () => void) => {
    cancelAnim()
    const content = contentRef.current
    if (!content) { onDone?.(); return }

    const distance = toPx - fromPx
    if (Math.abs(distance) < 0.5) {
      content.style.height = `${toPx}px`
      onDone?.()
      return
    }

    const plan = buildAccordionPlan(distance)
    const totalMs = plan.totalDurationSec * 1000
    const state: AnimState = { rafId: 0, startTimeMs: null, fromPx, toPx }
    animRef.current = state

    const frame = (nowMs: number) => {
      if (state.startTimeMs === null) state.startTimeMs = nowMs
      const elapsed = nowMs - state.startTimeMs
      if (elapsed >= totalMs) {
        content.style.height = `${toPx}px`
        animRef.current = null
        onDone?.()
        return
      }
      content.style.height = `${fromPx + sampleScrollPlan(plan, elapsed / 1000)}px`
      state.rafId = requestAnimationFrame(frame)
      animRef.current = state
    }

    state.rafId = requestAnimationFrame(frame)
  }, [cancelAnim])

  // Exposed close — used by siblings via the group registry.
  const close = useCallback(() => {
    const details = detailsRef.current
    const content = contentRef.current
    if (!details || !content || !isOpen) return
    const currentHeight = content.getBoundingClientRect().height
    content.style.height = `${currentHeight}px`
    content.style.overflow = 'hidden'
    animateTo(currentHeight, 0, () => {
      details.open = false
      setIsOpen(false)
      content.style.height = ''
      content.style.overflow = ''
    })
  }, [isOpen, animateTo])

  const open = useCallback(() => {
    const details = detailsRef.current
    const content = contentRef.current
    if (!details || !content || isOpen) return
    details.open = true
    setIsOpen(true)
    const naturalHeight = content.scrollHeight
    content.style.height = '0px'
    content.style.overflow = 'hidden'
    animateTo(0, naturalHeight, () => {
      content.style.height = ''
      content.style.overflow = ''
    })
  }, [isOpen, animateTo])

  // Register close callback with the group.
  useEffect(() => {
    group?.register(id, close)
    return () => group?.unregister(id)
  }, [group, id, close])

  // Open programmatically when the nonce increments (e.g. external button).
  useEffect(() => {
    if (forceOpenNonce) {
      group?.closeOthers(id)
      open()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceOpenNonce])

  useEffect(() => () => cancelAnim(), [cancelAnim])

  const handleClick = useCallback((e: MouseEvent<HTMLElement>) => {
    e.preventDefault()
    if (isOpen) {
      close()
    } else {
      group?.closeOthers(id)
      open()
    }
  }, [isOpen, close, open, group, id])

  const handleContextMenu = useCallback((e: MouseEvent<HTMLElement>) => {
    e.preventDefault()
    if (isOpen) close()
    else open()
  }, [isOpen, close, open])

  return (
    <section
      className={`options-section sidebar-options-section${className ? ` ${className}` : ''}`}
      aria-label={ariaLabel}
    >
      <details ref={detailsRef} className="sidebar-options-accordion">
        <summary
          className={`sidebar-options-section-heading${headingClassName ? ` ${headingClassName}` : ''}`}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
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
