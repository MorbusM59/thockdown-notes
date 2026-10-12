import { describe, expect, it } from 'vitest'
import { HOLD_CONFIRM_MS } from './holdTiming'
import {
  EMPTY_TOUCH_STATE,
  modifiersForRestingCount,
  reduceTouch,
  restingCount,
  roleOf,
  TOUCH_SLOP_PX,
  type TouchAction,
  type TouchSample,
  type TouchState,
} from './touchGesture'

/** Runs samples through the reducer, returning the final state and every action in order. */
function run(samples: TouchSample[]): { state: TouchState; actions: TouchAction[] } {
  let state = EMPTY_TOUCH_STATE
  const actions: TouchAction[] = []
  for (const sample of samples) {
    const result = reduceTouch(state, sample)
    state = result.state
    actions.push(...result.actions)
  }
  return { state, actions }
}

const kinds = (actions: TouchAction[]) => actions.map((action) => action.kind)
const LATER = HOLD_CONFIRM_MS + 50

describe('modifier counting', () => {
  it('maps resting fingers to Ctrl, Shift, then both', () => {
    expect(modifiersForRestingCount(0)).toEqual({ ctrlKey: false, shiftKey: false })
    expect(modifiersForRestingCount(1)).toEqual({ ctrlKey: true, shiftKey: false })
    expect(modifiersForRestingCount(2)).toEqual({ ctrlKey: false, shiftKey: true })
    expect(modifiersForRestingCount(3)).toEqual({ ctrlKey: true, shiftKey: true })
    expect(modifiersForRestingCount(5)).toEqual({ ctrlKey: true, shiftKey: true })
  })

  it('counts a still finger as resting only once it has been held long enough', () => {
    const early = run([{ type: 'down', id: 1, x: 0, y: 0, t: 0 }, { type: 'time', t: HOLD_CONFIRM_MS - 1 }])
    expect(restingCount(early.state)).toBe(0)
    const late = run([{ type: 'down', id: 1, x: 0, y: 0, t: 0 }, { type: 'time', t: HOLD_CONFIRM_MS }])
    expect(restingCount(late.state)).toBe(1)
  })

  it('does not count a finger that has moved beyond the slop', () => {
    const { state } = run([
      { type: 'down', id: 1, x: 0, y: 0, t: 0 },
      { type: 'move', id: 1, x: TOUCH_SLOP_PX + 1, y: 0, t: 10 },
      { type: 'time', t: LATER },
    ])
    expect(restingCount(state)).toBe(0)
  })
})

describe('one finger', () => {
  it('is left to the browser: no actions, plain role', () => {
    const { state, actions } = run([
      { type: 'down', id: 1, x: 5, y: 5, t: 0 },
      { type: 'move', id: 1, x: 80, y: 5, t: 20 },
      { type: 'up', id: 1, x: 80, y: 5, t: 40 },
    ])
    expect(actions).toEqual([])
    expect(state.fingers.size).toBe(0)
  })
})

describe('two fingers landing together', () => {
  it('is a secondary tap at the first finger, cancelling its primary press', () => {
    const { actions } = run([
      { type: 'down', id: 1, x: 10, y: 20, t: 0 },
      { type: 'down', id: 2, x: 60, y: 20, t: 40 },
      { type: 'up', id: 2, x: 60, y: 20, t: 120 },
      { type: 'up', id: 1, x: 10, y: 20, t: 130 },
    ])
    expect(actions).toEqual([
      { kind: 'cancelPlain', id: 1 },
      { kind: 'secondaryDown', id: 1, x: 10, y: 20 },
      { kind: 'secondaryUp', id: 1, x: 10, y: 20 },
    ])
  })

  it('holds the secondary press until a finger lifts, however long that is', () => {
    const { state, actions } = run([
      { type: 'down', id: 1, x: 10, y: 20, t: 0 },
      { type: 'down', id: 2, x: 60, y: 20, t: 40 },
      { type: 'time', t: 2000 },
    ])
    expect(kinds(actions)).toEqual(['cancelPlain', 'secondaryDown'])
    expect(restingCount(state)).toBe(0)
  })

  it('is not a secondary press when the second finger is late', () => {
    const { actions } = run([
      { type: 'down', id: 1, x: 10, y: 20, t: 0 },
      { type: 'move', id: 1, x: 40, y: 20, t: 20 },
      { type: 'down', id: 2, x: 60, y: 20, t: 40 },
    ])
    expect(actions).toEqual([])
  })

  it('on a pinchable element waits, and becomes a pinch when the fingers spread', () => {
    const { actions } = run([
      { type: 'down', id: 1, x: 100, y: 100, t: 0, pinchable: true },
      { type: 'down', id: 2, x: 200, y: 100, t: 30 },
      { type: 'move', id: 2, x: 300, y: 100, t: 60 },
      { type: 'up', id: 2, x: 300, y: 100, t: 90 },
      { type: 'up', id: 1, x: 100, y: 100, t: 95 },
    ])
    expect(actions).toEqual([
      { kind: 'cancelPlain', id: 1 },
      { kind: 'pinchStart', id: 1, x: 100, y: 100 },
      { kind: 'pinchMove', id: 1, scale: 2 },
      { kind: 'pinchEnd', id: 1 },
    ])
  })

  it('on a pinchable element is a secondary tap when the fingers lift unmoved', () => {
    const { actions } = run([
      { type: 'down', id: 1, x: 100, y: 100, t: 0, pinchable: true },
      { type: 'down', id: 2, x: 200, y: 100, t: 30 },
      { type: 'up', id: 1, x: 100, y: 100, t: 90 },
    ])
    expect(kinds(actions)).toEqual(['cancelPlain', 'secondaryDown', 'secondaryUp'])
  })
})

