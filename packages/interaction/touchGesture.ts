// The rules that turn fingers into the mouse vocabulary, as a pure reducer.
//
// `touchInput.ts` is the DOM half: it feeds this reducer one sample per
// finger event (down, move, up) plus a sample when a finger's rest timer
// expires, and performs the actions it hands back. Everything that decides
// WHAT a finger means lives here so it can be tested from a sequence of
// samples without a browser.
//
// ## The mapping
//
// - One finger is left alone: the browser already delivers it as a primary
//   (button 0) press, tap, hold or drag. Its role is `plain`.
// - A second finger landing within `HOLD_CONFIRM_MS` of the first, while the
//   first has not moved, makes the pair a SECONDARY press (the right button)
//   at the first finger's position. The press is held for as long as the
//   fingers stay down, so a quick two-finger tap is a right click and a
//   two-finger hold is a right hold, timed by the control exactly as a mouse
//   hold is. The first finger's own primary press is cancelled.
// - A finger that has been down and still for `HOLD_CONFIRM_MS` is RESTING.
//   A finger landing while one or more fingers rest is the ACTING finger: its
//   press carries modifier keys, one resting finger being Ctrl, two Shift and
//   three or more Ctrl+Shift (`modifiersForRestingCount`). Each resting
//   finger's own primary press is cancelled when it takes that role.
// - On an element that declares a pinch (`pinchable` on the down sample), the
//   secondary press is not delivered on landing: if the fingers then spread
//   or close beyond `TOUCH_SLOP_PX` the pair is a PINCH, reported as a scale
//   factor; if they lift without moving it is a secondary tap. Deferring is
//   what keeps a pinch from also pressing the right button.
// - Any other finger (a third during a secondary press, a second landing on a
//   moving first finger) is `ignored`: its events are swallowed.
//
// The decision for a finger is taken the moment it lands and never revised,
// except that a `plain` or `acting` finger may later become `rest` when yet
// another finger lands -- which is how two and three resting fingers are
// reached one finger at a time.

import { HOLD_CONFIRM_MS } from './holdTiming'

/**
 * How far a finger may wander, in CSS pixels, and still count as still.
 * Larger than a mouse's drag threshold because a fingertip is not a point:
 * its reported centre drifts by several pixels while it rests on the glass.
 */
export const TOUCH_SLOP_PX = 10

export interface TouchModifiers {
  ctrlKey: boolean
  shiftKey: boolean
}

export const NO_TOUCH_MODIFIERS: TouchModifiers = { ctrlKey: false, shiftKey: false }

/** One resting finger is Ctrl, two are Shift, three or more are Ctrl+Shift. */
export function modifiersForRestingCount(count: number): TouchModifiers {
  if (count <= 0) return NO_TOUCH_MODIFIERS
  if (count === 1) return { ctrlKey: true, shiftKey: false }
  if (count === 2) return { ctrlKey: false, shiftKey: true }
  return { ctrlKey: true, shiftKey: true }
}

export type TouchSample =
  | { type: 'down'; id: number; x: number; y: number; t: number; pinchable?: boolean }
  | { type: 'move'; id: number; x: number; y: number; t: number }
  | { type: 'up'; id: number; x: number; y: number; t: number }
  /** The browser cancelled the finger's pointer: it ends like `up` but an acting press does not complete. */
  | { type: 'cancel'; id: number; x: number; y: number; t: number }
  /** A finger's rest timer expired; only the clock advances. */
  | { type: 'time'; t: number }

export type FingerRole = 'plain' | 'rest' | 'secondary' | 'acting' | 'ignored'

interface Finger {
  id: number
  x0: number
  y0: number
  x: number
  y: number
  t0: number
  /** Ever travelled beyond the slop since landing. */
  moved: boolean
  pinchable: boolean
  role: FingerRole
}

interface SecondaryPair {
  firstId: number
  secondId: number
  /** The secondary press has been delivered (it is deferred on a pinchable element). */
  delivered: boolean
  pinching: boolean
  startSpread: number
}

