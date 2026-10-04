// What "pressed" means, decided by the app rather than inferred by the
// browser from pointer history.
//
// ## The bug this exists because of
//
// Chromium sets `:active` on a mousedown of ANY button but only clears it on
// the release of the PRIMARY one. So a right-click on any button in the app
// left it looking held down -- indefinitely, until the pointer happened to
// move and the browser re-evaluated. Measured in the real app: four seconds
// after the release, `el.matches(':active')` was still true and the computed
// background was still `--btn-bg-pressed`.
//
// It is invisible to the usual ways of looking. `:active` is a pseudo-class,
// so nothing is added to the DOM and an Elements-panel watch shows no
// mutation; and reaching for the console or the inspector moves the mouse,
// which is the exact gesture that clears it. It also could not be reproduced
// with synthetic events: Chromium's CDP path does not set the active chain
// for a secondary button at all, so a headless probe sees nothing happen.
//
// ## Why this rather than a nudge on release
//
// The app has real right-click semantics nearly everywhere -- rename, close,
// archive, the adventure. A secondary press is a DIFFERENT GESTURE here, and
// the browser cannot tell whether the control it landed on means anything by
// it. Trying to un-stick the browser's state after the fact would be treating
// the symptom; what is actually wrong is that the styling asked the browser to
// infer a gesture it does not model the way this app means it.
//
// So the app says it instead. `:active` appears nowhere in the stylesheets:
// with nothing selecting on it, Chromium's stuck state has nothing to style,
// which is why this fix is sound by construction rather than by timing.
//
// This is the same move `EscapeHoldPanel.tsx` made for hover, for the same
// underlying reason -- the browser's pointer-state inference does not survive
// the things this app does with pointers -- and the two now read alike:
// hover and pressed are both state we own.
//
// ## The chain, and why only part of it
//
// `:active` applies to the whole ancestor chain, not just the element under
// the pointer, and the stylesheets rely on that (a pill's inner `<span>` is
// usually what a press actually lands on). So this walks the chain too --
// but it only WRITES to the elements a `[data-pressed]` rule could match.
//
// Marking the whole chain was the first version and it was measurably wrong:
// a press in the editor marked 20 elements, none of which any rule could
// style, and a mark-and-clear with the style recalc it forces costs ~0.9ms
// on a 14-deep chain in an almost empty document. A click can afford that.
// The keyboard path could not -- every SPACE typed in the editor was paying
// it, on the keydown path this project has a whole optimization plan about.
//
// WHICH elements those are is read out of the stylesheets rather than
// written down here. A hand-maintained list of "things that can look
// pressed" is precisely the shape of the drift this codebase keeps being
// bitten by (see CLAUDE.md on sanitizeMenu): add a `[data-pressed]` rule for
// a new control, forget the list, and the control silently never looks
// pressed. Derived from the CSS, that cannot happen.

// ## What a secondary press is allowed to look like
//
// The first version of this refused to mark a secondary press at all, which
// read correctly for the many buttons where a right-click means nothing --
// and wrongly for every button where it means something, which is a lot of
// them here. The predicate was never "which mouse button"; it is **does this
// control do anything with this gesture**, and only the control knows.
//
// Three ways to find out, at press time:
//
// 1. Ask the `contextmenu` event: `defaultPrevented` says truthfully that
//    something handled it. But Chromium on WINDOWS fires that event on mouse
//    UP, so the feedback would arrive after the gesture on the primary
//    platform, and at a different moment on each OS.
// 2. Read React's fiber props for an `onContextMenu`. Internal API, and it
//    cannot tell a real handler from one that only suppresses the menu.
// 3. Have the control say so.
//
// Only (3) survives, so `SECONDARY_PRESS_ATTRIBUTE` is that declaration --
// and it is required at EVERY `onContextMenu` site, `"none"` included, so a
// site cannot be merely undecided. That is enforced by
// `pressTracking.contract.test.ts`, which parses the JSX rather than
// grepping it, because the alternative is the hand-maintained list this
// codebase keeps being bitten by (CLAUDE.md, on `sanitizeMenu`): wire a new
// right-click action, forget the attribute, and the control silently stops
// acknowledging half its gestures.

/**
 * Declares what a SECONDARY (right) press on this control means.
 *
 * - `"action"` -- it does something, so it gets the pressed look.
 * - `"none"` -- it only suppresses the native menu, or nothing at all. No
 *   pressed look: an empty gesture must read as empty.
 *
 * Required alongside every `onContextMenu`, and may be computed where the
 * handler is (`cond ? 'action' : 'none'`) -- what the test forbids is the
 * absence of a decision, not a conditional one.
 *
 * Read with `closest()`, because a press lands on a pill's inner span.
 */