describe('resting fingers', () => {
  it('one resting finger makes the next finger a Ctrl press', () => {
    const { state, actions } = run([
      { type: 'down', id: 1, x: 0, y: 0, t: 0 },
      { type: 'down', id: 2, x: 300, y: 300, t: LATER },
      { type: 'move', id: 2, x: 340, y: 300, t: LATER + 20 },
      { type: 'up', id: 2, x: 340, y: 300, t: LATER + 40 },
    ])
    const ctrl = { ctrlKey: true, shiftKey: false }
    expect(actions).toEqual([
      { kind: 'cancelPlain', id: 1 },
      { kind: 'actingDown', id: 2, x: 300, y: 300, modifiers: ctrl },
      { kind: 'actingMove', id: 2, x: 340, y: 300, modifiers: ctrl },
      { kind: 'actingUp', id: 2, x: 340, y: 300, modifiers: ctrl, tap: false },
    ])
    expect(roleOf(state, 1)).toBe('rest')
  })

  it('an acting finger that never moved is a tap', () => {
    const { actions } = run([
      { type: 'down', id: 1, x: 0, y: 0, t: 0 },
      { type: 'down', id: 2, x: 300, y: 300, t: LATER },
      { type: 'up', id: 2, x: 302, y: 301, t: LATER + 40 },
    ])
    expect(actions.at(-1)).toMatchObject({ kind: 'actingUp', tap: true })
  })

  it('two resting fingers are Shift and three are Ctrl+Shift, reached one finger at a time', () => {
    const { state, actions } = run([
      { type: 'down', id: 1, x: 0, y: 0, t: 0 },
      { type: 'down', id: 2, x: 50, y: 0, t: LATER },
      { type: 'down', id: 3, x: 300, y: 300, t: 2 * LATER },
      { type: 'down', id: 4, x: 400, y: 300, t: 3 * LATER },
    ])
    const downs = actions.filter((action) => action.kind === 'actingDown')
    expect(downs.map((action) => action.kind === 'actingDown' && action.modifiers)).toEqual([
      { ctrlKey: true, shiftKey: false },
      { ctrlKey: false, shiftKey: true },
      { ctrlKey: true, shiftKey: true },
    ])
    // Each finger that joined the resting set had its own press ended.
    expect(kinds(actions).filter((kind) => kind === 'actingCancel')).toHaveLength(2)
    expect(restingCount(state)).toBe(3)
  })

  it('a finger landing beside a moving acting finger is ignored', () => {
    const { state, actions } = run([
      { type: 'down', id: 1, x: 0, y: 0, t: 0 },
      { type: 'down', id: 2, x: 300, y: 300, t: LATER },
      { type: 'move', id: 2, x: 360, y: 300, t: LATER + 10 },
      { type: 'down', id: 3, x: 500, y: 500, t: 2 * LATER },
    ])
    expect(kinds(actions)).toEqual(['cancelPlain', 'actingDown', 'actingMove'])
    expect(roleOf(state, 3)).toBe('ignored')
  })

  it('a cancelled acting finger ends its press without completing it', () => {
    const { actions } = run([
      { type: 'down', id: 1, x: 0, y: 0, t: 0 },
      { type: 'down', id: 2, x: 300, y: 300, t: LATER },
      { type: 'cancel', id: 2, x: 300, y: 300, t: LATER + 10 },
    ])
    expect(kinds(actions)).toEqual(['cancelPlain', 'actingDown', 'actingCancel'])
  })
})
