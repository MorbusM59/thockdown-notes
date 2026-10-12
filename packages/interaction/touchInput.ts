// Fingers, translated into the mouse vocabulary the app already speaks.
//
// Every control in the app is written against a primary and a secondary
// press, each a tap or a hold, optionally with Ctrl or Shift held. A finger
// on a touch screen is always the primary button with no modifier, so
// without this module nothing that answers the right button or a modifier
// is reachable by touch. Rather than give each control a second, touch
// binding (about sixty sites, and a second thing for every new control to
// forget), this module sits at the one input boundary and turns finger
// gestures into the mouse events those controls already handle. No control
// knows it exists.
//
// What each gesture becomes is decided by the pure reducer in
// `touchGesture.ts` (read its header for the mapping); this file is the DOM
// half. It watches touch pointers in the window's capture phase -- installed
// before every other window-level listener, so it sees each event first --
// feeds the reducer, and performs what it returns:
//
// - A finger the reducer leaves `plain` passes through untouched, so a
//   single finger keeps every native behaviour: focus, text selection,
//   panning with the browser's own fling.
// - Any other finger's native events are stopped here
//   (`stopImmediatePropagation`), and the app receives synthesized events in
//   their place: `pointerdown`/`mousedown`/`contextmenu` and
//   `pointerup`/`mouseup` with `button: 2` for a two-finger press, or copies
//   of the acting finger's events with `ctrlKey`/`shiftKey` set when other
//   fingers rest. Synthesized events carry `pointerType: 'mouse'`, because
//   they ARE the mouse vocabulary, and the real finger's `pointerId`, so a
//   handler that calls `setPointerCapture(event.pointerId)` captures a
//   pointer that actually exists. A finger's primary press that the browser
//   already delivered, before the finger was given another role, is ended
//   with a synthesized `pointercancel`, which every press handler in the app
//   already treats as "this press did not happen".
//
// ## Why re-dispatch, rather than rewriting the modifier flags
//
// `ctrlKey` and `shiftKey` are read-only on a trusted event. The other way
// to make a handler see them is to redefine the getters on
// `MouseEvent.prototype` so they consult this module, which keeps the
// trusted event and its default actions but changes what every event in
// the document reports, mouse and keyboard-driven alike, for the app's whole
// life. Re-dispatching changes only the events of the finger that is
// acting, and loses only the browser's default actions for that one finger
// (no focus change, no native text selection), which a modified press in
// this app never relies on: every Ctrl or Shift gesture with the pointer is
// the app's own handler. The same holds for the secondary press, which has
// no native default besides the menu the app suppresses anyway.
//
// ## Code that reads modifiers from the keyboard
//
// A few places track Ctrl from `keydown`/`keyup` instead of from the pointer
// event (the editor's scroll-cage handles appear while Ctrl is held). They
// read `touchModifiers()` and subscribe with `subscribeTouchModifiers`,
// rather than this module inventing keyboard events: a synthesized `keydown`
// for Control would reach every key handler in the app, including the
// shortcut table, for a key nobody pressed.
//
// ## Panning
//
// The browser decides on a finger's first `touchmove` whether the gesture
// pans. A non-passive window `touchmove` listener cancels that whenever a
// finger has a role other than `plain`, or something has claimed the touch
// with `holdTouchPanning` (an in-app drag that started from a long press).
// Chromium only waits for the page on that first move; once a pan has
// begun its later moves are dispatched without blocking, so the listener
// costs one main-thread round trip per touch sequence and nothing during a
// fling.
//
// The native long-press `contextmenu` is suppressed and stopped outright:
// a long press is a primary hold here, and letting the event through would
// run every right-click handler in the app from a single finger.

import {
  EMPTY_TOUCH_STATE,
  modifiersForRestingCount,
  reduceTouch,
  restingCount,
  roleOf,
  type TouchAction,
  type TouchModifiers,
  type TouchSample,
} from './touchGesture'
import { HOLD_CONFIRM_MS } from './holdTiming'

/**
 * Declares an element a pinch can resize. On such an element two fingers
 * that spread or close become a Shift + vertical drag that scales the
 * element's height by the change in the fingers' distance (the image
 * gestures read Shift + drag as a resize keeping the proportions), and a
 * two-finger press there is delivered only when the fingers lift without
 * moving.
 */
export const TOUCH_PINCH_ATTRIBUTE = 'data-touch-pinch'

/** Events this module dispatched, which its own listeners must let pass. */
const synthesized = new WeakSet<Event>()

let state = EMPTY_TOUCH_STATE
/** The element each finger's press was delivered to, for ending it there. */
const pressTargets = new Map<number, Element>()
const restTimers = new Map<number, number>()
let panHolds = 0
let lastResting = 0
const modifierListeners = new Set<(modifiers: TouchModifiers) => void>()

interface PinchSession {
  target: Element
  x: number
  y: number
  heightPx: number
  lastY: number
}
let pinch: PinchSession | null = null

