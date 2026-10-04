import { beforeEach, describe, expect, it } from 'vitest'
import {
  beginBackgroundWork,
  resetBackgroundWorkForTests,
  subscribeToBackgroundWork,
} from './backgroundWork'

describe('the background work register', () => {
  beforeEach(() => { resetBackgroundWorkForTests() })

  it('counts concurrent work rather than holding a flag', () => {
    const seen: number[] = []
    subscribeToBackgroundWork((state) => { seen.push(state.pending) })

    const split = beginBackgroundWork('document-split')
    const find = beginBackgroundWork('document-find')
    split.done()
    // A flag would say idle here, with a find still running.
    expect(seen[seen.length - 1]).toBe(1)
    find.done()
    expect(seen[seen.length - 1]).toBe(0)
  })

  it('pairs begin and done exactly once, however often done is called', () => {
    // Several sites end work on a path that may have ended it already -- a
    // worker error handler resolves every pending request, and then each
    // request's own resolution runs. A second done() must not retract a count
    // belonging to work still running underneath. Same latch as armHold's.
    const first = beginBackgroundWork('document-split')
    const second = beginBackgroundWork('document-split')
    first.done()
    first.done()
    first.done()

    let pending = -1
    subscribeToBackgroundWork((state) => { pending = state.pending })
    expect(pending).toBe(1)
    second.done()
    expect(pending).toBe(0)
  })

  it('reports the least-advanced progress, not an average', () => {
    let progress: number | null = -1
    subscribeToBackgroundWork((state) => { progress = state.progress })

    const nearlyDone = beginBackgroundWork('document-split')
    nearlyDone.report(0.9)
    expect(progress).toBeCloseTo(0.9)

    // Averaging would show progress RUNNING BACKWARDS more slowly than the
    // truth; two tasks are finished when the slowest one is.
    const justStarted = beginBackgroundWork('document-split')
    justStarted.report(0.1)
    expect(progress).toBeCloseTo(0.1)

    justStarted.done()
    expect(progress).toBeCloseTo(0.9)
  })

  it('says nothing about progress when nothing in flight can', () => {
    let progress: number | null = -1
    subscribeToBackgroundWork((state) => { progress = state.progress })
    const opaque = beginBackgroundWork('texture')
    expect(progress).toBeNull()
    opaque.done()
  })

  it('tells a new subscriber the current state immediately', () => {
    const running = beginBackgroundWork('document-find')
    let pending = -1
    subscribeToBackgroundWork((state) => { pending = state.pending })
    // Not on the next change: a component mounting mid-work must not have to
    // wait for something else to happen before it knows the app is busy.
    expect(pending).toBe(1)
    running.done()
  })

  it('stops notifying an unsubscribed listener', () => {
    let calls = 0
    const unsubscribe = subscribeToBackgroundWork(() => { calls += 1 })
    const before = calls
    unsubscribe()
    beginBackgroundWork('texture').done()
    expect(calls).toBe(before)
  })
})