export interface TouchState {
  fingers: ReadonlyMap<number, Finger>
  secondary: SecondaryPair | null
  /** The time of the last sample, for the resting count. */
  now: number
}

export type TouchAction =
  /** Cancel the primary press the browser already delivered for this finger. */
  | { kind: 'cancelPlain'; id: number }
  | { kind: 'secondaryDown'; id: number; x: number; y: number }
  | { kind: 'secondaryUp'; id: number; x: number; y: number }
  | { kind: 'actingDown'; id: number; x: number; y: number; modifiers: TouchModifiers }
  | { kind: 'actingMove'; id: number; x: number; y: number; modifiers: TouchModifiers }
  /** `tap` when the finger never left the slop: the press also clicks. */
  | { kind: 'actingUp'; id: number; x: number; y: number; modifiers: TouchModifiers; tap: boolean }
  | { kind: 'actingCancel'; id: number }
  | { kind: 'pinchStart'; id: number; x: number; y: number }
  | { kind: 'pinchMove'; id: number; scale: number }
  | { kind: 'pinchEnd'; id: number }

export const EMPTY_TOUCH_STATE: TouchState = { fingers: new Map(), secondary: null, now: 0 }

function isStill(finger: Finger): boolean {
  return !finger.moved
}

/** A finger that would count as resting now: still, down long enough, and not part of another gesture. */
function canRest(finger: Finger, now: number): boolean {
  if (finger.role === 'rest') return true
  if (finger.role !== 'plain' && finger.role !== 'acting') return false
  return isStill(finger) && now - finger.t0 >= HOLD_CONFIRM_MS
}

/**
 * How many fingers are resting right now, which is the modifier state other
 * code can query (`touchInput.ts`'s `touchModifiers`). Counts a lone finger
 * held still too, so Ctrl reads as held before the acting finger lands --
 * which is what lets a control that only appears while Ctrl is held appear
 * in time to be touched.
 */
export function restingCount(state: TouchState): number {
  let count = 0
  for (const finger of state.fingers.values()) {
    // The acting finger is the one pressing, not one holding a modifier.
    if (finger.role !== 'acting' && canRest(finger, state.now)) count += 1
  }
  return count
}

function spread(a: Finger, b: Finger): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** The role a finger had, for the DOM layer deciding whether to let its native events through. */
export function roleOf(state: TouchState, id: number): FingerRole | null {
  return state.fingers.get(id)?.role ?? null
}

