import { describe, expect, it, vi } from 'vitest'
import { createPreviewSettleGate, type PreviewSettleGateScheduler } from './previewSettleGate'

/**
 * A container stand-in whose geometry the test drives by hand, plus a
 * scheduler whose frames and timers only advance when the test says so --
 * the gate's whole contract is "reveal exactly when the geometry stops
 * moving, not after N frames", and that's only checkable if the test owns
 * both the geometry and the clock.
 */
function createHarness(maxSettleMs = 600) {
  const container = {
    style: { visibility: '' },
    scrollTop: 0,
    scrollHeight: 1000,
    firstElementChild: { style: { height: '1000px' } },
  }

  let nowMs = 0
  const frames: Array<() => void> = []
  const timers: Array<{ fireAtMs: number; callback: () => void }> = []

  const scheduler: PreviewSettleGateScheduler = {
    now: () => nowMs,
    requestFrame: (callback) => frames.push(callback),
    cancelFrame: (handle) => { frames[handle - 1] = () => {} },
    setTimer: (callback, delayMs) => timers.push({ fireAtMs: nowMs + delayMs, callback }),
    clearTimer: (handle) => { const timer = timers[handle - 1]; if (timer) timer.callback = () => {} },
  }

  const gate = createPreviewSettleGate({
    getContainer: () => container as unknown as HTMLElement,
    maxSettleMs,
    scheduler,
  })

  /** Runs whatever frame callbacks are currently queued (not ones they enqueue in turn -- that's the next frame). */
  const advanceFrame = (elapsedMs = 16) => {
    nowMs += elapsedMs
    const due = frames.splice(0)
    for (const callback of due) callback()
  }

  const runDueTimers = () => {
    for (const timer of timers.splice(0)) {
      if (timer.fireAtMs <= nowMs) timer.callback()
    }
  }

  const isHidden = () => container.style.visibility === 'hidden'

  /** Simulates a geometry change of the kind react-virtual's measurement produces. */
  const moveGeometry = (heightPx: number) => {
    container.scrollHeight = heightPx
    container.firstElementChild.style.height = `${heightPx}px`
  }

  return { gate, container, advanceFrame, runDueTimers, isHidden, moveGeometry, setNow: (ms: number) => { nowMs = ms } }
}

describe('previewSettleGate', () => {
  it('hides the preview as soon as a settle generation opens', () => {
    const { gate, isHidden } = createHarness()
    expect(isHidden()).toBe(false)
    gate.beginSettle()
    expect(isHidden()).toBe(true)
  })

  it('stays hidden while the restore has not reported in, however stable the geometry looks', () => {
    const { gate, advanceFrame, isHidden } = createHarness()
    gate.beginSettle()

    // Geometry is perfectly still across many frames -- but "still" before
    // the scroll has landed just means we are stably in the wrong place.
    for (let i = 0; i < 10; i += 1) advanceFrame()

    expect(isHidden()).toBe(true)
  })

  it('reveals on the first pair of identical geometry samples after the restore lands', () => {
    const { gate, advanceFrame, isHidden } = createHarness()
    const generation = gate.beginSettle()
    gate.markRestoreApplied(generation)

    advanceFrame() // first sample -- nothing to compare against yet
    expect(isHidden()).toBe(true)

    advanceFrame() // second sample matches the first => settled
    expect(isHidden()).toBe(false)
  })

  it('keeps waiting for as long as the geometry is still moving, then reveals immediately once it stops', () => {
    const { gate, advanceFrame, isHidden, moveGeometry } = createHarness()
    const generation = gate.beginSettle()
    gate.markRestoreApplied(generation)

    advanceFrame()
    for (let i = 0; i < 5; i += 1) {
      moveGeometry(2000 + i * 500) // a block's real height replacing its estimate
      advanceFrame()
      expect(isHidden()).toBe(true)
    }

    advanceFrame() // geometry unchanged since the last sample => settled
    expect(isHidden()).toBe(false)
  })

  it('does not let a superseded generation reveal the note that replaced it', () => {
    const { gate, advanceFrame, isHidden } = createHarness()
    const stale = gate.beginSettle()
    gate.beginSettle() // a second, faster note switch supersedes the first

    gate.markRestoreApplied(stale)
    advanceFrame()
    advanceFrame()

    expect(isHidden()).toBe(true)
  })

  it('reveals on the safety timer when frames stop arriving entirely (backgrounded window)', () => {
    const { gate, runDueTimers, isHidden, setNow } = createHarness(600)
    gate.beginSettle()
    expect(isHidden()).toBe(true)

    // No advanceFrame() at all: rAF is throttled to nothing, as it is in a
    // non-compositing window. The timer must still get us out.
    setNow(601)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    runDueTimers()
    warn.mockRestore()

    expect(isHidden()).toBe(false)
  })

  it('reveals immediately on forceReveal, and ignores the abandoned generation afterwards', () => {
    const { gate, advanceFrame, isHidden } = createHarness()
    const generation = gate.beginSettle()

    gate.forceReveal()
    expect(isHidden()).toBe(false)

    gate.markRestoreApplied(generation)
    advanceFrame()
    expect(isHidden()).toBe(false)
  })

  it('fans commit notifications out to subscribers until they unsubscribe', () => {
    const { gate } = createHarness()
    const listener = vi.fn()
    const unsubscribe = gate.subscribeToCommit(listener)

    gate.notifyCommit()
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    gate.notifyCommit()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