/** The modifier keys resting fingers are holding right now. */
export function touchModifiers(): TouchModifiers {
  return modifiersForRestingCount(lastResting)
}

/** Calls `listener` whenever `touchModifiers()` changes. Returns the unsubscribe. */
export function subscribeTouchModifiers(listener: (modifiers: TouchModifiers) => void): () => void {
  modifierListeners.add(listener)
  return () => {
    modifierListeners.delete(listener)
  }
}

/**
 * Stops the current touch from panning until the returned function is
 * called. For a gesture that takes over a finger the browser would
 * otherwise scroll with (an in-app drag started by a long press).
 */
export function holdTouchPanning(): () => void {
  panHolds += 1
  let released = false
  return () => {
    if (released) return
    released = true
    panHolds -= 1
  }
}

interface SynthesisInit {
  pointerId: number
  x: number
  y: number
  button: number
  buttons: number
  modifiers?: TouchModifiers
}

function dispatchPointer(type: string, target: EventTarget, init: SynthesisInit): void {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: type !== 'pointercancel',
    composed: true,
    view: window,
    clientX: init.x,
    clientY: init.y,
    screenX: window.screenX + init.x,
    screenY: window.screenY + init.y,
    button: init.button,
    buttons: init.buttons,
    pointerId: init.pointerId,
    pointerType: 'mouse',
    isPrimary: true,
    ctrlKey: init.modifiers?.ctrlKey ?? false,
    shiftKey: init.modifiers?.shiftKey ?? false,
  })
  synthesized.add(event)
  target.dispatchEvent(event)
}

function dispatchMouse(type: string, target: EventTarget, init: SynthesisInit): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    detail: type === 'mousemove' ? 0 : 1,
    clientX: init.x,
    clientY: init.y,
    screenX: window.screenX + init.x,
    screenY: window.screenY + init.y,
    button: init.button,
    buttons: init.buttons,
    ctrlKey: init.modifiers?.ctrlKey ?? false,
    shiftKey: init.modifiers?.shiftKey ?? false,
  })
  synthesized.add(event)
  target.dispatchEvent(event)
}

function elementAt(x: number, y: number): Element {
  return document.elementFromPoint(x, y) ?? document.body
}

/**
 * Performs one reducer action. `nativeTarget` is the target of the native
 * event being handled, which for the acting finger is where its copy goes:
 * the browser has already applied pointer capture to it.
 */
function perform(action: TouchAction, nativeTarget: Element | null): void {
  switch (action.kind) {
    case 'cancelPlain':
    case 'actingCancel': {
      const target = pressTargets.get(action.id)
      if (target) dispatchPointer('pointercancel', target, { pointerId: action.id, x: 0, y: 0, button: -1, buttons: 0 })
      return
    }
    case 'secondaryDown': {
      const target = elementAt(action.x, action.y)
      pressTargets.set(action.id, target)
      const init = { pointerId: action.id, x: action.x, y: action.y, button: 2, buttons: 2 }
      dispatchPointer('pointerdown', target, init)
      dispatchMouse('mousedown', target, init)
      // On Linux the browser fires the menu event on the press, not the
      // release; the app's handlers are written for either.
      dispatchMouse('contextmenu', target, init)
      return
    }
    case 'secondaryUp': {
      const target = pressTargets.get(action.id) ?? elementAt(action.x, action.y)
      pressTargets.delete(action.id)
      const init = { pointerId: action.id, x: action.x, y: action.y, button: 2, buttons: 0 }
      dispatchPointer('pointerup', target, init)
      dispatchMouse('mouseup', target, init)
      return
    }
    case 'actingDown': {
      const target = nativeTarget ?? elementAt(action.x, action.y)
      pressTargets.set(action.id, target)
      const init = { pointerId: action.id, x: action.x, y: action.y, button: 0, buttons: 1, modifiers: action.modifiers }
      dispatchPointer('pointerdown', target, init)
      dispatchMouse('mousedown', target, init)
      return
    }
    case 'actingMove': {
      const target = nativeTarget ?? elementAt(action.x, action.y)
      const init = { pointerId: action.id, x: action.x, y: action.y, button: -1, buttons: 1, modifiers: action.modifiers }
      dispatchPointer('pointermove', target, init)
      dispatchMouse('mousemove', target, init)
      return
    }
    case 'actingUp': {
      const target = nativeTarget ?? elementAt(action.x, action.y)
      const pressed = pressTargets.get(action.id)
      pressTargets.delete(action.id)
      const init = { pointerId: action.id, x: action.x, y: action.y, button: 0, buttons: 0, modifiers: action.modifiers }
      dispatchPointer('pointerup', target, init)
      dispatchMouse('mouseup', target, init)
      // A click goes to where the press and the release agree, as the
      // browser's does; a finger that wandered off produces none.
      if (action.tap && pressed && (pressed === target || pressed.contains(target) || target.contains(pressed))) {
        dispatchMouse('click', pressed.contains(target) ? target : pressed, init)
      }
      return
    }
    case 'pinchStart': {
      const target = elementAt(action.x, action.y)
      const declared = target.closest(`[${TOUCH_PINCH_ATTRIBUTE}]`) ?? target
      pinch = { target, x: action.x, y: action.y, heightPx: declared.getBoundingClientRect().height, lastY: action.y }
      dispatchPointer('pointerdown', target, { pointerId: action.id, x: action.x, y: action.y, button: 0, buttons: 1, modifiers: { ctrlKey: false, shiftKey: true } })
      return
    }
    case 'pinchMove': {
      if (!pinch) return
      // A downward Shift-drag of the element's own height times the change
      // in scale grows its height (and, the ratio being kept, its width) by
      // exactly that factor.
      pinch.lastY = pinch.y + pinch.heightPx * (action.scale - 1)
      dispatchPointer('pointermove', pinch.target, { pointerId: action.id, x: pinch.x, y: pinch.lastY, button: -1, buttons: 1, modifiers: { ctrlKey: false, shiftKey: true } })
      return
    }
    case 'pinchEnd': {
      if (!pinch) return
      dispatchPointer('pointerup', pinch.target, { pointerId: action.id, x: pinch.x, y: pinch.lastY, button: 0, buttons: 0, modifiers: { ctrlKey: false, shiftKey: true } })
      pinch = null
      return
    }
  }
}

