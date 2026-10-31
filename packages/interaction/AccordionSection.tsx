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
//
// A group given a `filter` shows only what the term appears in (optionsSearch.ts):
// whole sections whose heading holds it, otherwise only the sub-sections that
// do. When the hits fall in one section it is opened; when they span several,
// every section is folded. That is decided only when the set of hits CHANGES,
// so a keystroke that leaves the same options standing leaves whatever the
// reader opened or closed since as it is.

import { type MouseEvent, type ReactNode, createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { buildCurvePlan, buildScrollPlan, sampleScrollPlan } from './ScrollCurvePlan'
import { type OptionsSearchSection, applyOptionsSelection, indexOptionsSection, selectOptions } from './optionsSearch'

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
// Siblings register a handle so left-click can collapse all others before
// expanding the clicked one, and so a search can find, fold and open them.

interface SectionHandle {
  open: () => void
  close: () => void
  section: HTMLElement
  heading: HTMLElement
  body: HTMLElement
}

interface AccordionGroupCtx {
  register:   (id: string, handle: SectionHandle) => void
  unregister: (id: string) => void
  closeOthers: (exceptId: string) => void
}

const AccordionGroupContext = createContext<AccordionGroupCtx | null>(null)

/**
 * Whether the section a control sits in is open. A section's content stays
 * mounted while it is folded, so a control holding state that should not
 * outlive the reader leaving the section (a linked colour target) reads this
 * rather than its own mount. Outside any section it is always open.
 */
const AccordionSectionOpenContext = createContext(true)

export function useAccordionSectionOpen(): boolean {
  return useContext(AccordionSectionOpenContext)
}

interface SearchState {
  /** The term the DOM currently reflects; '' when no search is in force. */
  term: string
  /** Null when the sections' DOM changed since it was built. */
  index: OptionsSearchSection[] | null
  /** The last selection the fold state was decided for. */
  selectionKey: string | null
  observer: MutationObserver | null
}

export function AccordionGroup({ children, filter = '' }: { children: ReactNode, filter?: string }) {
  const registry = useRef<Map<string, SectionHandle>>(new Map())
  const search = useRef<SearchState>({ term: '', index: null, selectionKey: null, observer: null })

  const refresh = useCallback(() => {
    const state = search.current
    if (!state.term) {
      if (state.index) applyOptionsSelection(state.index, null)
      state.observer?.disconnect()
      state.observer = null
      state.index = null
      state.selectionKey = null
      return
    }
    const handles = [...registry.current.values()].sort((a, b) =>
      a.section.compareDocumentPosition(b.section) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
    if (!state.index) {
      state.index = handles.map((h) => indexOptionsSection(h.section, h.heading, h.body))
      if (!state.observer) {
        state.observer = new MutationObserver(() => {
          search.current.index = null
          refresh()
        })
      }
      state.observer.disconnect()
      for (const h of handles) state.observer.observe(h.body, { childList: true, subtree: true })
    }
    const selection = selectOptions(state.index, state.term)
    applyOptionsSelection(state.index, selection)
    const key = JSON.stringify(selection)
    if (key === state.selectionKey) return
    state.selectionKey = key
    const hit = selection.flatMap((kept, i) => (kept.length > 0 ? [i] : []))
    handles.forEach((h, i) => {
      if (hit.length === 1 && hit[0] === i) h.open()
      else h.close()
    })
  }, [])

  const register = useCallback((id: string, handle: SectionHandle) => {
    registry.current.set(id, handle)
    search.current.index = null
  }, [])

  const unregister = useCallback((id: string) => {
    registry.current.delete(id)
    search.current.index = null
  }, [])

  const closeOthers = useCallback((exceptId: string) => {
    registry.current.forEach((handle, id) => {
      if (id !== exceptId) handle.close()
    })
  }, [])

  // No dependency list: a section mounting or unmounting re-renders this group
  // (its children changed) and marks the index stale, and this is where the
  // filter is brought up to date with both. Anything else costs one compare.
  useLayoutEffect(() => {
    const term = filter.trim()
    const state = search.current
    if (term === state.term && (state.index || !term)) return
    state.term = term
    refresh()
  })

  useEffect(() => () => search.current.observer?.disconnect(), [])

  // Stable, so a section registers once rather than on every render.
  const context = useMemo(() => ({ register, unregister, closeOthers }), [register, unregister, closeOthers])

  return (
    <AccordionGroupContext.Provider value={context}>
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
  /** fa-solid icon class for the heading, e.g. "fa-rectangle-list". Defaults to the global-scope icon. */
  iconClass?: string
  /** Tooltip shown when hovering the icon. Pass '' to suppress the tooltip attribute entirely. */
  iconTooltip?: string
}

const DEFAULT_ICON_CLASS   = 'fa-globe-americas'
const DEFAULT_ICON_TOOLTIP = 'These settings are global and persist across layouts.'

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
  iconClass = DEFAULT_ICON_CLASS,
  iconTooltip = DEFAULT_ICON_TOOLTIP,
}: AccordionSectionProps) {
  const id = useId()
  const group = useContext(AccordionGroupContext)
  const [isOpen, setIsOpen] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const summaryRef = useRef<HTMLElement>(null)
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
    // A close still animating counts as closed: reverse it from where it got
    // to, or a search that opens a section mid-fold would leave it folded.
    const closing = animRef.current?.toPx === 0
    if (!details || !content || (isOpen && !closing)) return
    const fromPx = closing ? content.getBoundingClientRect().height : 0
    details.open = true
    setIsOpen(true)
    const naturalHeight = content.scrollHeight
    content.style.height = `${fromPx}px`
    content.style.overflow = 'hidden'
    animateTo(fromPx, naturalHeight, () => {
      content.style.height = ''
      content.style.overflow = ''
    })
  }, [isOpen, animateTo])

  // Register with the group once; the handle reads the latest open/close.
  const openCloseRef = useRef({ open, close })
  openCloseRef.current = { open, close }
  useLayoutEffect(() => {
    if (!group || !sectionRef.current || !summaryRef.current || !contentRef.current) return
    group.register(id, {
      open: () => openCloseRef.current.open(),
      close: () => openCloseRef.current.close(),
      section: sectionRef.current,
      heading: summaryRef.current,
      body: contentRef.current,
    })
    return () => group.unregister(id)
  }, [group, id])

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
      ref={sectionRef}
      className={`options-section sidebar-options-section${className ? ` ${className}` : ''}`}
      aria-label={ariaLabel}
    >
      <details ref={detailsRef} className="sidebar-options-accordion">
        <summary
          ref={summaryRef}
          className={`sidebar-options-section-heading${headingClassName ? ` ${headingClassName}` : ''}`}
          onClick={handleClick}
          data-secondary-press="action"
          onContextMenu={handleContextMenu}
        >
          <span
            className={`fa-solid ${iconClass}`}
            data-tooltip={iconTooltip || undefined}
          />
          {heading}
        </summary>
        <div ref={contentRef} className="sidebar-options-accordion-body">
          <AccordionSectionOpenContext.Provider value={isOpen}>{children}</AccordionSectionOpenContext.Provider>
        </div>
      </details>
    </section>
  )
}
