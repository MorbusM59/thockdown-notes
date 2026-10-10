// What "hovered" means, decided by the app rather than inferred by the
// browser from pointer history. The hover counterpart of `pressTracking.ts`,
// for the same underlying reason: the browser's pointer-state inference does
// not survive the things this app does under a pointer.
//
// ## The bug this exists because of
//
// Chromium re-evaluates `:hover` when the POINTER moves, not when the CONTENT
// under a still pointer changes. Archive or trash a note from its row's hover
// buttons and the row disappears; the next row slides up under the cursor and
// stays un-hovered -- no highlight, no action buttons -- until the mouse is
// wiggled. Clearing several notes in a row meant shaking the mouse between
// every click. The escape ring hit the same gap first (its cells rotate under
// a stationary pointer) and solved it locally in `EscapeHoldPanel.tsx`; this
// is the same rule stated once for the whole document.
//
// ## What it does
//
// It keeps the last pointer position and marks every element under it, the
// hit element and its whole ancestor chain, with `data-hovered` -- the same
// set `:hover` covers. It re-resolves that set:
//
// - on `pointermove`, from the event's target (what the browser hit-tested);
// - after the DOM changes under the pointer (a `MutationObserver`), and after
//   anything scrolls or the window resizes, by asking the document what is at
//   the remembered point (`elementFromPoint`), once per frame at most.
//
// Stylesheets select on `[data-hovered]` and never on `:hover`, so there is
// one answer to "what is hovered" and it cannot disagree with itself; keeping
// `:hover` beside it would light both the row that left and the one that
// arrived. The one exception is `::-webkit-scrollbar-thumb:hover`: a
// pseudo-element has no attributes to set and is never moved by the DOM.
//
// ## Which mutations count
//
// The editor rewrites its DOM on every keystroke, so a re-resolve on every
// mutation would put a hit test on the keydown path for nothing. A mutation
// matters only if it could have changed what is under the pointer: the hit
// element itself was removed, or something changed inside an ancestor of it
// (a sibling inserted or removed above it reflows it). Anything else -- the
// common case, a mutation elsewhere in the document -- is two cheap checks.
//
// Not covered: content that moves under the pointer by transform or
// animation alone, with no DOM change and no scroll. The escape ring is the
// one such surface and keeps its own re-resolve for exactly that.

/** The attribute every hover rule selects on, in place of `:hover`. */
export const HOVERED_ATTRIBUTE = 'data-hovered'

/** Elements currently marked, innermost first. */
let marked: Element[] = []
/** The element the pointer was last found over. */
let hit: Element | null = null
/** Where the pointer was last seen, or null once it has left the window. */
let position: { x: number; y: number } | null = null
let refreshScheduled = false

function chainOf(element: Element | null): Element[] {
  const chain: Element[] = []
  for (let node = element; node; node = node.parentElement) chain.push(node)
  return chain
}

/**
 * Marks the chain under `element`, touching only what changed: moving within
 * a row adds and removes nothing above it, so ordinary pointer travel writes
 * one or two attributes rather than the whole ancestor chain.
 */
function setHit(element: Element | null): void {
  if (element === hit) return
  hit = element
  const next = chainOf(element)
  const keep = new Set(next)
  for (const node of marked) {
    if (!keep.has(node)) node.removeAttribute(HOVERED_ATTRIBUTE)
  }
  const previous = new Set(marked)
  for (const node of next) {
    if (!previous.has(node)) node.setAttribute(HOVERED_ATTRIBUTE, '')
  }
  marked = next
}

function refresh(): void {
  refreshScheduled = false
  if (!position) return
  setHit(document.elementFromPoint(position.x, position.y))
}

function scheduleRefresh(): void {
  if (refreshScheduled || !position) return
  refreshScheduled = true
  requestAnimationFrame(refresh)
}

function mutationAffectsHit(records: MutationRecord[]): boolean {
  if (!hit) return true
  if (!hit.isConnected) return true
  for (const record of records) {
    if (record.target.contains(hit)) return true
  }
  return false
}

/**
 * Installs the tracking. Idempotent, and never removed: like the pressed
 * look, hover is a property of the document for the app's whole life.
 *
 * Touch is ignored: a finger has no hover, and the browser's emulation of it
 * (the last element tapped stays `:hover` until the next tap elsewhere) is the
 * thing `look.css` already had to fence off.
 */
let installed = false
export function installHoverTracking(): void {
  if (installed) return
  installed = true

  window.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return
    position = { x: event.clientX, y: event.clientY }
    setHit(event.target instanceof Element ? event.target : null)
  }, { capture: true, passive: true })

  // Leaving the window: `relatedTarget` is null exactly when the pointer went
  // to no element of this document.
  window.addEventListener('pointerout', (event) => {
    if (event.pointerType === 'touch' || event.relatedTarget !== null) return
    position = null
    setHit(null)
  }, { capture: true, passive: true })

  new MutationObserver((records) => {
    if (position && mutationAffectsHit(records)) scheduleRefresh()
  }).observe(document.documentElement, { childList: true, subtree: true })

  window.addEventListener('scroll', scheduleRefresh, { capture: true, passive: true })
  window.addEventListener('resize', scheduleRefresh, { passive: true })
}