function feed(sample: TouchSample, nativeTarget: Element | null): void {
  const result = reduceTouch(state, sample)
  state = result.state
  for (const action of result.actions) perform(action, nativeTarget)
  const resting = restingCount(state)
  if (resting !== lastResting) {
    lastResting = resting
    const modifiers = modifiersForRestingCount(resting)
    for (const listener of modifierListeners) listener(modifiers)
  }
}

function isTouch(event: PointerEvent): boolean {
  return event.pointerType === 'touch' && !synthesized.has(event)
}

/**
 * Installs the translation. Idempotent, never removed, and must be called
 * before any other window-level pointer listener is added (first in the
 * app's entry module), so its capture listeners run before theirs.
 */
let installed = false
export function installTouchInput(): void {
  if (installed) return
  installed = true

  window.addEventListener('pointerdown', (event) => {
    if (!isTouch(event)) return
    const target = event.target instanceof Element ? event.target : null
    if (target) pressTargets.set(event.pointerId, target)
    feed({
      type: 'down',
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      t: event.timeStamp,
      pinchable: target?.closest(`[${TOUCH_PINCH_ATTRIBUTE}]`) != null,
    }, target)
    // The moment a lone finger could start counting as resting; the
    // reducer re-reads the clock then. One timer per finger, cleared when
    // it lifts.
    restTimers.set(event.pointerId, window.setTimeout(() => {
      restTimers.delete(event.pointerId)
      feed({ type: 'time', t: performance.now() }, null)
    }, HOLD_CONFIRM_MS))
    if (roleOf(state, event.pointerId) !== 'plain') {
      event.stopImmediatePropagation()
      event.preventDefault()
    }
  }, { capture: true })

  const forward = (type: 'move' | 'up' | 'cancel') => (event: PointerEvent) => {
    if (!isTouch(event)) return
    const role = roleOf(state, event.pointerId)
    if (role === null) return
    if (type !== 'move') {
      const timer = restTimers.get(event.pointerId)
      if (timer !== undefined) window.clearTimeout(timer)
      restTimers.delete(event.pointerId)
    }
    if (role !== 'plain') {
      event.stopImmediatePropagation()
      event.preventDefault()
    }
    feed({ type, id: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp }, event.target instanceof Element ? event.target : null)
    if (type !== 'move') pressTargets.delete(event.pointerId)
  }
  window.addEventListener('pointermove', forward('move'), { capture: true })
  window.addEventListener('pointerup', forward('up'), { capture: true })
  window.addEventListener('pointercancel', forward('cancel'), { capture: true })

  const ownsTouch = () => panHolds > 0 || Array.from(state.fingers.values()).some((finger) => finger.role !== 'plain')
  window.addEventListener('touchmove', (event) => {
    if (event.cancelable && ownsTouch()) event.preventDefault()
  }, { capture: true, passive: false })
  // A second finger on the glass is ours whatever it turns out to be: left
  // to the browser, two touches start its own two-finger gestures.
  window.addEventListener('touchstart', (event) => {
    if (event.cancelable && event.touches.length >= 2) event.preventDefault()
  }, { capture: true, passive: false })

  window.addEventListener('contextmenu', (event) => {
    if (synthesized.has(event)) return
    const fromTouch = (event as PointerEvent).pointerType === 'touch' || state.fingers.size > 0
    if (!fromTouch) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }, { capture: true })
}