export function reduceTouch(state: TouchState, sample: TouchSample): { state: TouchState; actions: TouchAction[] } {
  const fingers = new Map(state.fingers)
  let secondary = state.secondary
  const actions: TouchAction[] = []
  const now = sample.t
  const actingOf = () => Array.from(fingers.values()).find((finger) => finger.role === 'acting') ?? null

  if (sample.type === 'time') {
    return { state: { fingers, secondary, now }, actions }
  }

  if (sample.type === 'down') {
    const finger: Finger = {
      id: sample.id,
      x0: sample.x,
      y0: sample.y,
      x: sample.x,
      y: sample.y,
      t0: now,
      moved: false,
      pinchable: sample.pinchable ?? false,
      role: 'plain',
    }
    const others = Array.from(fingers.values())
    if (others.length > 0) finger.role = 'ignored'

    const only = others.length === 1 ? others[0] : null
    if (secondary === null && only && only.role === 'plain' && isStill(only) && now - only.t0 < HOLD_CONFIRM_MS) {
      only.role = 'secondary'
      finger.role = 'secondary'
      actions.push({ kind: 'cancelPlain', id: only.id })
      const delivered = !only.pinchable
      if (delivered) actions.push({ kind: 'secondaryDown', id: only.id, x: only.x, y: only.y })
      fingers.set(only.id, { ...only })
      fingers.set(finger.id, finger)
      secondary = { firstId: only.id, secondId: finger.id, delivered, pinching: false, startSpread: spread(only, finger) }
      return { state: { fingers, secondary, now }, actions }
    }

    const acting = actingOf()
    const resting = others.filter((other) => canRest(other, now))
    // A moving acting finger is mid-gesture, and a new finger must not
    // pre-empt it; a still one simply joins the resting set below.
    const actingBusy = acting !== null && !canRest(acting, now)
    if (secondary === null && resting.length > 0 && !actingBusy) {
      for (const other of resting) {
        if (other.role === 'plain') actions.push({ kind: 'cancelPlain', id: other.id })
        if (other.role === 'acting') actions.push({ kind: 'actingCancel', id: other.id })
        fingers.set(other.id, { ...other, role: 'rest' })
      }
      finger.role = 'acting'
      actions.push({ kind: 'actingDown', id: finger.id, x: finger.x, y: finger.y, modifiers: modifiersForRestingCount(resting.length) })
    }
    fingers.set(finger.id, finger)
    return { state: { fingers, secondary, now }, actions }
  }

  const existing = fingers.get(sample.id)
  if (!existing) return { state: { fingers, secondary, now }, actions }
  const finger: Finger = {
    ...existing,
    x: sample.x,
    y: sample.y,
    moved: existing.moved || Math.hypot(sample.x - existing.x0, sample.y - existing.y0) > TOUCH_SLOP_PX,
  }
  fingers.set(finger.id, finger)
  const restingNow = () => Array.from(fingers.values()).filter((other) => other.role === 'rest').length

  if (sample.type === 'move') {
    if (finger.role === 'acting') {
      actions.push({ kind: 'actingMove', id: finger.id, x: finger.x, y: finger.y, modifiers: modifiersForRestingCount(restingNow()) })
    } else if (finger.role === 'secondary' && secondary && !secondary.delivered) {
      const first = fingers.get(secondary.firstId)
      const second = fingers.get(secondary.secondId)
      if (first && second) {
        const current = spread(first, second)
        if (!secondary.pinching && Math.abs(current - secondary.startSpread) > TOUCH_SLOP_PX && secondary.startSpread > 0) {
          secondary = { ...secondary, pinching: true }
          actions.push({ kind: 'pinchStart', id: first.id, x: first.x0, y: first.y0 })
        }
        if (secondary.pinching) {
          actions.push({ kind: 'pinchMove', id: first.id, scale: current / secondary.startSpread })
        }
      }
    }
    return { state: { fingers, secondary, now }, actions }
  }

  // up or cancel
  fingers.delete(finger.id)
  if (finger.role === 'acting' && sample.type === 'cancel') {
    actions.push({ kind: 'actingCancel', id: finger.id })
  } else if (finger.role === 'acting') {
    // The modifiers the press ends with are the ones it is ending under; a
    // resting finger lifted first takes its modifier with it, as releasing
    // a key before the mouse button does.
    actions.push({ kind: 'actingUp', id: finger.id, x: finger.x, y: finger.y, modifiers: modifiersForRestingCount(restingNow()), tap: isStill(finger) })
  } else if (finger.role === 'secondary' && secondary) {
    const first = finger.id === secondary.firstId ? finger : fingers.get(secondary.firstId) ?? finger
    if (secondary.pinching) {
      actions.push({ kind: 'pinchEnd', id: secondary.firstId })
    } else if (secondary.delivered) {
      actions.push({ kind: 'secondaryUp', id: secondary.firstId, x: first.x, y: first.y })
    } else {
      actions.push({ kind: 'secondaryDown', id: secondary.firstId, x: first.x, y: first.y })
      actions.push({ kind: 'secondaryUp', id: secondary.firstId, x: first.x, y: first.y })
    }
    // The gesture ended with its first finger up; the other has no role left.
    const otherId = finger.id === secondary.firstId ? secondary.secondId : secondary.firstId
    const other = fingers.get(otherId)
    if (other) fingers.set(otherId, { ...other, role: 'ignored' })
    secondary = null
  }
  return { state: { fingers, secondary, now }, actions }
}