export const SECONDARY_PRESS_ATTRIBUTE = 'data-secondary-press'
const SECONDARY_PRESS_SELECTOR = `[${SECONDARY_PRESS_ATTRIBUTE}]`

/**
 * What a secondary press on this element means, taking the NEAREST
 * declaration -- an inner `"none"` shadows an outer `"action"`, which is not
 * a nicety: a note-list row is right-click-actionable and its save/close/
 * archive buttons sit inside it and deliberately swallow the gesture. Reading
 * "is there an `action` anywhere above me" would light exactly those.
 */
function secondaryPressMeaning(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  return target.closest(SECONDARY_PRESS_SELECTOR)?.getAttribute(SECONDARY_PRESS_ATTRIBUTE) ?? null
}

/**
 * An ATTRIBUTE, not a class, and that is not cosmetic.
 *
 * React rewrites `className` whenever a component's own class list changes,
 * and it has no idea about a class added from outside its render -- so a
 * press that causes a re-render (pressing a toggle, most obviously) wiped
 * the mark mid-gesture and the control stopped looking held. Caught by the
 * keyboard-activation check, where Enter on a toggle re-rendered it in the
 * same tick. React never writes `data-pressed` on these elements, so it
 * survives.
 *
 * Attribute selectors carry the same specificity as a class, so every rule
 * that used `:active` keeps the weight it had.
 */
export const PRESSED_ATTRIBUTE = 'data-pressed'

/** Keys that activate a focused control, and so should look like a press. */
const ACTIVATION_KEYS = new Set([' ', 'Spacebar', 'Enter'])

/**
 * Every element a `[data-pressed]` rule could match, as one selector read
 * out of the stylesheets. Computed once, lazily, on the first press.
 *
 * The fallback when the sheets cannot be read (a cross-origin sheet throws
 * on `.cssRules`) is the ancestor chain unfiltered -- correct but wasteful,
 * which is the right way round for a fallback.
 *
 * In dev, a hot stylesheet reload after this has been computed leaves it
 * stale until the next full reload. That is a dev-only staleness in a value
 * that only ever narrows work, so the worst case is a control that misses
 * its pressed look until you reload -- never a wrong one.
 */
let pressableSelector: string | null | undefined
function resolvePressableSelector(): string | null {
  if (pressableSelector !== undefined) return pressableSelector

  const subjects = new Set<string>()
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule) || !rule.selectorText.includes(`[${PRESSED_ATTRIBUTE}]`)) continue
      for (const part of rule.selectorText.split(',')) {
        const subject = part.trim().replace(`[${PRESSED_ATTRIBUTE}]`, '').replace(/::[\w-]+$/, '').trim()
        if (subject.length > 0) subjects.add(subject)
      }
    }
  }

  pressableSelector = subjects.size > 0 ? Array.from(subjects).join(',') : null
  return pressableSelector
}

/** Elements currently marked, so ending a press never has to search the document. */
let marked: Element[] = []

function clearAll(): void {
  for (const node of marked) node.removeAttribute(PRESSED_ATTRIBUTE)
  marked = []
}

function markChain(from: EventTarget | null): void {
  // Always before marking, never only on release: a second button pressed
  // while the first is held would otherwise strand the first press's marks.
  clearAll()

  const selector = resolvePressableSelector()
  let node = from instanceof Element ? from : null
  while (node) {
    if (selector === null || node.matches(selector)) {
      node.setAttribute(PRESSED_ATTRIBUTE, '')
      marked.push(node)
    }
    node = node.parentElement
  }
}

/**
 * The focused element, if it is something that can look pressed at all.
 *
 * Asked as a selector match rather than by ruling out text entry, which is
 * how this started: `isContentEditable` resolves computed style, so reading
 * it on every SPACE cost ~32us a keystroke on the keydown path -- measured,
 * after a first version that assumed the check was free. A selector match
 * touches no style. It is also the better question: keyboard focus is
 * always on the control itself, so there is nothing to walk up to.
 */
function pressableFocus(): Element | null {
  const selector = resolvePressableSelector()
  const node = document.activeElement
  if (!node) return null
  if (selector !== null && !node.matches(selector)) return null
  return node
}

