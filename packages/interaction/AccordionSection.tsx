// AccordionSection — animated details/summary accordion.
//
// Height animation uses the same ScrollCurvePlan bell-curve engine as the
// editor scroll, but with fixed internal parameters that are not exposed to
// the user. The accordion feel is intentionally crisp and independent of
// the scroll dynamics settings.
//
// Left-click: opens this section, closes all siblings.
// Right-click: opens this section without closing siblings.
// All sections are closed by default. An owner that keeps the open state
// itself (the sidebar's tag lists) passes `open` and is asked instead -- see
// useFold. AccordionDivider is the same fold on a sub-section label.
//
// A group given a `filter` shows only what the term appears in (optionsSearch.ts):
// whole sections whose heading holds it, otherwise only the sub-sections that
// do. When the hits fall in one section it is opened; when they span several,
// every section is folded. That is decided only when the set of hits CHANGES,
// so a keystroke that leaves the same options standing leaves whatever the
// reader opened or closed since as it is.

import { type MouseEvent, type ReactNode, type RefObject, createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { AccordionSectionOpenContext } from './accordionSectionOpen'
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

// ── The fold, shared by a section and a divider ───────────────────────────

/**
 * Whether a fold is open, and who decides. UNCONTROLLED (no `open` given),
 * the fold keeps its own state: a left press opens it and closes its
 * siblings in the nearest AccordionGroup, a right press toggles it alone.
 * CONTROLLED (`open` given), the owner keeps the state -- the sidebar's tag
 * lists remember theirs across restarts -- and a press only ASKS, through
 * `onRequestOpenChange(open, exclusive)`, `exclusive` being the left press's
 * "and close the others". The fold then animates to whatever `open` becomes.
 * A controlled fold inside an AccordionGroup takes part in it like any
 * other: its own left press closes its siblings, and a sibling's (or the
 * group's search) closing or opening it is passed on to the owner as a
 * request, so the owner's state is never left saying open over a fold the
 * group closed.
 */
interface FoldControl {
  open?: boolean
  onRequestOpenChange?: (open: boolean, exclusive: boolean) => void
  /**
   * A right press does what a left press does (opens this fold and closes
   * its siblings), for a section whose folds must never be open together.
   */
  exclusive?: boolean
  /** Uncontrolled only: open on mount. */
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

function useFold({ open: controlledOpen, onRequestOpenChange, exclusive = false, defaultOpen = false, onOpenChange }: FoldControl, lazy = false) {
  const id = useId()
  const group = useContext(AccordionGroupContext)
  const isControlled = controlledOpen !== undefined
  const [isOpen, setIsOpen] = useState(isControlled ? controlledOpen : defaultOpen)
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
    // A lazy section's content is built by this very state change, and the
    // unfold measures it on the next line: commit it first, or the fold
    // opens to a height of nothing. (Never in a render or an effect: lazy
    // sections are opened by a press, never by the group's search.)
    if (lazy) flushSync(() => setIsOpen(true))
    else setIsOpen(true)
    const naturalHeight = content.scrollHeight
    content.style.height = `${fromPx}px`
    content.style.overflow = 'hidden'
    animateTo(fromPx, naturalHeight, () => {
      content.style.height = ''
      content.style.overflow = ''
    })
  }, [isOpen, animateTo, lazy])

  // A fold that starts open is drawn open at once. `open` is never a React
  // prop of the <details>: the fold animation sets it itself, at the end of
  // a close, and a prop would fight it.
  useLayoutEffect(() => {
    if (detailsRef.current && isOpen) detailsRef.current.open = true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Register with the group once; the handle reads the latest open/close.
  const openCloseRef = useRef({ open, close })
  openCloseRef.current = { open, close }
  // What the group asks of this fold: done at once when the fold keeps its
  // own state, asked of the owner when it does not.
  const groupRequestRef = useRef({ open, close })
  groupRequestRef.current = isControlled
    ? { open: () => { if (!controlledOpen) onRequestOpenChange?.(true, false) }, close: () => { if (controlledOpen) onRequestOpenChange?.(false, false) } }
    : { open, close }
  useLayoutEffect(() => {
    if (!group || !sectionRef.current || !summaryRef.current || !contentRef.current) return
    group.register(id, {
      open: () => groupRequestRef.current.open(),
      close: () => groupRequestRef.current.close(),
      section: sectionRef.current,
      heading: summaryRef.current,
      body: contentRef.current,
    })
    return () => group.unregister(id)
  }, [group, id])

  // Controlled: follow the owner's state, animated.
  useLayoutEffect(() => {
    if (controlledOpen === undefined) return
    if (controlledOpen) openCloseRef.current.open()
    else openCloseRef.current.close()
  }, [controlledOpen])

  useEffect(() => () => cancelAnim(), [cancelAnim])

  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange
  useEffect(() => {
    if (!isOpen) return
    onOpenChangeRef.current?.(true)
    return () => onOpenChangeRef.current?.(false)
  }, [isOpen])

  // What the reader will see once the fold settles: in a controlled fold the
  // owner's state, which the animation is already heading for.
  const settlesOpen = isControlled ? controlledOpen : isOpen

  const handleClick = useCallback((e: MouseEvent<HTMLElement>) => {
    e.preventDefault()
    if (isControlled) {
      if (!settlesOpen) group?.closeOthers(id)
      onRequestOpenChange?.(!settlesOpen, !settlesOpen)
      return
    }
    if (isOpen) {
      close()
    } else {
      group?.closeOthers(id)
      open()
    }
  }, [isControlled, onRequestOpenChange, settlesOpen, isOpen, close, open, group, id])

  const handleContextMenu = useCallback((e: MouseEvent<HTMLElement>) => {
    if (exclusive) {
      handleClick(e)
      return
    }
    e.preventDefault()
    if (isControlled) {
      onRequestOpenChange?.(!settlesOpen, false)
      return
    }
    if (isOpen) close()
    else open()
  }, [exclusive, handleClick, isControlled, onRequestOpenChange, settlesOpen, isOpen, close, open])

  return { isOpen, sectionRef, detailsRef, summaryRef, contentRef, handleClick, handleContextMenu }
}

// ── AccordionSection ───────────────────────────────────────────────────────

interface AccordionSectionProps extends FoldControl {
  heading: ReactNode
  children: ReactNode
  className?: string
  headingClassName?: string
  ariaLabel?: string
  /** fa-solid icon class(es) for the heading, saying what the subsection is about, e.g. "fa-paint-roller". */
  iconClass: string
  /**
   * What stands in place of the fold arrow, in the divider's marker slot
   * (AccordionDivider): a count (`AccordionCount`), or a control acting on
   * the whole section. A control there must stop its own click, or it folds.
   */
  marker?: ReactNode
  /**
   * Told when the section opens (as its unfold starts) and when it closes (as
   * its fold ends), and told `false` when it unmounts open, so a listener
   * never holds an open state for a section that is gone.
   */
  onOpenChange?: (open: boolean) => void
  /**
   * Builds the content only once the section is first opened, so a long
   * list of folded sections costs its headings and nothing more. Off by
   * default, and must stay off wherever the group's filter is used: that
   * filter searches the DOM text of folded sections (AccordionGroup).
   */
  lazy?: boolean
}

/**
 * Whether content behind a fold should be in the DOM: always, or with `lazy`
 * from the moment the fold first opens on (kept after, so folding it again
 * animates real content and reopening costs nothing).
 */
function useMountedWhileFolded(lazy: boolean, isOpen: boolean): boolean {
  const [opened, setOpened] = useState(isOpen)
  if (isOpen && !opened) setOpened(true)
  return !lazy || isOpen || opened
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
  iconClass,
  marker,
  lazy = false,
  ...fold
}: AccordionSectionProps) {
  const { isOpen, sectionRef, detailsRef, summaryRef, contentRef, handleClick, handleContextMenu } = useFold(fold, lazy)
  const mounted = useMountedWhileFolded(lazy, isOpen)
  return (
    <section
      ref={sectionRef}
      className={`options-section sidebar-options-section${className ? ` ${className}` : ''}`}
      aria-label={ariaLabel}
    >
      <details ref={detailsRef} className="sidebar-options-accordion">
        <summary
          ref={summaryRef}
          className={`sidebar-options-section-heading${marker !== undefined ? ' has-count' : ''}${headingClassName ? ` ${headingClassName}` : ''}`}
          // A heading is a row whose marker may carry hover actions (apps/notes components/HoverActions.tsx).
          data-hover-host=""
          onClick={handleClick}
          data-secondary-press="action"
          onContextMenu={handleContextMenu}
        >
          <span className={`fa-solid ${iconClass}`} aria-hidden="true" />
          {heading}
          {marker !== undefined && <span className="options-divider-count">{marker}</span>}
        </summary>
        <div ref={contentRef} className="sidebar-options-accordion-body">
          {mounted && <AccordionSectionOpenContext.Provider value={isOpen}>{children}</AccordionSectionOpenContext.Provider>}
        </div>
      </details>
    </section>
  )
}

// ── AccordionDivider ───────────────────────────────────────────────────────

/**
 * A FOLDING sub-section label: the `.options-subsection-label` divider, which
 * folds the group beneath it with the same fold and the same presses as a
 * section. Its siblings are the dividers in the nearest AccordionGroup, so a
 * section that wants its dividers to close one another wraps them in a group
 * of their own.
 */
/** How many entries a section or divider folds, as its marker. */
export function AccordionCount({ count }: { count: number }) {
  return <>({count})</>
}

export function AccordionDivider({ label, marker, children, ariaLabel, ...fold }: FoldControl & {
  label: ReactNode
  /** What the line's open end shows: how many entries it folds (`AccordionCount`), or a control acting on them all. */
  marker: ReactNode
  children: ReactNode
  ariaLabel?: string
}) {
  const { sectionRef, detailsRef, summaryRef, contentRef, handleClick, handleContextMenu } = useFold(fold)
  return (
    <div ref={sectionRef as RefObject<HTMLDivElement>} className="options-divider" aria-label={ariaLabel}>
      <details ref={detailsRef} className="options-divider-fold">
        <summary
          ref={summaryRef}
          className="options-subsection-label options-divider-label"
          data-hover-host=""
          onClick={handleClick}
          data-secondary-press="action"
          onContextMenu={handleContextMenu}
        >
          <span className="options-divider-count">{marker}</span>
          {label}
        </summary>
        <div ref={contentRef} className="options-divider-body">{children}</div>
      </details>
    </div>
  )
}
