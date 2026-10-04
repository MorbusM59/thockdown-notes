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
    style: { opacity: '', pointerEvents: '', transition: '' },
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

  /** Stands in for the render view's scrollbar thumb: a real element, outside the scroll container, that must be covered by the same hold. */
  const companion = { style: { opacity: '', pointerEvents: '', transition: '' } }
  /** Records what was still hidden at the moment the pre-reveal hook ran -- the ordering is the point, not the call. */
  const beforeRevealVisibility: Array<{ container: string; companion: string }> = []

  const gate = createPreviewSettleGate({
    getContainer: () => container as unknown as HTMLElement,
    maxSettleMs,
    getCompanions: () => [companion as unknown as HTMLElement],
    onBeforeReveal: () => {
      beforeRevealVisibility.push({ container: container.style.opacity, companion: companion.style.opacity })
    },
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

  const isHidden = () => container.style.opacity === '0'

  /** Simulates a geometry change of the kind a late-arriving block produces. */
  const moveGeometry = (heightPx: number) => {
    container.scrollHeight = heightPx
    container.firstElementChild.style.height = `${heightPx}px`
  }

  return {
    gate,
    container,
    advanceFrame,
    runDueTimers,
    isHidden,
    moveGeometry,
    companion,
    beforeRevealVisibility,
    isCompanionHidden: () => companion.style.opacity === '0',
    setNow: (ms: number) => { nowMs = ms },
  }
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

  it('fades the outgoing note out, and reports how long the caller must wait', () => {
    const { gate, container, companion } = createHarness()

    const durationMs = gate.beginFadeOut()

    expect(durationMs).toBeGreaterThan(0)
    expect(container.style.opacity).toBe('0')
    expect(container.style.transition).toContain(`${durationMs}ms`)
    // The scrollbar leaves with the pane it describes, not after it.
    expect(companion.style.transition).toContain(`${durationMs}ms`)
  })

  it('cuts an in-flight fade-out short rather than holding the new note back', () => {
    const { gate, container, setNow } = createHarness()
    const durationMs = gate.beginFadeOut()

    // The load finished before the fade did, so the switch commits mid-fade.
    // The remaining fade must NOT play out: by this point React has already
    // swapped in the incoming note, so continuing it would fade the wrong
    // note in front of the reader. Instant, with no transition left running.
    setNow(durationMs / 2)
    gate.beginSettle()

    expect(container.style.opacity).toBe('0')
    expect(container.style.transition).toBe('')
  })

  it('comes back up when a fade-out is never followed by a switch', () => {
    const { gate, isHidden, runDueTimers, setNow } = createHarness()
    gate.beginFadeOut()
    expect(isHidden()).toBe(true)

    // The load threw; no settle will ever open, so nothing else would reveal
    // the pane and it would stay invisible for the rest of the session.
    setNow(60_000)
    runDueTimers()

    expect(isHidden()).toBe(false)
  })

  it('hides and reveals its companions with the pane, in the same step', () => {
    const { gate, advanceFrame, isHidden, isCompanionHidden } = createHarness()
    gate.beginSettle()
    expect(isCompanionHidden()).toBe(true)

    const generation = 1
    gate.markRestoreApplied(generation)
    advanceFrame()
    advanceFrame()

    expect(isHidden()).toBe(false)
    expect(isCompanionHidden()).toBe(false)
  })

  it('runs the pre-reveal hook while everything is still hidden', () => {
    const { gate, advanceFrame, beforeRevealVisibility } = createHarness()
    const generation = gate.beginSettle()
    gate.markRestoreApplied(generation)
    advanceFrame()
    advanceFrame()

    // The scrollbar redraws itself here, so it is already correct in the very
    // first frame it is seen rather than correcting itself in the second.
    expect(beforeRevealVisibility).toEqual([{ container: '0', companion: '0' }])
  })

  it('reveals on a fixed point with nothing else to wait for', () => {
    const { gate, advanceFrame, isHidden } = createHarness()
    const generation = gate.beginSettle()
    gate.markRestoreApplied(generation)

    advanceFrame()
    advanceFrame()

    expect(isHidden()).toBe(false)
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

  it('re-evaluates on a commit, since the geometry may have moved', () => {
    // The subscriber side of this is gone with the restore's re-aim loop --
    // nothing waits to be told the DOM changed, because nothing looks twice.
    // What remains is the gate's own reason to care: a commit is a moment the
    // geometry could have moved, so it is worth another sample.
    const { gate, advanceFrame, isHidden } = createHarness()
    const generation = gate.beginSettle()
    gate.markRestoreApplied(generation)
    advanceFrame()

    gate.notifyCommit()
    advanceFrame()

    expect(isHidden()).toBe(false)
  })
})