// ## Pointer events, not mouse events
//
// `mousedown` and `mouseup` are COMPATIBILITY events, synthesized after the
// pointer event they follow and suppressed entirely if anything called
// `preventDefault()` on it. Several controls here do exactly that from their
// own `onPointerDown` -- the music transport buttons, to stop a press-and-hold
// scrub from also starting a text selection -- and those buttons went
// completely dead to the pressed look, for a LEFT click, with nothing wrong
// at the button.
//
// That is not a per-button defect and cannot be fixed per button: any control
// that ever needs to suppress a default on press would silently lose its
// pressed look. `:active` never had the problem because Chromium sets it from
// the widget-level press, upstream of the DOM event the app can cancel. So the
// app has to listen where the browser does. A window-capture `pointerdown`
// listener runs BEFORE the target's own handler, so a `preventDefault()` there
// cannot reach it -- verified in Chromium: a left click on a button that
// cancels its own `pointerdown` fires window-capture pointerdown/pointerup and
// no mouse events at all.
//
// It is the better question anyway: a press is a press whatever device made
// it, and touch and pen now get the pressed look for free.

/**
 * Installs the tracking. Idempotent, and never removed: it is a property of
 * the document for the app's whole life, not something a component owns.
 *
 * A press can end in more ways than it can begin -- a release anywhere, a
 * drag starting, the window losing focus, the pointer being cancelled -- so
 * every one of those clears. Clearing works from a remembered list rather
 * than a document-wide query: the query was a full tree walk on every
 * release, and a list cannot strand anything as long as marking clears
 * first, which it does.
 */
let installed = false
export function installPressTracking(): void {
  if (installed) return
  installed = true

  window.addEventListener('pointerdown', (event) => {
    if (event.button === 0) {
      markChain(event.target)
      return
    }
    // A secondary press acknowledges itself only where the control declared
    // that it means something. Every other button (middle, back, forward)
    // has no gesture in this app and gets nothing.
    if (event.button !== 2) return
    if (secondaryPressMeaning(event.target) !== 'action') return
    markChain(event.target)
  }, { capture: true })

  for (const endEvent of ['pointerup', 'dragstart', 'pointercancel'] as const) {
    window.addEventListener(endEvent, clearAll, { capture: true })
  }
  // The WINDOW losing focus, and nothing else. Deliberately not in the
  // capture list above: `blur` does not bubble, but a capturing listener on
  // window still sees every descendant's blur -- including the focus shift
  // the press itself causes when it lands on a button while a text field is
  // focused, which cleared the mark in the same tick it was set.
  window.addEventListener('blur', clearAll)

  // Keyboard activation reads as a press too -- `:active` covered that, so
  // dropping it would have traded one gap for another.
  window.addEventListener('keydown', (event) => {
    if (event.repeat || !ACTIVATION_KEYS.has(event.key)) return
    const node = pressableFocus()
    if (!node) return
    clearAll()
    node.setAttribute(PRESSED_ATTRIBUTE, '')
    marked.push(node)
  }, { capture: true })
  window.addEventListener('keyup', (event) => {
    if (!ACTIVATION_KEYS.has(event.key)) return
    clearAll()
  }, { capture: true })

  if (import.meta.env.DEV) installUndeclaredSecondaryPressWarning()
}

/**
 * The half of the contract a parser cannot see.
 *
 * `pressTracking.contract.test.ts` proves that every `onContextMenu` in the
 * JSX made a decision, which is most of the app -- but right-press behaviour
 * can also be wired through `onMouseDown`, and three controls do exactly that
 * (the snapshot timeline, the present-state circle, the sound-level readout).
 * Those declare it from the hook that wires the behaviour, which is where it
 * belongs; this is what says so when a fourth one does not.
 *
 * The signal is a `contextmenu` somebody CALLED `preventDefault()` on, from
 * an element with no declaration above it at all. `"none"` is silent, which
 * is the point -- a declared non-gesture is a decision, not a gap.
 *
 * Read after the dispatch rather than during it: a capture listener sees
 * `defaultPrevented` as false because the handler has not run yet, and a
 * bubble listener never runs at all for the handlers that `stopPropagation`.
 * A microtask queued from capture reads the finished event.
 *
 * Dev only, and `contextmenu` is a rare event, so it costs nothing anywhere.
 */
function installUndeclaredSecondaryPressWarning(): void {
  window.addEventListener('contextmenu', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    queueMicrotask(() => {
      if (!event.defaultPrevented || secondaryPressMeaning(target) !== null) return
      console.warn(
        `[pressTracking] a right-click was handled on an element with no ${SECONDARY_PRESS_ATTRIBUTE}, `
        + `so it will never look pressed. Declare "action" (or "none") where the behaviour is wired.`,
        target,
      )
    })
  }, { capture: true })
}
